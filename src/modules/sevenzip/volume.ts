import { descriptorId, SECTOR } from './detect';

/** What the ISO 9660 volume descriptors say, read directly (7-Zip's listing doesn't show it). */
export interface IsoVolume {
  /** The Joliet volume identifier when there is one (mixed case), else the primary one. */
  label: string | null;
  joliet: boolean;
}

const VOLUME_ID = 40;
const VOLUME_ID_LENGTH = 32;
const ESCAPES = 88;
const PRIMARY = 1;
const SUPPLEMENTARY = 2;
const TERMINATOR = 255;

const tidy = (s: string) => s.replace(/[\s\0]+$/, '').trim() || null;

/** Joliet SVDs declare UCS-2 level 1, 2 or 3 with the escape sequence %/@, %/C or %/E. */
const isJoliet = (b: Uint8Array, at: number) =>
  b[at + ESCAPES] === 0x25 &&
  b[at + ESCAPES + 1] === 0x2f &&
  [0x40, 0x43, 0x45].includes(b[at + ESCAPES + 2] ?? 0);

/** Walks the volume descriptor set from sector 16 for the primary and Joliet volume IDs. */
export function readIsoVolume(b: Uint8Array): IsoVolume {
  let primary: string | null = null;
  let joliet: string | null = null;
  let hasJoliet = false;
  for (let n = 16; n < 48 && (n + 1) * SECTOR <= b.length; n++) {
    if (descriptorId(b, n) !== 'CD001') break;
    const at = n * SECTOR;
    const type = b[at];
    const id = b.subarray(at + VOLUME_ID, at + VOLUME_ID + VOLUME_ID_LENGTH);
    if (type === PRIMARY && primary === null) {
      primary = tidy(new TextDecoder('latin1').decode(id));
    } else if (type === SUPPLEMENTARY && !hasJoliet && isJoliet(b, at)) {
      hasJoliet = true;
      joliet = tidy(new TextDecoder('utf-16be').decode(id));
    } else if (type === TERMINATOR) break;
  }
  return { label: joliet ?? primary, joliet: hasJoliet };
}
