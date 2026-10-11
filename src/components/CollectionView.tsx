import { css } from '@emotion/css';
import {
  mdiCertificateOutline,
  mdiClockOutline,
  mdiCodeJson,
  mdiDatabaseOutline,
  mdiDownload,
  mdiFileExcelOutline,
  mdiFileOutline,
  mdiFilePdfBox,
  mdiFolderZipOutline,
  mdiImageOutline,
  mdiKeyVariant,
  mdiLanguageHtml5,
  mdiLanguageMarkdownOutline,
  mdiLinkVariant,
  mdiMusicNote,
  mdiPaletteOutline,
  mdiTable,
  mdiTextBoxOutline,
  mdiVideoOutline,
} from '@mdi/js';
import { Icon } from '@mdi/react';
import { memo, useRef, useState } from 'react';
import { downloadAll, useSaveStore } from '../capture/saveFiles';
import { baseFileName } from '../core/filenames';
import { formatBytes, plural } from '../core/format';
import { kindName } from '../core/kinds';
import type { CaptureId } from '../core/types';
import {
  bestInterpretation,
  useCaptureStore,
  type CaptureView,
  type EntryView,
} from '../state/captureStore';
import { kindColor, theme } from '../theme';
import { ParentLink } from './ParentLink';
import { ui } from './ui';

const KIND_ICONS: Record<string, string> = {
  image: mdiImageOutline,
  json: mdiCodeJson,
  yaml: mdiCodeJson,
  xml: mdiCodeJson,
  ndjson: mdiCodeJson,
  records: mdiTable,
  text: mdiTextBoxOutline,
  html: mdiLanguageHtml5,
  markdown: mdiLanguageMarkdownOutline,
  pdf: mdiFilePdfBox,
  archive: mdiFolderZipOutline,
  audio: mdiMusicNote,
  video: mdiVideoOutline,
  sqlite: mdiDatabaseOutline,
  spreadsheet: mdiFileExcelOutline,
  pem: mdiCertificateOutline,
  jwt: mdiKeyVariant,
  url: mdiLinkVariant,
  colour: mdiPaletteOutline,
  timestamp: mdiClockOutline,
};

const styles = {
  view: css`
    display: flex;
    flex-direction: column;
    height: 100%;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid ${theme.subtle};
    min-width: 0;
  `,
  badge: css`
    padding: 0 6px;
    border-radius: 3px;
    background: ${theme.accent};
    color: ${theme.onAccent};
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
  `,
  count: css`
    white-space: nowrap;
  `,
  actions: css`
    margin-left: auto;
    display: flex;
    gap: 6px;
  `,
  grid: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    grid-auto-rows: max-content;
    gap: 8px;
    padding: 12px;
    align-content: start;
  `,
  tile: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-width: 0;
    padding: 6px;
    background: ${theme.panel};
    border: 1px solid ${theme.subtle};
    border-radius: 4px;
    color: ${theme.text};
    text-align: left;
    cursor: pointer;
    /* Skip layout and paint of off-screen tiles in large collections */
    content-visibility: auto;
    contain-intrinsic-size: auto 150px;
    &:hover {
      background: ${theme.hover};
    }
    &:focus-visible {
      outline: 2px solid ${theme.accent};
      outline-offset: 1px;
    }
  `,
  thumb: css`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 96px;
    margin-bottom: 4px;
    background: ${theme.bg};
    border-radius: 3px;
    overflow: hidden;
    color: ${theme.muted};
    & > img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  `,
  name: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  `,
  meta: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: ${theme.muted};
    white-space: nowrap;
  `,
  kind: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  dot: css`
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  `,
};

/** A capture with several entries as a grid of tiles; clicking (or Enter on) a tile selects it. */
export function CollectionView({ captureId }: { captureId: CaptureId }) {
  const capture = useCaptureStore(s => s.captures.find(c => c.id === captureId));
  if (!capture) return <div className={ui.empty}>This collection was removed</div>;
  return <Collection capture={capture} />;
}

