import { css, cx } from '@emotion/css';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ValueHandle } from '../../core/types';
import { pdfLayoutSchema, type PageSize } from '../../modules/pdf/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { preview } from './styles';

const GAP = 12;
const PAD = 16;
const ZOOMS = [1, 2] as const;
/** Render scales are rounded to this step so small resizes reuse the same image. */
const SCALE_STEP = 0.25;

const styles = {
  scroller: css`
    position: absolute;
    inset: 0;
    overflow: auto;
    background: ${theme.subtle};
  `,
  page: css`
    position: absolute;
    left: ${PAD}px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  `,
  img: css`
    display: block;
    width: 100%;
    height: 100%;
  `,
  pageError: css`
    padding: 12px;
    color: #a00;
    font-size: 12px;
  `,
  active: css`
    border-color: ${theme.accent};
  `,
  counter: css`
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    color: ${theme.muted};
  `,
  jump: css`
    width: 56px;
    padding: 2px 4px;
    background: ${theme.raised};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    color: ${theme.text};
  `,
};

export function PdfView({ handle }: { handle: ValueHandle }) {
  const layout = useAsync('pdf-layout', async () => pdfLayoutSchema.parse(await handle.json()));
  if (layout.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (layout.status === 'error') return <div className={ui.empty}>{layout.error}</div>;
  if (layout.value.error) {
    return (
      <div className={ui.empty} data-testid="pdf-error">
        {layout.value.error}
      </div>
    );
  }
  return <PageList handle={handle} pages={layout.value.pages} />;
}

function PageList({ handle, pages }: { handle: ValueHandle; pages: PageSize[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [{ width, height: viewport }, setBox] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [jump, setJump] = useState('');

  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit-width at 1×; 2× doubles it and scrolls sideways
  const pageWidth = Math.max(100, (width - PAD * 2) * zoom);
  const heightOf = (i: number) => {
    const p = pages[i];
    return p ? (pageWidth * p.height) / p.width : pageWidth * 1.414;
  };

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: i => heightOf(i) + GAP,
    paddingStart: PAD,
    paddingEnd: PAD,
    overscan: 1,
  });
  useEffect(() => virtualizer.measure(), [virtualizer, pageWidth]);

  const items = virtualizer.getVirtualItems();
  const offset = virtualizer.scrollOffset ?? 0;
  // The page under the middle of the view
  const current = items.find(it => it.end > offset + viewport / 2)?.index ?? items[0]?.index ?? 0;

  const goTo = (n: number) => {
    const index = Math.min(pages.length, Math.max(1, Math.round(n))) - 1;
    virtualizer.scrollToIndex(index, { align: 'start' });
  };

  return (
    <div className={preview.column}>
      <div className={preview.toolbar}>
        {ZOOMS.map(z => (
          <button
            key={z}
            className={cx(ui.button, zoom === z && styles.active)}
            aria-pressed={zoom === z}
            onClick={() => setZoom(z)}
          >
            {z}×
          </button>
        ))}
        <form
          className={styles.counter}
          onSubmit={e => {
            e.preventDefault();
            const n = Number(jump);
            if (Number.isFinite(n) && jump !== '') goTo(n);
            setJump('');
          }}
        >
          <span data-testid="pdf-page-counter">
            Page {current + 1} / {pages.length}
          </span>
          <input
            className={styles.jump}
            type="number"
            min={1}
            max={pages.length}
            placeholder="Go to"
            aria-label="Go to page"
            value={jump}
            onChange={e => setJump(e.target.value)}
          />
        </form>
      </div>
      <div className={preview.fill}>
        <div ref={parentRef} className={styles.scroller} data-testid="pdf-view">
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: pageWidth + PAD * 2,
              position: 'relative',
            }}
          >
            {width > 0 &&
              items.map(item => {
                const size = pages[item.index];
                if (!size) return null;
                return (
                  <div
                    key={item.key}
                    className={styles.page}
                    style={{
                      top: item.start,
                      width: pageWidth,
                      height: heightOf(item.index),
                    }}
                  >
                    <PageImage
                      handle={handle}
                      index={item.index}
                      scale={renderScale(pageWidth, size)}
                    />
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** PDF points → device pixels at the displayed width, rounded to SCALE_STEP. */
function renderScale(displayWidth: number, size: PageSize): number {
  const exact = (displayWidth * (globalThis.devicePixelRatio || 1)) / size.width;
  return Math.max(SCALE_STEP, Math.ceil(exact / SCALE_STEP) * SCALE_STEP);
}

function PageImage({
  handle,
  index,
  scale,
}: {
  handle: ValueHandle;
  index: number;
  scale: number;
}) {
  const image = useAsync(`${index}:${scale}`, () => handle.page(index, scale));
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (image.status !== 'ok') return;
    const u = URL.createObjectURL(new Blob([image.value.bytes], { type: image.value.mime }));
    // Object URL lifetime must follow the effect (StrictMode remounts would revoke a memoised one)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);

  if (image.status === 'error') return <div className={styles.pageError}>{image.error}</div>;
  // Keep showing the previous render while a new scale loads
  return url ? (
    <img src={url} alt={`Page ${index + 1}`} className={styles.img} data-testid="pdf-page" />
  ) : null;
}
