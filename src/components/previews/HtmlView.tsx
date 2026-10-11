import { css, cx } from '@emotion/css';
import { useState } from 'react';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ModulePreview } from '../ModulePreview';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { preview } from './styles';

// No scripts (sandbox) and no network: blocks tracking pixels and remote CSS in pasted HTML.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:">`;
const SOURCE_LIMIT = 1024 * 1024;

const styles = {
  frame: css`
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  `,
  source: css`
    margin: 0;
    padding: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  `,
  active: css`
    border-color: ${theme.accent};
  `,
};

export function HtmlView({ handle }: { handle: ValueHandle }) {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const html = useAsync('text', () => handle.text());
  if (html.status !== 'ok') return null;

  return (
    <div className={preview.column}>
      <div className={preview.toolbar}>
        {(['rendered', 'source'] as const).map(m => (
          <button
            key={m}
            className={cx(ui.button, mode === m && styles.active)}
            onClick={() => setMode(m)}
          >
            {m === 'rendered' ? 'Rendered' : 'Source'}
          </button>
        ))}
      </div>
      <div className={preview.fill}>
        {mode === 'rendered' ? (
          <iframe
            title="HTML preview"
            className={styles.frame}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={CSP + html.value}
          />
        ) : (
          <ModulePreview
            module="editor"
            kind="html"
            handle={handle}
            fallback={
              <pre className={cx(preview.scroller, styles.source)}>
                {html.value.slice(0, SOURCE_LIMIT)}
              </pre>
            }
          />
        )}
      </div>
    </div>
  );
}
