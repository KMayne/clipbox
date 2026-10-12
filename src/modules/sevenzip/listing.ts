/**
 * Parses 7-Zip's technical listing (`7zz l -slt`): a header block of archive properties, a
 * `----------` line, then one `Key = value` block per item separated by blank lines.
 */

export interface SltItem {
  /** As 7-Zip prints it; passed back to extract the item. */
  path: string;
  isDir: boolean;
  size: number;
  packedSize?: number;
  /** "YYYY-MM-DDTHH:MM:SS" in the WASM runtime's local time, as 7-Zip prints it. */
  modified?: string;
}

export interface SltListing {
  /** Archive-level properties (Type, Physical Size…); the Comment's lines in `comment`. */
  archive: Record<string, string>;
  comment: string[];
  items: SltItem[];
}

const KEY_VALUE = /^([^=]+?) = ?(.*)$/;

const num = (s: string | undefined) => {
  if (s === undefined || !/^\d+$/.test(s)) return undefined;
  return Number(s);
};

/** "2026-01-01 00:00:00.000000" → "2026-01-01T00:00:00". */
function date(s: string | undefined): string | undefined {
  const m = s?.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : undefined;
}

/** A directory is `Folder = +`, or a `D` in the Windows attributes when there's no Folder line. */
function isFolder(props: Map<string, string>): boolean {
  const folder = props.get('Folder');
  if (folder !== undefined) return folder === '+';
  return /^D/.test(props.get('Attributes') ?? '');
}

function toItem(props: Map<string, string>): SltItem | null {
  const path = props.get('Path');
  if (path === undefined || path === '') return null;
  const isDir = isFolder(props);
  const packedSize = num(props.get('Packed Size'));
  const modified = date(props.get('Modified'));
  return {
    path,
    isDir,
    size: isDir ? 0 : (num(props.get('Size')) ?? 0),
    ...(packedSize !== undefined && !isDir ? { packedSize } : {}),
    ...(modified ? { modified } : {}),
  };
}

export function parseSlt(lines: string[]): SltListing {
  const archive: Record<string, string> = {};
  const comment: string[] = [];
  const items: SltItem[] = [];
  // Before the archive's "--" line is 7-Zip's banner; the header runs to "----------"
  let section: 'banner' | 'header' | 'items' = 'banner';
  let inComment = false;
  let block = new Map<string, string>();
  const flush = () => {
    const item = toItem(block);
    if (item) items.push(item);
    block = new Map();
  };
  for (const line of lines) {
    if (section === 'banner') {
      if (line === '--') section = 'header';
      continue;
    }
    if (section === 'header') {
      if (line === '----------') {
        section = 'items';
      } else if (inComment) {
        if (line === '}') inComment = false;
        else comment.push(line);
      } else if (line === 'Comment = ' || line === 'Comment =') {
        // An empty Comment is followed by a { … } block when the handler has more to say
      } else if (line === '{') {
        inComment = true;
      } else {
        const m = line.match(KEY_VALUE);
        if (m?.[1] && m[2] !== undefined) archive[m[1]] = m[2];
      }
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    const m = line.match(KEY_VALUE);
    if (m?.[1] && m[2] !== undefined) block.set(m[1], m[2]);
  }
  flush();
  return { archive, comment, items };
}

/**
 * The UDF volume name from the header's comment: the logical volume's `Id` (what Windows and
 * Linux show), else the primary volume's `VolumeId`.
 */
export function udfVolumeLabel(comment: string[]): string | null {
  let section = '';
  let volumeId: string | null = null;
  for (const line of comment) {
    if (/^\S.*:$/.test(line)) {
      section = line;
      continue;
    }
    const m = line.match(/^\s+(\w+): ?(.*)$/);
    if (!m) continue;
    const value = m[2]?.trim();
    if (!value) continue;
    if (section === 'Logical Volumes:' && m[1] === 'Id') return value;
    if (section === 'Primary Volumes:' && m[1] === 'VolumeId') volumeId ??= value;
  }
  return volumeId;
}