function Collection({ capture }: { capture: CaptureView }) {
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const progress = useSaveStore(s => (s.progress?.captureId === capture.id ? s.progress : null));
  const { entries } = capture;
  const total = entries.reduce((sum, e) => sum + e.size, 0);

  const focusTile = (i: number) => {
    const tiles = grid.current?.querySelectorAll<HTMLElement>('[data-testid=tile]');
    const tile = tiles?.[i];
    if (!tile) return;
    setActive(i);
    tile.focus();
    tile.scrollIntoView({ block: 'nearest' });
  };

  /** Tiles per row, from the laid-out positions (the grid's column count is responsive). */
  const columns = () => {
    const tiles = grid.current?.querySelectorAll<HTMLElement>('[data-testid=tile]') ?? [];
    const top = tiles[0]?.offsetTop;
    let n = 0;
    for (const t of tiles) {
      if (t.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = entries.length - 1;
    const step: Record<string, () => number> = {
      ArrowRight: () => active + 1,
      ArrowLeft: () => active - 1,
      ArrowDown: () => active + columns(),
      ArrowUp: () => active - columns(),
      Home: () => 0,
      End: () => last,
    };
    const next = step[e.key];
    if (!next) return;
    e.preventDefault();
    focusTile(Math.min(last, Math.max(0, next())));
  };

  return (
    <section className={styles.view} aria-label="Collection" data-testid="collection">
      <div className={styles.header}>
        <span className={styles.badge}>Collection</span>
        <span className={styles.count} data-testid="collection-count">
          {plural(entries.length, 'item')} · {formatBytes(total)}
        </span>
        {capture.parent ? (
          <ParentLink parent={capture.parent} />
        ) : (
          <span className={ui.muted}>{capture.source}</span>
        )}
        <span className={styles.actions}>
          <button
            className={ui.button}
            disabled={progress !== null}
            title="Save every item into a folder"
            onClick={() => void downloadAll(capture.id)}
          >
            <Icon path={mdiDownload} size={0.6} />
            {progress ? `Saving ${progress.done}/${progress.total}…` : 'Download all'}
          </button>
        </span>
      </div>
      <div
        ref={grid}
        className={styles.grid}
        role="list"
        aria-label="Items"
        data-testid="collection-grid"
        onKeyDown={onKeyDown}
      >
        {entries.map((e, i) => (
          <Tile
            key={e.id}
            entry={e}
            index={i}
            active={i === Math.min(active, entries.length - 1)}
            onActive={setActive}
          />
        ))}
      </div>
    </section>
  );
}

const Tile = memo(function Tile({
  entry,
  index,
  active,
  onActive,
}: {
  entry: EntryView;
  index: number;
  active: boolean;
  onActive(index: number): void;
}) {
  const best = bestInterpretation(entry);
  const name = entry.name ?? baseFileName({ mime: entry.mime, kind: best?.kind }, index + 1);
  const select = () => {
    if (best) useCaptureStore.getState().select({ entryId: entry.id, kind: best.kind });
  };
  return (
    <div role="listitem">
      <button
        className={styles.tile}
        data-testid="tile"
        data-entry={entry.id}
        tabIndex={active ? 0 : -1}
        title={`${name} — ${entry.mime}`}
        aria-disabled={!best}
        onFocus={() => onActive(index)}
        onClick={select}
      >
        <div className={styles.thumb}>
          {entry.thumbUrl ? (
            <img src={entry.thumbUrl} alt="" loading="lazy" decoding="async" />
          ) : (
            <Icon path={KIND_ICONS[best?.kind ?? ''] ?? mdiFileOutline} size={1.6} />
          )}
        </div>
        <span className={styles.name}>{name}</span>
        <span className={styles.meta}>
          <span>{formatBytes(entry.size)}</span>
          <span className={styles.kind} data-testid="tile-kind">
            <span
              className={styles.dot}
              style={{ background: best ? kindColor(best.kind) : theme.muted }}
            />
            {best ? kindName(best.kind) : entry.status === 'pending' ? '…' : entry.mime}
          </span>
        </span>
      </button>
    </div>
  );
});
