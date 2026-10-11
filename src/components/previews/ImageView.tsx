import { css, cx } from '@emotion/css';
import { useEffect, useState } from 'react';
import { imageLayoutSchema } from '../../core/interpreters/image';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { preview } from './styles';

const styles = {
  stage: css`
    position: absolute;
    inset: 0;
    overflow: auto;
    display: flex;
    padding: 16px;
  `,
  img: css`
    margin: auto;
    background-color: #fff;
    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  `,
  fit: css`
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  `,
  active: css`
    border-color: ${theme.accent};
  `,
  pager: css`
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    color: ${theme.muted};
  `,
};

export function ImageView({ handle }: { handle: ValueHandle }) {
  const [fit, setFit] = useState(true);
  const [page, setPage] = useState(0);
  // Multi-page images (TIFF) list their pages in the `json` slice
  const layout = useAsync('image-layout', async () =>
    handle.summary.kind === 'image' ? imageLayoutSchema.parse(await handle.json()).pages.length : 1,
  );
  const pages = layout.status === 'ok' ? layout.value : 1;
  const image = useAsync(`image-${page}`, () =>
    page === 0 ? handle.image() : handle.page(page, 1),
  );
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (image.status !== 'ok') return;
    const u = URL.createObjectURL(new Blob([image.value.bytes], { type: image.value.mime }));
    // Object URL lifetime must follow the effect (StrictMode remounts would revoke a memoised one)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image]);

  return (
    <div className={preview.column}>
      <div className={preview.toolbar}>
        <button className={cx(ui.button, fit && styles.active)} onClick={() => setFit(true)}>
          Fit
        </button>
        <button className={cx(ui.button, !fit && styles.active)} onClick={() => setFit(false)}>
          1:1
        </button>
        {pages > 1 && (
          <div className={styles.pager} data-testid="image-pages">
            <button
              className={ui.button}
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              ‹
            </button>
            <span>
              Page {page + 1} / {pages}
            </span>
            <button
              className={ui.button}
              aria-label="Next page"
              disabled={page >= pages - 1}
              onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
            >
              ›
            </button>
          </div>
        )}
      </div>
      <div className={preview.fill}>
        <div className={styles.stage}>
          {url && (
            <img
              src={url}
              alt=""
              data-testid="image-view"
              className={cx(styles.img, fit && styles.fit)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
