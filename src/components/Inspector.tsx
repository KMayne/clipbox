import { css, cx } from '@emotion/css';
import { mdiContentCopy, mdiDownload } from '@mdi/js';
import { Icon } from '@mdi/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { copySelection } from '../capture/copyToClipboard';
import { downloadEntry } from '../capture/saveFiles';
import type { ValueHandle } from '../core/types';
import { getHandle } from '../engine/valueHandle';
import { findEntry, useCaptureStore, type Selection } from '../state/captureStore';
import { showView } from '../commands';
import { useUiStore, type InspectorView } from '../state/uiStore';
import { viewFor, viewsFor } from '../state/views';
import { kindColor, theme } from '../theme';
import { HexView } from './previews/HexView';
import { HtmlView } from './previews/HtmlView';
import { ImageView } from './previews/ImageView';
import { JsonTree } from './previews/JsonTree';
import { MarkdownView } from './previews/MarkdownView';
import { MediaView } from './previews/MediaView';
import { CollectionView } from './CollectionView';
import { ModulePreview } from './ModulePreview';
import { ArchiveView } from './previews/ArchiveView';
import { Base64Preview } from './previews/Base64Preview';
import { JwtView } from './previews/JwtView';
import { RecordsTable } from './previews/RecordsTable';
import { PdfView } from './previews/PdfView';
import { PemView } from './previews/PemView';
import { PresentationView } from './previews/PresentationView';
import { SpreadsheetView } from './previews/SpreadsheetView';
import { SqliteView } from './previews/SqliteView';
import { TextView } from './previews/TextView';
import { ValueCard } from './previews/ValueCard';
import { HexSource, RawView } from './RawView';
import { media, TOUCH_TARGET, ui } from './ui';
import { useAsync } from './useAsync';
import { useIsMobile } from './useMediaQuery';

/** Above this, Monaco gets sluggish; use the lightweight virtualised view. */
const MONACO_MAX_BYTES = 20 * 1024 * 1024;

const styles = {
  inspector: css`
    display: flex;
    flex-direction: column;
    height: 100%;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid ${theme.subtle};
    ${media.mobile} {
      flex-wrap: wrap;
    }
  `,
  kind: css`
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: 3px;
    color: ${theme.onAccent};
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
  `,
  label: css`
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  source: css`
    flex: 0 1 auto;
    min-width: 0;
    color: ${theme.muted};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  actions: css`
    flex-shrink: 0;
    margin-left: auto;
    display: flex;
    gap: 6px;
    ${media.mobile} {
      flex-shrink: 1;
      min-width: 0;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  `,
  views: css`
    display: inline-flex;
    border: 1px solid ${theme.border};
    border-radius: 4px;
    overflow: hidden;
  `,
  viewButton: css`
    padding: 3px 10px;
    ${media.touch} {
      min-height: ${TOUCH_TARGET};
    }
    background: none;
    border: none;
    color: ${theme.muted};
    font-size: 12px;
    cursor: pointer;
    & + & {
      border-left: 1px solid ${theme.border};
    }
    &:hover:enabled {
      color: ${theme.text};
      background: ${theme.hover};
    }
    &:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `,
  activeView: css`
    color: ${theme.text};
    background: ${theme.raised};
  `,
  split: css`
    height: 100%;
  `,
  /** Previews size themselves against their container, so each half must be one. */
  pane: css`
    position: relative;
    height: 100%;
  `,
  separator: css`
    width: 1px;
    background: ${theme.subtle};
    /* Phones split top and bottom */
    ${media.mobile} {
      width: auto;
      height: 1px;
    }
    &[data-separator='hover'],
    &[data-separator='active'] {
      background: ${theme.accent};
    }
  `,
  body: css`
    flex: 1;
    min-height: 0;
    position: relative;
  `,
};

export function Inspector() {
  const selection = useCaptureStore(s => s.selection);
  const collection = useCaptureStore(s => s.collection);
  if (collection) return <CollectionView key={collection} captureId={collection} />;
  if (!selection) {
    return (
      <div className={ui.empty}>
        Paste (<kbd className={ui.kbd}>Ctrl+V</kbd>), drop a file, or press{' '}
        <kbd className={ui.kbd}>Ctrl+K</kbd>
      </div>
    );
  }
  return (
    <SelectionInspector key={`${selection.entryId}:${selection.kind}`} selection={selection} />
  );
}

