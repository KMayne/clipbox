import { css } from '@emotion/css';
import { useEffect, useRef, useState } from 'react';
import { formatBytes } from '../../core/format';
import {
  presentationLayoutSchema,
  type PresentationLayout,
  type PresentationMedia,
  type Slide,
} from '../../core/presentation/types';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { preview } from './styles';

/** Formats the browser can show as a thumbnail (by extension; EMF/WMF/TIFF can't). */
const SHOWABLE = /\.(png|jpe?g|gif|bmp|webp|svg|ico)$/i;
const THUMB = 96;

const styles = {
  list: css`
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: ${theme.sans};
    font-size: 13px;
  `,
  slide: css`
    display: grid;
    grid-template-columns: 36px 1fr;
    gap: 4px 10px;
    padding: 10px 12px;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
  `,
  number: css`
    grid-row: span 4;
    color: ${theme.faint};
    font-family: ${theme.mono};
    font-size: 12px;
    text-align: right;
    padding-top: 2px;
  `,
  title: css`
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: ${theme.text};
    overflow-wrap: anywhere;
  `,
  untitled: css`
    color: ${theme.muted};
    font-style: italic;
    font-weight: normal;
  `,
  badge: css`
    margin-left: 8px;
    padding: 0 5px;
    border: 1px solid ${theme.border};
    border-radius: 3px;
    color: ${theme.muted};
    font-size: 11px;
    font-weight: normal;
  `,
  text: css`
    margin: 0;
    padding: 0;
    list-style: none;
    color: ${theme.text};
    li {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      line-height: 1.45;
    }
  `,
  thumbs: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  `,
  thumb: css`
    width: ${THUMB}px;
    height: ${THUMB}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${theme.subtle};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    overflow: hidden;
    color: ${theme.muted};
    font-size: 10px;
    text-align: center;
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  `,
  notes: css`
    color: ${theme.muted};
    summary {
      cursor: pointer;
      user-select: none;
    }
    p {
      margin: 4px 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `,
};

export function PresentationView({ handle }: { handle: ValueHandle }) {
  const layout = useAsync('presentation-layout', async () =>
    presentationLayoutSchema.parse(await handle.json()),
  );
  if (layout.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (layout.status === 'error') return <div className={ui.empty}>{layout.error}</div>;
  if (layout.value.slides.length === 0) {
    return <div className={ui.empty}>This presentation has no slides.</div>;
  }
  return (
    <div className={preview.scroller} data-testid="presentation-view">
      <ol className={styles.list} aria-label="Slides">
        {layout.value.slides.map(s => (
          <SlideCard key={s.number} slide={s} layout={layout.value} handle={handle} />
        ))}
      </ol>
    </div>
  );
}

function SlideCard({
  slide,
  layout,
  handle,
}: {
  slide: Slide;
  layout: PresentationLayout;
  handle: ValueHandle;
}) {
  const media = slide.media.flatMap(i => {
    const m = layout.media[i];
    return m ? [{ index: i, media: m }] : [];
  });
  return (
    <li className={styles.slide} data-testid="slide">
      <span className={styles.number}>{slide.number}</span>
      <h3 className={styles.title}>
        {slide.title ?? <span className={styles.untitled}>Untitled</span>}
        {slide.hidden && <span className={styles.badge}>hidden</span>}
      </h3>
      {slide.paragraphs.length > 0 && (
        <ul className={styles.text}>
          {slide.paragraphs.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {media.length > 0 && (
        <div className={styles.thumbs}>
          {media.map(({ index, media }) => (
            <Thumb key={index} handle={handle} index={index} media={media} />
          ))}
        </div>
      )}
      {slide.notes.length > 0 && (
        <details className={styles.notes}>
          <summary>Notes</summary>
          {slide.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </details>
      )}
    </li>
  );
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** A slide's picture, fetched from the worker once it scrolls into view. */
function Thumb({
  handle,
  index,
  media,
}: {
  handle: ValueHandle;
  index: number;
  media: PresentationMedia;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const showable = SHOWABLE.test(media.path);
  const name = fileName(media.path);

  useEffect(() => {
    const el = ref.current;
    if (!el || !showable) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [showable]);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    let u: string | null = null;
    handle.asset(index).then(
      ({ bytes, mime }) => {
        if (!live) return;
        u = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setUrl(u);
      },
      () => {}, // the tile keeps showing the file name
    );
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [visible, handle, index]);

  return (
    <div ref={ref} className={styles.thumb} title={`${name} · ${formatBytes(media.size)}`}>
      {url ? <img src={url} alt={name} data-testid="slide-image" /> : name}
    </div>
  );
}
