import { css, cx } from '@emotion/css';
import { useEffect, useState } from 'react';
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
};

export function ImageView({ handle }: { handle: ValueHandle }) {
  const [fit, setFit] = useState(true);
  const image = useAsync('image', () => handle.image());
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
      </div>
      <div className={preview.fill}>
        <div className={styles.stage}>
          {url && <img src={url} alt="" className={cx(styles.img, fit && styles.fit)} />}
        </div>
      </div>
    </div>
  );
}
