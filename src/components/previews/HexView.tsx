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
    line-height: calc(18px * var(--font-scale));
  `,
  offset: css`
    color: ${theme.faint};
  `,
  ascii: css`
    color: ${theme.muted};
  `,
};

const printable = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

/** The value's bytes, for kinds whose preview is a hex dump. */
export function HexView({ handle }: { handle: ValueHandle }) {
  return (
    <HexDump
      id={`${handle.summary.kind}:${handle.summary.bytes}`}
      size={handle.summary.extent}
      read={(from, to) => handle.bytes(from, to)}
    />
  );
}

/**
 * A paged hex dump of `size` bytes, fetched a page at a time with `read`. `id` names the source,
 * so switching sources refetches.
 */
export function HexDump({
  id,
  size,
  read,
}: {
  id: string;
  size: number;
  read(from: number, to: number): Promise<Uint8Array>;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(size / PAGE));
  const bytes = useAsync(`${id}:${page}`, () => read(page * PAGE, (page + 1) * PAGE));

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
