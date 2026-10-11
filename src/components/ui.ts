import { css } from '@emotion/css';
import { theme } from '../theme';

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
  `,
  muted: css`
    color: ${theme.muted};
  `,
  mono: css`
    font-family: ${theme.mono};
    font-size: 12px;
  `,
  kbd: css`
    padding: 0 4px;
    border: 1px solid ${theme.border};
    border-radius: 3px;
    font-family: ${theme.mono};
    font-size: 11px;
    color: ${theme.muted};
  `,
  empty: css`
    padding: 24px;
    color: ${theme.muted};
    text-align: center;
  `,
};
