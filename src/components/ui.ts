import { css } from '@emotion/css';
import { theme } from '../theme';

/** Below this width the app shows one pane at a time with a bottom navigation bar. */
export const MOBILE_QUERY = '(max-width: 767px)';

/** Media queries for Emotion styles. `touch` also covers coarse pointers on wider screens. */
export const media = {
  mobile: `@media ${MOBILE_QUERY}`,
  touch: `@media ${MOBILE_QUERY}, (pointer: coarse)`,
};

/** Minimum touch target size. */
export const TOUCH_TARGET = '40px';

export const ui = {
  button: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    background: ${theme.raised};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    &:hover {
      background: ${theme.hover};
    }
    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
    ${media.touch} {
      min-height: ${TOUCH_TARGET};
      padding: 3px 12px;
    }
  `,
  /** The main call to action (Read clipboard on phones). */
  primary: css`
    background: ${theme.accent};
    border-color: ${theme.accent};
    color: ${theme.onAccent};
    font-weight: 600;
    &:hover {
      background: ${theme.accent};
      filter: brightness(1.1);
    }
  `,
  iconButton: css`
    display: inline-flex;
    padding: 2px;
    background: none;
    border: none;
    border-radius: 3px;
    color: ${theme.muted};
    cursor: pointer;
    &:hover {
      color: ${theme.text};
      background: ${theme.hover};
    }
    ${media.touch} {
      min-width: ${TOUCH_TARGET};
      min-height: ${TOUCH_TARGET};
      align-items: center;
      justify-content: center;
    }
  `,
  muted: css`
    color: ${theme.muted};
  `,
  mono: css`
    font-family: ${theme.mono};
    font-size: var(--text-sm);
  `,
  kbd: css`
    padding: 0 4px;
    border: 1px solid ${theme.border};
    border-radius: 3px;
    font-family: ${theme.mono};
    font-size: var(--text-xs);
    color: ${theme.muted};
  `,
  empty: css`
    padding: 24px;
    color: ${theme.muted};
    text-align: center;
  `,
};
