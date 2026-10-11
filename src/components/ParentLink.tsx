import { css } from '@emotion/css';
import { kindName } from '../core/kinds';
import { useCaptureStore, type CaptureView } from '../state/captureStore';
import { theme } from '../theme';

const styles = {
  parent: css`
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
    background: none;
    border: none;
    color: ${theme.muted};
    text-align: left;
    &:enabled {
      cursor: pointer;
    }
    &:enabled:hover {
      color: ${theme.text};
      text-decoration: underline;
    }
  `,
};

/** "from ‹parent label› › ‹derivation›"; clicking selects the parent interpretation. */
export function ParentLink({ parent }: { parent: NonNullable<CaptureView['parent']> }) {
  // Select the capture (a stable reference), not findEntry's fresh object
  const capture = useCaptureStore(s =>
    s.captures.find(c => c.entries.some(e => e.id === parent.entryId)),
  );
  const entry = capture?.entries.find(e => e.id === parent.entryId);
  const interpretation = entry?.interpretations.find(i => i.kind === parent.kind);
  const parentLabel = interpretation?.label ?? kindName(parent.kind);
  const text = `from ${parentLabel} › ${parent.label}`;
  return (
    <button
      className={styles.parent}
      data-testid="derived-from"
      disabled={!capture}
      title={capture ? `Select ${parentLabel}` : 'The original capture was removed'}
      onClick={e => {
        e.stopPropagation();
        if (!capture) return;
        // select() expands the parent's capture so its chip is visible
        useCaptureStore.getState().select({ entryId: parent.entryId, kind: parent.kind });
      }}
    >
      {text}
    </button>
  );
}
