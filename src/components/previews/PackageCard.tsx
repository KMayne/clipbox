import { css, cx } from '@emotion/css';
import { mdiAlertOutline, mdiPackageVariantClosed } from '@mdi/js';
import { Icon } from '@mdi/react';
import type { CardItem, PackageCard as Card } from '../../core/archive/packages/types';
import { formatCount } from '../../core/format';
import { theme } from '../../theme';

const styles = {
  card: css`
    flex: none;
    max-height: 45%;
    overflow: auto;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: ${theme.panel};
    border-bottom: 1px solid ${theme.border};
    font-family: ${theme.sans};
    font-size: var(--text-base);
  `,
  head: css`
    display: flex;
    align-items: center;
    gap: 10px;
    color: ${theme.muted};
  `,
  title: css`
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    color: ${theme.text};
    overflow-wrap: anywhere;
  `,
  kind: css`
    color: ${theme.muted};
    font-size: var(--text-sm);
  `,
  badges: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  `,
  badge: css`
    padding: 0 6px;
    border: 1px solid ${theme.border};
    border-radius: 3px;
    font-size: var(--text-xs);
    line-height: calc(18px * var(--font-scale));
    color: ${theme.muted};
    white-space: nowrap;
  `,
  accent: css`
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
  warnings: css`
    margin: 0;
    padding: 0;
    list-style: none;
    color: ${theme.warning};
    li {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  `,
  grid: css`
    display: grid;
    grid-template-columns: minmax(110px, max-content) 1fr;
    gap: 2px 16px;
    margin: 0;
    dt {
      color: ${theme.muted};
    }
    dd {
      margin: 0;
      font-family: ${theme.mono};
      font-size: var(--text-sm);
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }
  `,
  section: css`
    > summary {
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
  list: css`
    margin: 4px 0 2px;
    padding-left: 20px;
    font-family: ${theme.mono};
    font-size: var(--text-sm);
    columns: 280px;
    li {
      overflow-wrap: anywhere;
    }
  `,
  flagged: css`
    color: ${theme.warning};
  `,
  reason: css`
    margin-left: 6px;
    font-family: ${theme.sans};
    font-size: var(--text-xs);
  `,
  pre: css`
    margin: 4px 0 6px;
    padding: 6px 8px;
    max-height: 240px;
    overflow: auto;
    background: ${theme.bg};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    font-family: ${theme.mono};
    font-size: var(--text-sm);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  `,
};

const TONES = { plain: '', accent: styles.accent, good: styles.good, warn: styles.warn };

function Item({ item }: { item: CardItem }) {
  if (!item.flag) return <li>{item.text}</li>;
  return (
    <li className={styles.flagged} data-flagged="true" title={item.flag}>
      {item.text}
      <span className={styles.reason}>— {item.flag}</span>
    </li>
  );
}

/** The recognised package's manifest, shown above the archive's file table. */
export function PackageCard({ card }: { card: Card }) {
  return (
    <section
      className={styles.card}
      data-testid="package-card"
      aria-label={`${card.title} manifest`}
    >
      <div className={styles.head}>
        <Icon path={mdiPackageVariantClosed} size={1.1} />
        <div>
          <div className={styles.kind}>{card.title}</div>
          <h3 className={styles.title}>
            {card.name}
            {card.version && <span className={styles.kind}> {card.version}</span>}
          </h3>
        </div>
      </div>
      {card.badges.length > 0 && (
        <div className={styles.badges}>
          {card.badges.map((b, i) => (
            <span key={`${b.text}-${i}`} className={cx(styles.badge, TONES[b.tone])}>
              {b.text}
            </span>
          ))}
        </div>
      )}
      {card.warnings.length > 0 && (
        <ul className={styles.warnings} data-testid="package-warnings">
          {card.warnings.map((w, i) => (
            <li key={i}>
              <Icon path={mdiAlertOutline} size={0.6} />
              {w}
            </li>
          ))}
        </ul>
      )}
      {card.fields.length > 0 && (
        <dl className={styles.grid}>
          {card.fields.map((f, i) => (
            <div key={`${f.label}-${i}`} style={{ display: 'contents' }}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {card.lists.map(l => (
        <details
          key={l.title}
          className={styles.section}
          open={l.items.some(i => i.flag) || l.items.length <= 12}
        >
          <summary>
            {l.title}
            <span>{formatCount(l.items.length)}</span>
          </summary>
          <ul className={styles.list}>
            {l.items.map((item, i) => (
              <Item key={i} item={item} />
            ))}
          </ul>
        </details>
      ))}
      {card.scripts.length > 0 && (
        <details className={styles.section} open={card.scripts.some(s => s.flag)}>
          <summary>
            Scripts
            <span>{formatCount(card.scripts.length)}</span>
          </summary>
          {card.scripts.map((s, i) => (
            <div key={`${s.name}-${i}`}>
              <div className={s.flag ? styles.flagged : undefined} title={s.flag}>
                <code>{s.name}</code>
                {s.flag && <span className={styles.reason}>— {s.flag}</span>}
              </div>
              {s.body && <pre className={styles.pre}>{s.body}</pre>}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
