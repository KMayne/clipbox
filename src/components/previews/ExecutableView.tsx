import { css, cx } from '@emotion/css';
import { mdiApplicationCogOutline, mdiCertificateOutline, mdiShieldAlertOutline } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatBytes, formatCount, plural } from '../../core/format';
import {
  executableLayoutSchema,
  type ExecSection,
  type ExecutableLayout,
  type ExportEntry,
  type ImportGroup,
} from '../../core/executable/types';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';

/** Rows rendered per list before a "show all" button; keeps huge import tables responsive. */
const PAGE = 500;
const PACKED_ENTROPY = 7.2;

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

const styles = {
  wrap: css`
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: ${theme.sans};
    font-size: var(--text-base);
  `,
  card: css`
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    padding: 12px 14px;
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
  `,
  icon: css`
    grid-row: span 3;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${theme.muted};
    img {
      max-width: 48px;
      max-height: 48px;
      image-rendering: auto;
    }
  `,
  title: css`
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 600;
    color: ${theme.text};
    overflow-wrap: anywhere;
  `,
  sub: css`
    color: ${theme.muted};
    overflow-wrap: anywhere;
  `,
  badges: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  `,
  badge: css`
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border: 1px solid ${theme.border};
    border-radius: 3px;
    font-size: var(--text-xs);
    line-height: calc(18px * var(--font-scale));
    color: ${theme.muted};
    white-space: nowrap;
  `,
  arch: css`
    color: ${theme.accent};
    border-color: ${theme.accent};
  `,
  good: css`
    color: ${theme.success};
    border-color: ${theme.success};
  `,
  warn: css`
    color: ${theme.warning};
    border-color: ${theme.warning};
  `,
  section: css`
    background: ${theme.panel};
    border: 1px solid ${theme.border};
    border-radius: 6px;
    > summary {
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
      font-weight: 600;
      color: ${theme.text};
    }
    > summary span {
      margin-left: 6px;
      font-weight: normal;
      color: ${theme.muted};
    }
  `,
  body: css`
    padding: 4px 12px 10px;
    overflow-x: auto;
  `,
  grid: css`
    display: grid;
    grid-template-columns: minmax(120px, max-content) 1fr;
    gap: 3px 18px;
    dt {
      color: ${theme.muted};
    }
    dd {
      margin: 0;
      font-family: ${theme.mono};
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
    }
  `,
  table: css`
    border-collapse: collapse;
    font-family: ${theme.mono};
    font-size: var(--text-sm);
    th {
      text-align: left;
      font-family: ${theme.sans};
      font-weight: 600;
      color: ${theme.muted};
      padding: 2px 12px 4px 0;
      white-space: nowrap;
    }
    td {
      padding: 2px 12px 2px 0;
      border-top: 1px solid ${theme.rowBorder};
      white-space: nowrap;
    }
  `,
  num: css`
    text-align: right;
  `,
  packedRow: css`
    td:first-child {
      color: ${theme.warning};
    }
  `,
  bar: css`
    display: inline-block;
    width: 80px;
    height: 8px;
    margin-right: 6px;
    vertical-align: middle;
    background: ${theme.subtle};
    border-radius: 2px;
    overflow: hidden;
    > span {
      display: block;
      height: 100%;
    }
  `,
  search: css`
    width: 100%;
    max-width: 320px;
    margin: 4px 0 8px;
    padding: 3px 8px;
    background: ${theme.bg};
    color: ${theme.text};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    font: inherit;
  `,
  dll: css`
    margin: 2px 0;
    > summary {
      cursor: pointer;
      font-family: ${theme.mono};
      font-size: var(--text-sm);
    }
    ul {
      margin: 2px 0 6px;
      padding-left: 22px;
      font-family: ${theme.mono};
      font-size: var(--text-sm);
      columns: 260px;
    }
  `,
  tag: css`
    margin-left: 6px;
    color: ${theme.muted};
    font-family: ${theme.sans};
    font-size: var(--text-xs);
  `,
  pre: css`
    margin: 0;
    font-family: ${theme.mono};
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
  icons: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
    color: ${theme.muted};
    font-size: var(--text-sm);
  `,
};

export function ExecutableView({ handle }: { handle: ValueHandle }) {
  const layout = useAsync('executable-layout', async () =>
    executableLayoutSchema.parse(await handle.json()),
  );
  if (layout.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (layout.status === 'error') return <div className={ui.empty}>{layout.error}</div>;
  const l = layout.value;
  return (
    <div className={styles.wrap} data-testid="executable-view">
      <HeaderCard layout={l} handle={handle} />
      <Section title="Headers" open>
        <dl className={styles.grid}>
          {l.header.map((r, i) => (
            <Pair key={`${r.label}-${i}`} label={r.label} value={r.value} />
          ))}
        </dl>
      </Section>
      {l.sections.length > 0 && (
        <Section title="Sections" count={l.sections.length} open>
          <SectionsTable sections={l.sections} />
        </Section>
      )}
      {l.imports.length > 0 && (
        <Section title="Imports" count={l.imports.length} note={importNote(l.imports)}>
          <Imports groups={l.imports} />
        </Section>
      )}
      {l.exports.length > 0 && (
        <Section title="Exports" count={l.exports.length}>
          <Exports exports={l.exports} />
        </Section>
      )}
      {l.resources.length > 0 && (
        <Section title="Resources" count={l.resources.reduce((n, r) => n + r.count, 0)}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Type</th>
                <th className={styles.num}>Count</th>
                <th className={styles.num}>Size</th>
              </tr>
            </thead>
            <tbody>
              {l.resources.map(r => (
                <tr key={r.type}>
                  <td>{r.type}</td>
                  <td className={styles.num}>{formatCount(r.count)}</td>
                  <td className={styles.num}>{formatBytes(r.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {l.icons.length > 0 && (
            <div className={styles.icons}>
              Icon sizes:{' '}
              {l.icons
                .map(i => `${i.width}×${i.height} ${i.bitCount}-bit${i.png ? ' PNG' : ''}`)
                .join(', ')}
            </div>
          )}
        </Section>
      )}
      {l.versionInfo.length > 0 && (
        <Section title="Version info" open>
          <dl className={styles.grid}>
            {l.versionInfo.map((r, i) => (
              <Pair key={`${r.label}-${i}`} label={r.label} value={r.value} />
            ))}
          </dl>
        </Section>
      )}
      {l.manifest !== null && (
        <Section title="Manifest">
          <pre className={styles.pre}>{l.manifest}</pre>
        </Section>
      )}
      {l.warnings.length > 0 && (
        <Section title="Warnings" count={l.warnings.length}>
          <ul>
            {l.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function importNote(groups: ImportGroup[]) {
  const fns = groups.reduce((n, g) => n + g.functions.length, 0);
  return fns > 0 ? plural(fns, 'function') : null;
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function Section({
  title,
  count,
  note,
  open = false,
  children,
}: {
  title: string;
  count?: number;
  note?: string | null;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className={styles.section} open={open} data-testid="exe-section" data-title={title}>
      <summary>
        {title}
        {count !== undefined && <span>{formatCount(count)}</span>}
        {note && <span>· {note}</span>}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}

function HeaderCard({ layout: l, handle }: { layout: ExecutableLayout; handle: ValueHandle }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    if (!l.hasIcon) return;
    let live = true;
    let url: string | null = null;
    handle.image().then(
      ({ bytes, mime }) => {
        if (!live) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setIcon(url);
      },
      () => {}, // keeps the generic icon
    );
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [handle, l.hasIcon]);

  const name = l.product ?? l.description ?? l.title;
  const sub = [
    l.version ? `v${l.version}` : null,
    l.company,
    l.description !== name ? l.description : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const signTone =
    l.signing.state === 'signed' ? styles.good : l.signing.state === 'unsigned' ? '' : styles.warn;
  return (
    <div className={styles.card} data-testid="executable-header">
      <div className={styles.icon}>
        {icon ? (
          <img src={icon} alt="Program icon" data-testid="executable-icon" />
        ) : (
          <Icon path={mdiApplicationCogOutline} size={1.6} />
        )}
      </div>
      <h3 className={styles.title}>{name}</h3>
      {(sub || name !== l.title) && <div className={styles.sub}>{sub || l.title}</div>}
      <div className={styles.badges}>
        {l.arch.map(a => (
          <span key={a} className={cx(styles.badge, styles.arch)}>
            {a}
          </span>
        ))}
        <span className={styles.badge}>{l.formatName}</span>
        <span className={cx(styles.badge, signTone)} data-testid="signing-badge">
          <Icon
            path={l.signing.state === 'unsigned' ? mdiShieldAlertOutline : mdiCertificateOutline}
            size={0.5}
          />
          {l.signing.text}
        </span>
        {l.badges.map(b => (
          <span
            key={b.text}
            className={cx(
              styles.badge,
              b.tone === 'good' ? styles.good : b.tone === 'warn' ? styles.warn : '',
            )}
          >
            {b.text}
          </span>
        ))}
      </div>
    </div>
  );
}

function entropyColour(h: number) {
  return h > PACKED_ENTROPY ? theme.error : h > 6.5 ? theme.warning : theme.success;
}

function SectionsTable({ sections }: { sections: ExecSection[] }) {
  const grouped = sections.some(s => s.group !== null);
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Name</th>
          {grouped && <th>Segment</th>}
          <th>Address</th>
          <th className={styles.num}>Virtual size</th>
          <th className={styles.num}>Raw size</th>
          <th>Flags</th>
          <th>Entropy</th>
        </tr>
      </thead>
      <tbody>
        {sections.map((s, i) => (
          <tr
            key={i}
            className={s.packed ? styles.packedRow : undefined}
            data-testid="section-row"
            title={s.packed ? 'Looks packed or compressed' : undefined}
          >
            <td>{s.name || '(unnamed)'}</td>
            {grouped && <td>{s.group}</td>}
            <td>{hex(s.address)}</td>
            <td className={styles.num}>{formatBytes(s.virtualSize)}</td>
            <td className={styles.num}>{formatBytes(s.rawSize)}</td>
            <td>{s.flags}</td>
            <td>
              {s.entropy === null ? (
                '—'
              ) : (
                <>
                  <span className={styles.bar} aria-hidden>
                    <span
                      style={{
                        width: `${(s.entropy / 8) * 100}%`,
                        background: entropyColour(s.entropy),
                      }}
                    />
                  </span>
                  {s.entropy.toFixed(2)}
                  {s.packed && <span className={styles.tag}>packed?</span>}
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Imports({ groups }: { groups: ImportGroup[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? groups.flatMap(g => {
            if (g.library.toLowerCase().includes(q)) return [g];
            const functions = g.functions.filter(f =>
              (f.name ?? `#${f.ordinal}`).toLowerCase().includes(q),
            );
            return functions.length ? [{ ...g, functions }] : [];
          })
        : groups,
    [groups, q],
  );
  const hasFunctions = groups.some(g => g.functions.length > 0);
  return (
    <>
      <input
        className={styles.search}
        type="search"
        placeholder="Filter libraries and functions"
        aria-label="Filter imports"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {shown.length === 0 && <div className={ui.muted}>No matches</div>}
      {shown.map(g =>
        hasFunctions ? (
          <ImportGroupView key={`${g.library}-${g.delay}`} group={g} open={q !== ''} />
        ) : (
          <div key={g.library} className={ui.mono} data-testid="import-dll">
            {g.library}
            {g.weak && <span className={styles.tag}>weak</span>}
          </div>
        ),
      )}
    </>
  );
}

