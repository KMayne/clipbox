import { css, cx } from '@emotion/css';
import { useState } from 'react';
import type { ValueHandle } from '../../core/types';
import { theme, withAlpha } from '../../theme';
import { ModulePreview } from '../ModulePreview';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { SandboxedHtml } from './SandboxedHtml';
import { preview } from './styles';

const SOURCE_LIMIT = 1024 * 1024;

/** Inline (the CSP blocks remote stylesheets): a dark, readable document style. */
const STYLESHEET = `
:root { color-scheme: dark; accent-color: ${theme.accent}; }
::selection { background: ${withAlpha(theme.accent, 0.35)}; }
body {
  margin: 0 auto; padding: 16px 24px 48px; max-width: 760px;
  background: ${theme.bg}; color: ${theme.text};
  font: 15px/1.6 ${theme.sans};
  overflow-wrap: break-word;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.6em; }
h1, h2 { padding-bottom: 0.3em; border-bottom: 1px solid ${theme.subtle}; }
h1 { font-size: 1.9em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
a { color: ${theme.accent}; }
code, pre { font-family: ${theme.mono}; font-size: 0.88em; }
code { background: ${theme.raised}; padding: 0.1em 0.35em; border-radius: 3px; }
pre { background: ${theme.panel}; padding: 12px 14px; border-radius: 4px; overflow: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding: 0 1em; color: ${theme.muted}; border-left: 3px solid ${theme.border}; }
table { border-collapse: collapse; display: block; overflow: auto; }
th, td { border: 1px solid ${theme.border}; padding: 4px 10px; }
th { background: ${theme.panel}; }
tr:nth-child(2n) td { background: ${theme.rowBorder}; }
img { max-width: 100%; }
hr { border: none; border-top: 1px solid ${theme.subtle}; }
li > input[type=checkbox] { margin-right: 0.4em; }
`;

const active = css`
  border-color: ${theme.accent};
`;
const sourceStyle = css`
  margin: 0;
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-word;
`;

export function MarkdownView({ handle }: { handle: ValueHandle }) {
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const html = useAsync('html', () => handle.html());

  return (
    <div className={preview.column} data-testid="markdown-view">
      <div className={preview.toolbar}>
        {(['rendered', 'source'] as const).map(m => (
          <button
            key={m}
            className={cx(ui.button, mode === m && active)}
            onClick={() => setMode(m)}
          >
            {m === 'rendered' ? 'Rendered' : 'Source'}
          </button>
        ))}
      </div>
      <div className={preview.fill}>
        {mode === 'rendered' ? (
          html.status === 'ok' && (
            <SandboxedHtml
              title="Markdown preview"
              html={html.value}
              stylesheet={STYLESHEET}
              background={theme.bg}
            />
          )
        ) : (
          <ModulePreview
            module="editor"
            kind="markdown"
            handle={handle}
            fallback={<SourceFallback handle={handle} />}
          />
        )}
      </div>
    </div>
  );
}

function SourceFallback({ handle }: { handle: ValueHandle }) {
  const text = useAsync('text', () => handle.text());
  return (
    <pre className={cx(preview.scroller, sourceStyle)} data-testid="markdown-source">
      {text.status === 'ok' ? text.value.slice(0, SOURCE_LIMIT) : ''}
    </pre>
  );
}
