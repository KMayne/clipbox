import { archiveInterpreter } from '../../core/archive/interpreter';
import { normalisePath, type ArchiveValue, type DiscInfo } from '../../core/archive/types';
import type { EntryContent } from '../../core/content';
import { sevenzipDetector, sniff } from './detect';
import { udfVolumeLabel, type SltListing } from './listing';
import type { DiscHandler, SevenZip } from './reader';
import { readIsoVolume } from './volume';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function unsupported(c: EntryContent, reason: string): ArchiveValue {
  return {
    kind: 'archive',
    format: 'iso',
    archiveBytes: c.size,
    entries: [],
    source: { type: 'external', bytes: c.bytes, names: [] },
    unsupported: reason,
  };
}

function discInfo(c: EntryContent, handler: DiscHandler, listing: SltListing): DiscInfo {
  if (handler === 'udf') {
    const version = listing.archive.Version;
    const volume = udfVolumeLabel(listing.comment);
    return {
      filesystem: 'UDF',
      ...(version ? { detail: `UDF ${version}` } : {}),
      ...(volume ? { volume } : {}),
    };
  }
  const { label, joliet } = readIsoVolume(c.bytes);
  return {
    filesystem: 'ISO 9660',
    ...(joliet ? { detail: 'ISO 9660 with Joliet' } : {}),
    ...(label ? { volume: label } : {}),
  };
}

const handlerOf = (v: ArchiveValue): DiscHandler => (v.disc?.filesystem === 'UDF' ? 'udf' : 'iso');

/**
 * Lists with each file system the image carries, UDF first: on a UDF bridge disc (Windows and
 * many Linux installers) the ISO 9660 tree can be a stub. The first listing with files wins.
 */
async function discValue(c: EntryContent, lib: SevenZip): Promise<ArchiveValue> {
  const found = sniff(c);
  if (!found) throw new Error('Not a disc image');
  const handlers: DiscHandler[] = [
    ...(found.udf ? ['udf' as const] : []),
    ...(found.iso9660 ? ['iso' as const] : []),
  ];
  let best: { handler: DiscHandler; listing: SltListing } | null = null;
  let error: unknown = null;
  for (const handler of handlers) {
    try {
      const listing = await lib.list(c.bytes, handler);
      best ??= { handler, listing };
      if (listing.items.length > 0) {
        best = { handler, listing };
        break;
      }
    } catch (err) {
      error ??= err;
    }
  }
  if (!best) return unsupported(c, errorMessage(error));
  const kept = best.listing.items
    .map(item => ({ ...item, entryPath: normalisePath(item.path, item.isDir) }))
    .filter(item => item.entryPath !== '');
  return {
    kind: 'archive',
    format: 'iso',
    archiveBytes: c.size,
    // Files are stored whole, so there's no compressed size (7-Zip's "packed" is sector-rounded)
    entries: kept.map(item => ({
      path: item.entryPath,
      size: item.size,
      isDir: item.isDir,
      ...(item.modified ? { modified: item.modified } : {}),
    })),
    source: { type: 'external', bytes: c.bytes, names: kept.map(item => item.path) },
    disc: discInfo(c, best.handler, best.listing),
  };
}

/** ISO 9660 (with Joliet and Rock Ridge) and UDF disc images through 7-Zip's WASM build. */
export function createSevenZipInterpreter(load: () => Promise<SevenZip>) {
  return archiveInterpreter({
    detect: c => sevenzipDetector.detect(c),
    parse: async c => discValue(c, await load()),
    async extractExternal(v, index) {
      const name = v.source.type === 'external' ? v.source.names[index] : undefined;
      if (name === undefined) throw new Error(`No entry ${index}`);
      return (await load()).extract(v.source.bytes, handlerOf(v), name);
    },
  });
}
