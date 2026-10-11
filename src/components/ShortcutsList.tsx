import { css } from '@emotion/css';
import { theme } from '../theme';
import { ui } from './ui';

/** Every keyboard shortcut, grouped; single keys work when no text field has focus. */
const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Capture',
    keys: [
      ['Ctrl+V', 'Paste'],
      ['Ctrl+O', 'Open file'],
      ['Ctrl+C', 'Copy the current value'],
    ],
  },
  {
    title: 'Navigate',
    keys: [
      ['Ctrl+K', 'Commands'],
      ['J / K', 'Next / previous value'],
      ['↑ / ↓', 'Move in the Pastes list'],
      ['Delete', 'Remove the selected paste'],
    ],
  },
  {
    title: 'View',
    keys: [
      ['1–4', 'Switch view (Text, Tree, Split…)'],
      ['W', 'Toggle line wrap'],
      ['P', 'Show / hide Pastes'],
      ['A', 'Show / hide the sidebar'],
      ['I', 'Show / hide Info'],
    ],
  },
];

const styles = {
  list: css`
    padding: 2px 10px 10px;
    font-size: 12px;
  `,
  group: css`
    margin: 8px 0 4px;
    font-size: 11px;
    color: ${theme.faint};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  row: css`
    display: grid;
    grid-template-columns: minmax(64px, 40%) 1fr;
    gap: 10px;
    align-items: baseline;
    padding: 2px 0;
    color: ${theme.muted};
  `,
};

export function ShortcutsList() {
  return (
    <div className={styles.list} data-testid="shortcuts">
      {GROUPS.map(g => (
        <div key={g.title}>
          <div className={styles.group}>{g.title}</div>
          {g.keys.map(([key, what]) => (
            <div key={key} className={styles.row}>
              <span>
                <kbd className={ui.kbd}>{key}</kbd>
              </span>
              <span>{what}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