function ImportGroupView({ group: g, open }: { group: ImportGroup; open: boolean }) {
  const [all, setAll] = useState(false);
  const fns = all ? g.functions : g.functions.slice(0, PAGE);
  return (
    <details className={styles.dll} open={open} data-testid="import-dll">
      <summary>
        {g.library}
        <span className={styles.tag}>
          {plural(g.functions.length, 'function')}
          {g.delay && ' · delay-loaded'}
        </span>
      </summary>
      <ul>
        {fns.map((f, i) => (
          <li key={i}>{f.name ?? `ordinal ${f.ordinal ?? '?'}`}</li>
        ))}
      </ul>
      {!all && g.functions.length > PAGE && (
        <button className={ui.button} onClick={() => setAll(true)}>
          Show all {formatCount(g.functions.length)}
        </button>
      )}
    </details>
  );
}

function Exports({ exports }: { exports: ExportEntry[] }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? exports.filter(e =>
            `${e.name ?? ''} ${e.forwarder ?? ''} ${e.ordinal ?? ''}`.toLowerCase().includes(q),
          )
        : exports,
    [exports, q],
  );
  const rows = all ? matches : matches.slice(0, PAGE);
  const ordinals = exports.some(e => e.ordinal !== null);
  return (
    <>
      <input
        className={styles.search}
        type="search"
        placeholder="Filter exports"
        aria-label="Filter exports"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <table className={styles.table}>
        <thead>
          <tr>
            {ordinals && <th className={styles.num}>Ordinal</th>}
            <th>Name</th>
            <th>Address</th>
            <th>Forwarded to</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={i}>
              {ordinals && <td className={styles.num}>{e.ordinal ?? ''}</td>}
              <td>{e.name ?? <span className={ui.muted}>(by ordinal)</span>}</td>
              <td>{hex(e.address)}</td>
              <td>{e.forwarder ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!all && matches.length > PAGE && (
        <button className={ui.button} onClick={() => setAll(true)}>
          Show all {formatCount(matches.length)}
        </button>
      )}
    </>
  );
}
