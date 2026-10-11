/** Peak amplitude (0..1) of each of `buckets` equal slices, taking the loudest channel. */
export function computePeaks(channels: Float32Array[], buckets: number): Float32Array {
  const peaks = new Float32Array(buckets);
  const length = channels[0]?.length ?? 0;
  if (length === 0 || buckets <= 0) return peaks;
  const per = length / buckets;
  for (const data of channels) {
    for (let b = 0; b < buckets; b++) {
      const from = Math.floor(b * per);
      const to = Math.max(from + 1, Math.floor((b + 1) * per));
      let max = peaks[b] ?? 0;
      for (let i = from; i < to && i < length; i++) {
        const v = Math.abs(data[i] ?? 0);
        if (v > max) max = v;
      }
      peaks[b] = Math.min(1, max);
    }
  }
  return peaks;
}

/** Decodes audio bytes on the main thread (Web Audio isn't available in workers). */
export async function decodeAudio(bytes: Uint8Array<ArrayBuffer>): Promise<AudioBuffer> {
  // Any rate works for decoding; the result keeps the file's own rate
  const ctx = new OfflineAudioContext(1, 1, 44100);
  // decodeAudioData detaches its input, so give it a copy
  return ctx.decodeAudioData(bytes.slice().buffer);
}

export function channelData(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
}
