import { css } from '@emotion/css';
import { schemaToTs } from '../core/schema';
import type { Schema } from '../core/types';
import { theme } from '../theme';
import { ui } from './ui';

const pre = css`
  height: 100%;
  margin: 0;
  padding: 12px 16px;
  overflow: auto;
  font-family: ${theme.mono};
  font-size: 12px;
`;

export function SchemaView({ schema }: { schema?: Schema }) {
  if (!schema) return <div className={ui.empty}>No schema for this kind</div>;
  return <pre className={pre}>{`type Input = ${schemaToTs(schema)};`}</pre>;
}
