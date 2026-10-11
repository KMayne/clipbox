import { css } from '@emotion/css';
import type { ValueHandle } from '../../core/types';
import { ModulePreview } from '../ModulePreview';
import { useAsync } from '../useAsync';
import { HexView } from './HexView';
import { ImageView } from './ImageView';
import { preview } from './styles';

const styles = {
  pre: css`
    margin: 0;
    padding: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  `,
};

/** Decoded content: text (Monaco if available), an image, or hex for anything else. */
export function Base64Preview({ handle }: { handle: ValueHandle }) {
  // The interpreter sets a language only when the decoded bytes are (non-image) text
  if (handle.summary.language) {
    return (
      <ModulePreview
        module="editor"
        kind="text"
        handle={handle}
        fallback={<PlainText handle={handle} />}
      />
    );
  }
  return <ImageOrHex handle={handle} />;
}

function ImageOrHex({ handle }: { handle: ValueHandle }) {
  const image = useAsync('probe-image', () => handle.image().then(() => true));
  if (image.status === 'loading') return null;
  return image.status === 'ok' ? <ImageView handle={handle} /> : <HexView handle={handle} />;
}

function PlainText({ handle }: { handle: ValueHandle }) {
  const text = useAsync('text', () => handle.text());
  if (text.status !== 'ok') return null;
  return (
    <pre className={`${preview.scroller} ${styles.pre}`} data-testid="text-view">
      {text.value}
    </pre>
  );
}
