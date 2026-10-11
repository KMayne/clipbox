import { css, cx } from '@emotion/css';
import { useState } from 'react';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ModulePreview } from '../ModulePreview';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { SandboxedHtml } from './SandboxedHtml';
import { preview } from './styles';

const SOURCE_LIMIT = 1024 * 1024;

const styles = {
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
          <SandboxedHtml title="HTML preview" html={html.value} />
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