function SelectionInspector({ selection }: { selection: Selection }) {
  const view = useUiStore(s => viewFor(selection.kind, s.views));
  const options = viewsFor(selection.kind);
  const entry = useCaptureStore(s => findEntry(s.captures, selection.entryId)?.entry);
  const handle = useAsync(`${selection.entryId}:${selection.kind}`, () =>
    getHandle(selection.entryId, selection.kind),
  );

  return (
    <section className={styles.inspector} aria-label="Inspector">
      <div className={styles.header}>
        <span className={styles.kind} style={{ background: kindColor(selection.kind) }}>
          {selection.kind}
        </span>
        <span className={styles.label}>
          {handle.status === 'ok' ? handle.value.summary.label : '…'}
        </span>
        <span className={styles.source}>{entry?.name ?? entry?.mime}</span>
        <span className={styles.actions}>
          <span className={styles.views} role="group" aria-label="View">
            {options.map((v, i) => (
              <button
                key={v.view}
                className={cx(styles.viewButton, view === v.view && styles.activeView)}
                aria-pressed={view === v.view}
                title={`${v.label} (${i + 1})`}
                onClick={() => showView(v.view)}
              >
                {v.label}
              </button>
            ))}
          </span>
          <button className={ui.button} onClick={() => void copySelection(selection)}>
            <Icon path={mdiContentCopy} size={0.6} />
            Copy
          </button>
          <button
            className={ui.button}
            title="Download the original bytes"
            onClick={() => downloadEntry(selection.entryId)}
          >
            <Icon path={mdiDownload} size={0.6} />
            Download
          </button>
        </span>
      </div>
      <div className={styles.body} role="region" aria-label="View">
        {handle.status === 'loading' && <div className={ui.empty}>Loading…</div>}
        {handle.status === 'error' && <div className={ui.empty}>{handle.error}</div>}
        {handle.status === 'ok' && (
          <ViewBody view={view} handle={handle.value} selection={selection} />
        )}
      </div>
    </section>
  );
}

function ViewBody({
  view,
  handle,
  selection,
}: {
  view: InspectorView;
  handle: ValueHandle;
  selection: Selection;
}) {
  // Phones stack the source above the preview
  const mobile = useIsMobile();
  switch (view) {
    case 'rendered':
      return <Preview handle={handle} selection={selection} />;
    case 'text':
      // Plain text's rendering is its text (the editor view)
      return selection.kind === 'text' ? (
        <Preview handle={handle} selection={selection} />
      ) : (
        <RawView entryId={selection.entryId} />
      );
    case 'hex':
      return <HexSource entryId={selection.entryId} />;
    case 'split':
      return (
        <Group className={styles.split} orientation={mobile ? 'vertical' : 'horizontal'}>
          <Panel id="raw" defaultSize="50" minSize={160}>
            <div className={styles.pane}>
              <RawView entryId={selection.entryId} />
            </div>
          </Panel>
          <Separator className={styles.separator} />
          <Panel id="preview" minSize={160}>
            <div className={styles.pane}>
              <Preview handle={handle} selection={selection} />
            </div>
          </Panel>
        </Group>
      );
  }
}

function Preview({ handle, selection }: { handle: ValueHandle; selection: Selection }) {
  switch (handle.summary.kind) {
    case 'json':
    case 'yaml':
    case 'xml':
    case 'ndjson':
      return <JsonTree handle={handle} />;
    case 'markdown':
      return <MarkdownView handle={handle} />;
    case 'records':
      return <RecordsTable handle={handle} />;
    case 'text':
      return handle.summary.bytes <= MONACO_MAX_BYTES ? (
        <ModulePreview
          module="editor"
          kind="text"
          handle={handle}
          fallback={<TextView handle={handle} />}
        />
      ) : (
        <TextView handle={handle} />
      );
    case 'html':
      return <HtmlView handle={handle} />;
    case 'image':
      return <ImageView handle={handle} />;
    case 'base64':
      return <Base64Preview handle={handle} />;
    case 'jwt':
      return <JwtView handle={handle} />;
    case 'timestamp':
    case 'uuid':
    case 'url':
    case 'colour':
      return <ValueCard handle={handle} />;
    case 'pem':
      return <PemView handle={handle} />;
    case 'audio':
    case 'video':
      return <MediaView handle={handle} />;
    case 'spreadsheet':
      return <SpreadsheetView handle={handle} selection={selection} />;
    case 'sqlite':
      return <SqliteView handle={handle} />;
    case 'pdf':
      return <PdfView handle={handle} />;
    case 'archive':
      return <ArchiveView handle={handle} />;
    case 'presentation':
      return <PresentationView handle={handle} />;
    default:
      return <HexView handle={handle} />;
  }
}
