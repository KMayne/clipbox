import { css } from '@emotion/css';
import { useState } from 'react';
import { formatCount } from '../../core/format';
import type { ValueHandle } from '../../core/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { preview } from './styles';

const PAGE = 1024;
const WIDTH = 16;

const styles = {
  pre: css`
    margin: 0;
    padding: 12px;
    line-height: 18px;
  `,
  offset: css`
    color: #6a6a6a;
  `,
  ascii: css`
    color: ${theme.muted};
  `,
};

const printable = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

export function HexView({ handle }: { handle: ValueHandle }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(handle.summary.extent / PAGE));
  const bytes = useAsync(String(page), () => handle.bytes(page * PAGE, (page + 1) * PAGE));

  const lines: React.ReactNode[] = [];
  if (bytes.status === 'ok') {
    for (let i = 0; i < bytes.value.length; i += WIDTH) {
      const row = bytes.value.subarray(i, i + WIDTH);
      const hex = Array.from(row, b => b.toString(16).padStart(2, '0')).join(' ');
      lines.push(
        <div key={i}>
          <span className={styles.offset}>{(page * PAGE + i).toString(16).padStart(8, '0')}</span>
          {'  '}
          {hex.padEnd(WIDTH * 3 - 1)}
          {'  '}
          <span className={styles.ascii}>{Array.from(row, printable).join('')}</span>
        </div>,
      );
    }
  }

  return (
    <div className={preview.column}>
      <div className={preview.toolbar}>
        <button className={ui.button} disabled={page === 0} onClick={() => setPage(p => p - 1)}>
          Prev
        </button>
        <button
          className={ui.button}
          disabled={page >= pages - 1}
          onClick={() => setPage(p => p + 1)}
        >
          Next
        </button>
        <span className={ui.muted}>
          Page {page + 1} of {formatCount(pages)}
        </span>
      </div>
      <div className={preview.fill}>
        <pre className={`${preview.scroller} ${styles.pre}`}>{lines}</pre>
      </div>
    </div>
  );
}
