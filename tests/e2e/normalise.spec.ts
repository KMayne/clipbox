import { expect, test, type Page } from '@playwright/test';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input } from 'mediabunny';
import { actionsPane, savedCount, stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function dropBytes(page: Page, name: string, type: string, bytes: number[]) {
  await page.evaluate(
    ({ name, type, data }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], name, { type }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    },
    { name, type, data: bytes },
  );
}

/** A 2 s mono 16-bit WAV of a 1 kHz tone at -30 dBFS (about -33 LUFS). */
function quietWav(rate = 44100, seconds = 2): number[] {
  const frames = rate * seconds;
  const dv = new DataView(new ArrayBuffer(44 + frames * 2));
  const ascii = (at: number, s: string) =>
    [...s].forEach((ch, i) => dv.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  dv.setUint32(4, 36 + frames * 2, true);
  ascii(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, 'data');
  dv.setUint32(40, frames * 2, true);
  const amp = 10 ** (-30 / 20) * 32767;
  for (let i = 0; i < frames; i++)
    dv.setInt16(44 + i * 2, Math.round(amp * Math.sin((2 * Math.PI * 1000 * i) / rate)), true);
  return Array.from(new Uint8Array(dv.buffer));
}

const derivedFrom = (page: Page) => page.getByTestId('capture').first().getByTestId('derived-from');

async function runNormalise(page: Page) {
  const pane = actionsPane(page);
  await pane.getByRole('button', { name: 'Normalise audio' }).click();
  const form = pane.getByRole('form', { name: 'Normalise audio settings' });
  await expect(form.getByLabel('Target loudness (LUFS)')).toHaveValue('-14');
  await form.getByRole('button', { name: 'Run' }).click();
}

test('normalises a dropped quiet WAV into a new audio capture', async ({ page }) => {
  await dropBytes(page, 'quiet.wav', 'audio/wav', quietWav());
  const chip = page.locator('[data-kind=audio]');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  await runNormalise(page);
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 15_000 });
  await expect(derivedFrom(page)).toHaveText(/› Normalise to -14 LUFS$/);
  const result = page.getByTestId('capture').first();
  await expect(result.locator('[data-kind=audio]')).toHaveText(/^WAV · 0:02/);
  await expect(result).toContainText('quiet (normalised -14 LUFS; was -33.0 LUFS, +19.0 dB).wav');
});

test('keeps the video track of a WebM and replaces its audio', async ({ page }) => {
  // Record a second of an animated canvas plus a quiet tone in the page itself
  const data = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.03;
    const dest = audio.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    const stream = new MediaStream([
      ...canvas.captureStream(30).getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(resolve => (recorder.onstop = resolve));
    recorder.start();
    const start = performance.now();
    await new Promise<void>(resolve => {
      const frame = () => {
        const t = performance.now() - start;
        ctx.fillStyle = `hsl(${t % 360} 80% 50%)`;
        ctx.fillRect(0, 0, 160, 120);
        if (t < 1000) requestAnimationFrame(frame);
        else resolve();
      };
      frame();
    });
    recorder.stop();
    await done;
    osc.stop();
    await audio.close();
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });

  await dropBytes(page, 'clip.webm', 'video/webm', data);
  await expect(page.locator('[data-kind=video]')).toHaveAttribute('aria-pressed', 'true');

  await runNormalise(page);
  await expect(page.getByTestId('capture')).toHaveCount(2, { timeout: 15_000 });
  const result = page.getByTestId('capture').first();
  await expect(result).toContainText(
    /clip \(normalised -14 LUFS; was -\d+\.\d LUFS, \+\d+\.\d dB\)\.webm/,
  );
  const chip = result.locator('[data-kind=video]');
  await expect(chip).toHaveText(/^WebM · 160×120/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(stat(page, 'Dimensions')).toHaveText('160 × 120');
  const video = page.getByTestId('media-video');
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(160);

  // The video packets are byte-for-byte the input's (copied, not re-encoded); read both files back
  // from the history store and compare with Mediabunny in Node
  await expect.poll(() => savedCount(page)).toBe(2);
  const files = await savedBlobs(page);
  expect(files).toHaveLength(2);
  const [a, b] = await Promise.all(files.map(videoPackets));
  expect(a?.length).toBeGreaterThan(10);
  expect(b).toEqual(a);
});

/** Every blob in the history store, as byte arrays. */
const savedBlobs = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number[][]>((resolve, reject) => {
        const open = indexedDB.open('clipbox-blobs');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('blobs').objectStore('blobs').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = async () => {
            const blobs: unknown[] = req.result;
            const out: number[][] = [];
            for (const blob of blobs)
              if (blob instanceof Blob)
                out.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
            resolve(out);
          };
        };
      }),
  );

/** Hex of each encoded packet of the file's video track. */
async function videoPackets(bytes: number[]): Promise<string[]> {
  const input = new Input({
    source: new BufferSource(new Uint8Array(bytes)),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('no video track');
  const out: string[] = [];
  for await (const packet of new EncodedPacketSink(track).packets())
    out.push(Buffer.from(packet.data).toString('hex'));
  input.dispose();
  return out;
}
