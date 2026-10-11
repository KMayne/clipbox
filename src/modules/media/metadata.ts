import { parseBuffer, type IAudioMetadata } from 'music-metadata';
import { isRecord } from '../../core/guards';
import type { MediaValue } from './media';

/** JSON-friendly copy: bytes become their length, dates ISO strings, empty values dropped. */
function plain(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'bigint') return v.toString();
  if (depth > 8) return undefined;
  if (v instanceof Uint8Array) return `<${v.byteLength} bytes>`;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  if (Array.isArray(v)) return v.map(x => plain(x, depth + 1)).filter(x => x !== undefined);
  if (isRecord(v)) {
    const entries = Object.entries(v)
      .map(([k, x]) => [k, plain(x, depth + 1)] as const)
      .filter(([, x]) => x !== undefined && !(Array.isArray(x) && x.length === 0));
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return undefined;
}

/** Cover art and other pictures, described rather than embedded. */
const pictures = (meta: IAudioMetadata) =>
  (meta.common.picture ?? []).map(p => ({
    format: p.format,
    ...(p.type && { type: p.type }),
    ...(p.description && { description: p.description }),
    bytes: p.data.byteLength,
  }));

/** Everything music-metadata reads, plus what the module's own container parsing found. */
export async function mediaMetadata(v: MediaValue): Promise<Record<string, unknown>> {
  const summary = {
    kind: v.kind,
    container: v.container,
    format: v.format,
    mime: v.mime,
    codecs: v.codecs,
    duration: v.duration,
    bitrate: v.bitrate,
    sampleRate: v.sampleRate,
    channels: v.channels,
    bitDepth: v.bitDepth,
    lossless: v.lossless,
    video: v.video,
    tags: v.tags,
  };
  let meta: IAudioMetadata | null = null;
  let warning = v.warning;
  // AVI has no music-metadata parser; the module's own RIFF reading is all there is
  if (v.container !== 'avi') {
    try {
      meta = await parseBuffer(
        v.bytes,
        { mimeType: v.mime, size: v.bytes.byteLength },
        { duration: true },
      );
    } catch (err) {
      warning = err instanceof Error ? err.message : String(err);
    }
  }
  const out: Record<string, unknown> = { ...summary };
  if (meta) {
    // Pictures are listed separately, described rather than embedded
    out.streams = plain(meta.format);
    out.common = plain({ ...meta.common, picture: undefined });
    const pics = pictures(meta);
    if (pics.length) out.pictures = pics;
    out.native = plain(meta.native);
    const warnings = meta.quality.warnings.map(w => w.message);
    if (warnings.length) out.warnings = warnings;
  }
  if (warning) out.error = warning;
  return out;
}
