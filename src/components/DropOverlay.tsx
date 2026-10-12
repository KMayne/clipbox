import { css } from '@emotion/css';
import { theme, withAlpha } from '../theme';

const overlay = css`
  position: fixed;
  inset: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed ${theme.accent};
  border-radius: 8px;
  background: ${withAlpha(theme.bg, 0.85)};
  font-size: var(--text-2xl);
  pointer-events: none;
  z-index: 100;
`;

export function DropOverlay() {
  return <div className={overlay}>Drop to capture</div>;
}
