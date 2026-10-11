import { css, cx } from '@emotion/css';
import { mdiContentCopy, mdiLightningBoltOutline } from '@mdi/js';
import { Icon } from '@mdi/react';
import { copySelection } from '../capture/copyToClipboard';
import type { ValueHandle } from '../core/types';
import { getHandle } from '../engine/valueHandle';
import { findEntry, useCaptureStore, type Selection } from '../state/captureStore';
import { useUiStore, type InspectorTab } from '../state/uiStore';
import { kindColor, theme } from '../theme';
import { HexView } from './previews/HexView';
import { HtmlView } from './previews/HtmlView';
import { ImageView } from './previews/ImageView';
import { JsonTree } from './previews/JsonTree';
import { MarkdownView } from './previews/MarkdownView';
import { MediaView } from './previews/MediaView';
import { ModulePreview } from './ModulePreview';
import { ArchiveView } from './previews/ArchiveView';
import { Base64Preview } from './previews/Base64Preview';
import { JwtView } from './previews/JwtView';
import { RecordsTable } from './previews/RecordsTable';
import { PdfView } from './previews/PdfView';
import { PemView } from './previews/PemView';
import { SpreadsheetView } from './previews/SpreadsheetView';
import { SqliteView } from './previews/SqliteView';
import { TextView } from './previews/TextView';
import { ValueCard } from './previews/ValueCard';
import { RawView } from './RawView';
import { SchemaView } from './SchemaView';
import { StatsGrid } from './StatsGrid';
import { ui } from './ui';
import { useAsync } from './useAsync';

/** Above this, Monaco gets sluggish; use the lightweight virtualised view. */
const MONACO_MAX_BYTES = 20 * 1024 * 1024;

const TABS: InspectorTab[] = ['preview', 'stats', 'schema', 'raw'];

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
  `,
  kind: css`
    padding: 0 6px;
    border-radius: 3px;
    color: ${theme.onAccent};
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
  `,
  source: css`
    color: ${theme.muted};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  actions: css`
    margin-left: auto;
    display: flex;
    gap: 6px;
  `,
  tabs: css`
    display: flex;
    gap: 2px;
    padding: 0 8px;
    border-bottom: 1px solid ${theme.subtle};
  `,
  tab: css`
    padding: 6px 10px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: ${theme.muted};
    cursor: pointer;
    text-transform: capitalize;
    &:hover {
      color: ${theme.text};
    }
  `,
  activeTab: css`
    color: ${theme.text};
    border-bottom-color: ${theme.accent};
  `,
  body: css`
    flex: 1;
    min-height: 0;
    position: relative;
  `,
};

export function Inspector() {
  const selection = useCaptureStore(s => s.selection);
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
  const tab = useUiStore(s => s.tab);
  const setTab = useUiStore(s => s.setTab);
  const actionsOpen = useUiStore(s => s.actionsOpen);
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
        <span>{handle.status === 'ok' ? handle.value.summary.label : '…'}</span>
        <span className={styles.source}>{entry?.name ?? entry?.mime}</span>
        <span className={styles.actions}>
          <button
            className={ui.button}
            aria-pressed={actionsOpen}
            title={`${actionsOpen ? 'Hide' : 'Show'} actions (A)`}
            onClick={() => useUiStore.getState().toggleActions()}
          >
            <Icon path={mdiLightningBoltOutline} size={0.6} />
            Actions
          </button>
          <button className={ui.button} onClick={() => void copySelection(selection)}>
            <Icon path={mdiContentCopy} size={0.6} />
            Copy
          </button>
        </span>
      </div>
      <div className={styles.tabs} role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            title={`Shortcut: ${i + 1}`}
            className={cx(styles.tab, tab === t && styles.activeTab)}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className={styles.body} role="tabpanel">
        {handle.status === 'loading' && <div className={ui.empty}>Loading…</div>}
        {handle.status === 'error' && <div className={ui.empty}>{handle.error}</div>}
        {handle.status === 'ok' && (
          <TabBody tab={tab} handle={handle.value} selection={selection} />
        )}
      </div>
    </section>
  );
}

function TabBody({
  tab,
  handle,
  selection,
}: {
  tab: InspectorTab;
  handle: ValueHandle;
  selection: Selection;
}) {
  switch (tab) {
    case 'stats':
      return <StatsGrid rows={handle.summary.stats} />;
    case 'schema':
      return <SchemaView schema={handle.summary.schema} />;
    case 'raw':
      return <RawView entryId={selection.entryId} />;
    case 'preview':
      return <Preview handle={handle} selection={selection} />;
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
    default:
      return <HexView handle={handle} />;
  }
}
