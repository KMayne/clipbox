import { css } from '@emotion/css';
import { theme } from '../theme';

const overlay = css`
  position: fixed;
  inset: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px dashed ${theme.accent};
  border-radius: 8px;
  background: rgba(30, 30, 30, 0.85);
  font-size: 18px;
  pointer-events: none;
  z-index: 100;
`;

export function DropOverlay() {
  return <div className={overlay}>Drop to capture</div>;
}
