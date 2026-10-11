import { css } from '@emotion/css';
import { theme } from '../../theme';

export const preview = {
  scroller: css`
    position: absolute;
    inset: 0;
    overflow: auto;
    font-family: ${theme.mono};
    font-size: 12px;
  `,
  toolbar: css`
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 12px;
    border-bottom: 1px solid ${theme.subtle};
  `,
  column: css`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  `,
  fill: css`
    position: relative;
    flex: 1;
    min-height: 0;
  `,
};
