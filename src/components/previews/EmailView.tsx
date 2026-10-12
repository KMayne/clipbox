import { css } from '@emotion/css';
import { Fragment, useEffect, useState } from 'react';
import { emailLayoutSchema, ATTACHMENT_PREFIX, type EmailLayout } from '../../core/email/types';
import { formatBytes } from '../../core/format';
import type { ValueHandle } from '../../core/types';
import { runDerivation } from '../../state/actions';
import { useCaptureStore, type Selection } from '../../state/captureStore';
import { scaled, theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { SandboxedHtml } from './SandboxedHtml';
import { preview } from './styles';

/** Image types a tile can show as a thumbnail. */
const SHOWABLE = /^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon)$/;
const THUMB = 64;

/** Email HTML is written for a light page; this only sets a readable default and fits images. */
const STYLESHEET = `
body { margin: 12px 16px; font: ${scaled(14)}px/1.5 ${theme.sans}; overflow-wrap: break-word; }
img { max-width: 100%; height: auto; }
table { max-width: 100%; }
`;

const styles = {
  card: css`
    flex: none;
    padding: 10px 16px;
    background: ${theme.panel};
    border-bottom: 1px solid ${theme.border};
    font-family: ${theme.sans};
    font-size: var(--text-base);
    max-height: 40%;
    overflow: auto;
  `,
  fields: css`
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 12px;
    margin: 0;
    dt {
      color: ${theme.muted};
    }
    dd {
      margin: 0;
      color: ${theme.text};
      overflow-wrap: anywhere;
    }
  `,
  subject: css`
    margin: 0 0 6px;
    font-size: var(--text-lg);
    font-weight: 600;
    color: ${theme.text};
    overflow-wrap: anywhere;
  `,
  note: css`
    flex: none;
    padding: 4px 16px;
    border-bottom: 1px solid ${theme.subtle};
    color: ${theme.muted};
    font-family: ${theme.sans};
    font-size: var(--text-sm);
  `,
  text: css`
    margin: 0;
    padding: 12px 16px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: ${theme.text};
  `,
  tiles: css`
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 16px;
    border-top: 1px solid ${theme.border};
    background: ${theme.panel};
    max-height: 30%;
    overflow: auto;
    font-family: ${theme.sans};
  `,
  tile: css`
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 260px;
    padding: 4px 8px 4px 4px;
    background: ${theme.raised};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    color: ${theme.text};
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
    &:hover {
      background: ${theme.hover};
    }
  `,
  thumb: css`
    flex: none;
    width: ${THUMB}px;
    height: ${THUMB}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${theme.subtle};
    border-radius: 3px;
    overflow: hidden;
    color: ${theme.muted};
    font-size: var(--text-2xs);
    text-transform: uppercase;
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  `,
  name: css`
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
};

/** The message: a header card, its body (HTML sandboxed, else text) and attachment tiles. */
export function EmailView({ handle }: { handle: ValueHandle }) {
  const selection = useCaptureStore(s => s.selection);
  const key = selection?.entryId ?? '';
  const layout = useAsync(`email-layout:${key}`, async () =>
    emailLayoutSchema.parse(await handle.json()),
  );
  if (layout.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (layout.status === 'error') return <div className={ui.empty}>{layout.error}</div>;
  const l = layout.value;
  return (
    <div className={preview.column} data-testid="email-view">
      <HeaderCard layout={l} />
      {l.blockedImages > 0 && (
        <div className={styles.note} data-testid="email-blocked">
          {l.blockedImages === 1
            ? '1 remote image was blocked'
            : `${l.blockedImages} remote images were blocked`}{' '}
          (they could tell the sender you opened this).
        </div>
      )}
      <div className={preview.fill}>
        {l.body === 'html' && <HtmlBody handle={handle} entryKey={key} />}
        {l.body === 'text' && <TextBody handle={handle} entryKey={key} />}
        {l.body === 'none' && <div className={ui.empty}>This message has no body.</div>}
      </div>
      <Attachments layout={l} handle={handle} selection={selection} />
    </div>
  );
}

function HeaderCard({ layout }: { layout: EmailLayout }) {
  const rows: [string, string | null][] = [
    ['From', layout.from],
    ['To', layout.to],
    ['Cc', layout.cc],
    ['Reply-To', layout.replyTo],
    ['Date', layout.date],
    ['Checks', layout.auth.map(a => `${a.method.toUpperCase()} ${a.text}`).join(' · ')],
  ];
  return (
    <div className={styles.card} data-testid="email-headers">
      <h3 className={styles.subject}>{layout.subject || '(no subject)'}</h3>
      <dl className={styles.fields} aria-label="Message headers">
        {rows.map(([label, value]) =>
          value ? (
            <Fragment key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </Fragment>
          ) : null,
        )}
      </dl>
    </div>
  );
}

function HtmlBody({ handle, entryKey }: { handle: ValueHandle; entryKey: string }) {
  const html = useAsync(`email-html:${entryKey}`, () => handle.html());
  if (html.status === 'error') return <div className={ui.empty}>{html.error}</div>;
  if (html.status !== 'ok') return null;
  return <SandboxedHtml title="Email body" html={html.value} stylesheet={STYLESHEET} />;
}

function TextBody({ handle, entryKey }: { handle: ValueHandle; entryKey: string }) {
  const text = useAsync(`email-text:${entryKey}`, () => handle.text());
  if (text.status === 'error') return <div className={ui.empty}>{text.error}</div>;
  if (text.status !== 'ok') return null;
  return (
    <div className={preview.scroller}>
      <pre className={styles.text}>{text.value}</pre>
    </div>
  );
}

function Attachments({
  layout,
  handle,
  selection,
}: {
  layout: EmailLayout;
  handle: ValueHandle;
  selection: Selection | null;
}) {
  const files = layout.attachments.flatMap((a, index) => (a.inline ? [] : [{ a, index }]));
  if (files.length === 0) return null;
  return (
    <div className={styles.tiles} role="list" aria-label="Attachments">
      {files.map(({ a, index }) => (
        <button
          key={index}
          role="listitem"
          className={styles.tile}
          title={`Open ${a.name} (${a.mime})`}
          data-testid="email-attachment"
          disabled={!selection}
          onClick={() => {
            if (selection) {
              void runDerivation(selection, { id: `${ATTACHMENT_PREFIX}${index}`, label: a.name });
            }
          }}
        >
          <Thumb handle={handle} index={index} mime={a.mime} name={a.name} />
          <span style={{ minWidth: 0 }}>
            <span className={styles.name}>{a.name}</span>
            <span className={ui.muted}>{formatBytes(a.size)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** An image attachment's picture, else its extension. */
function Thumb({
  handle,
  index,
  mime,
  name,
}: {
  handle: ValueHandle;
  index: number;
  mime: string;
  name: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const showable = SHOWABLE.test(mime);
  useEffect(() => {
    if (!showable) return;
    let live = true;
    let u: string | null = null;
    handle.asset(index).then(
      ({ bytes, mime }) => {
        if (!live) return;
        u = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setUrl(u);
      },
      () => {}, // the tile keeps showing the extension
    );
    return () => {
      live = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [handle, index, showable]);
  const ext = /\.([^.]{1,5})$/.exec(name)?.[1] ?? 'file';
  return <span className={styles.thumb}>{url ? <img src={url} alt="" /> : ext}</span>;
}
