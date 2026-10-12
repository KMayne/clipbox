/**
 * "Extract audio track": a video's primary audio track copied packet for packet (never
 * re-encoded) into the container that suits its codec.
 */
import {
  FlacOutputFormat,
  MkvOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  PCM_AUDIO_CODECS,
  WavOutputFormat,
  type OutputFormat,
} from 'mediabunny';
import { asM4a, convertInto, withInput } from './conversion';
import type { ExtractOptions, ExtractResult } from './service';

export interface AudioContainer {
  extension: string;
  mime: string;
  make(): OutputFormat;
}

const MKA: AudioContainer = {
  extension: 'mka',
  mime: 'audio/x-matroska',
  make: () => new MkvOutputFormat(),
};

const PCM = new Set<string>(PCM_AUDIO_CODECS);

/**
 * The container for a copied audio track: AAC → M4A, MP3 → MP3, Opus and Vorbis → Ogg,
 * FLAC → FLAC, PCM → WAV, and Matroska audio for anything else (or a PCM layout WAV can't hold).
 */
export function audioContainer(codec: string | null): AudioContainer {
  const pick = (): AudioContainer | null => {
    if (codec === 'aac')
      return {
        extension: 'm4a',
        mime: 'audio/mp4',
        make: () => new Mp4OutputFormat({ fastStart: 'in-memory' }),
      };
    if (codec === 'mp3')
      return { extension: 'mp3', mime: 'audio/mpeg', make: () => new Mp3OutputFormat() };
    if (codec === 'opus' || codec === 'vorbis')
      return { extension: 'ogg', mime: 'audio/ogg', make: () => new OggOutputFormat() };
    if (codec === 'flac')
      return { extension: 'flac', mime: 'audio/flac', make: () => new FlacOutputFormat() };
    if (codec && PCM.has(codec))
      return { extension: 'wav', mime: 'audio/wav', make: () => new WavOutputFormat() };
    return null;
  };
  const picked = pick();
  const holds = (c: AudioContainer) => {
    const supported: readonly string[] = c.make().getSupportedAudioCodecs();
    return !!codec && supported.includes(codec);
  };
  return picked && holds(picked) ? picked : MKA;
}

export function extractAudio(
  bytes: Uint8Array<ArrayBuffer>,
  { signal, progress }: ExtractOptions,
): Promise<ExtractResult> {
  return withInput(bytes, async input => {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio track');
    const container = audioContainer(track.codec);
    progress?.(undefined, 'Copying');
    const out = await convertInto(
      input,
      container.make(),
      {
        video: { discard: true },
        audio: t => (t.id === track.id ? {} : { discard: true }),
        // Never re-encode; an audio-only file may start where its packets do
        copy: { mode: 'forced', shiftTolerance: Infinity },
      },
      {
        signal,
        onProgress: fraction => progress?.(fraction, 'Copying'),
        needs: t => t.id === track.id,
      },
    );
    return {
      bytes: container.extension === 'm4a' ? asM4a(out) : out,
      mime: container.mime,
      extension: container.extension,
      codec: track.codec ?? 'unknown',
    };
  });
}
