import { css, cx } from '@emotion/css';
import { mdiChevronDown, mdiChevronRight } from '@mdi/js';
import { Icon } from '@mdi/react';
import type { ReactNode } from 'react';
import { formatBytes, formatCount } from '../core/format';
import { kindName } from '../core/kinds';
import type { CaptureId, StatRow } from '../core/types';
import { getHandle } from '../engine/valueHandle';
import { useCaptureStore, type Selection } from '../state/captureStore';
import { useUiStore, type SidebarSection } from '../state/uiStore';
import { theme } from '../theme';
import { ActionsSection } from './ActionsPane';
import { SchemaView } from './SchemaView';
import { StatsGrid } from './StatsGrid';
import { ui } from './ui';
import { useAsync } from './useAsync';

const styles = {
  sidebar: css`
    display: flex;
    flex-direction: column;
    height: 100%;
    background: ${theme.panel};
  `,
  section: css`
    display: flex;
    flex-direction: column;
    min-height: 0;
    & + & {
      border-top: 1px solid ${theme.subtle};
    }
  `,
  /** Info sizes to its content but never crowds out Actions. */
  info: css`
    flex: 0 1 auto;
    max-height: 45%;
  `,
  /** Takes the rest; when Info is collapsed, all of it. */
  grow: css`
    flex: 1 1 0;
    max-height: none;
  `,
  heading: css`
    display: flex;
    align-items: center;
    min-height: 32px;
  `,
  toggle: css`
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px 4px 6px;
    background: none;
    border: none;
    color: ${theme.muted};
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-align: left;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      color: ${theme.text};
    }
  `,
  body: css`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  `,
};

/** The right sidebar: Info (the value's stats) and Actions, each collapsible. `A` or the top bar's toggle hides it. */
export function Sidebar() {
  const sections = useUiStore(s => s.sections);
  return (
    <aside className={styles.sidebar} aria-label="Sidebar">
      <Section id="info" title="Info" className={cx(styles.info, !sections.actions && styles.grow)}>
        <InfoSection />
      </Section>
      <Section id="actions" title="Actions" className={cx(sections.actions && styles.grow)}>
        <ActionsSection />
      </Section>
      <Section id="schema" title="Schema" className={styles.info}>
        <SchemaSection />
      </Section>
    </aside>
  );
}

function Section({
  id,
  title,
  className,
  children,
}: {
  id: SidebarSection;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  const expanded = useUiStore(s => s.sections[id]);
  const bodyId = `sidebar-${id}`;
  return (
    <section className={cx(styles.section, className)} aria-label={title}>
      <div className={styles.heading}>
        <button
          className={styles.toggle}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => useUiStore.getState().toggleSection(id)}
        >
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
          {title.toUpperCase()}
        </button>
      </div>
      {expanded && (
        <div id={bodyId} className={styles.body}>
          {children}
        </div>
      )}
    </section>
  );
}

function InfoSection() {
  const selection = useCaptureStore(s => s.selection);
  const collection = useCaptureStore(s => s.collection);
  if (collection) return <CollectionInfo captureId={collection} />;
  if (!selection) return <div className={ui.empty}>Select a value to see its info</div>;
  return <SelectionInfo key={`${selection.entryId}:${selection.kind}`} selection={selection} />;
}

function SelectionInfo({ selection }: { selection: Selection }) {
  const handle = useAsync(`${selection.entryId}:${selection.kind}`, () =>
    getHandle(selection.entryId, selection.kind),
  );
  if (handle.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (handle.status === 'error') return <div className={ui.empty}>{handle.error}</div>;
  return <StatsGrid rows={handle.value.summary.stats} compact />;
}

function CollectionInfo({ captureId }: { captureId: CaptureId }) {
  const capture = useCaptureStore(s => s.captures.find(c => c.id === captureId));
  if (!capture) return null;
  const counts = new Map<string, number>();
  for (const e of capture.entries) {
    const kind = e.interpretations[0]?.kind;
    const name = kind ? kindName(kind) : e.mime || 'Unknown';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const rows: StatRow[] = [
    { label: 'Items', value: formatCount(capture.entries.length) },
    { label: 'Total size', value: formatBytes(capture.entries.reduce((n, e) => n + e.size, 0)) },
    {
      label: 'Kinds',
      value: String(counts.size),
      children: [...counts].map(([label, n]) => ({ label, value: formatCount(n) })),
    },
  ];
  return <StatsGrid rows={rows} compact />;
}

function SchemaSection() {
  const selection = useCaptureStore(s => s.selection);
  if (!selection) return <div className={ui.empty}>Select a value to see its schema</div>;
  return <SelectionSchema key={`${selection.entryId}:${selection.kind}`} selection={selection} />;
}

function SelectionSchema({ selection }: { selection: Selection }) {
  const handle = useAsync(`${selection.entryId}:${selection.kind}`, () =>
    getHandle(selection.entryId, selection.kind),
  );
  if (handle.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (handle.status === 'error') return <div className={ui.empty}>{handle.error}</div>;
  return <SchemaView schema={handle.value.summary.schema} />;
}
