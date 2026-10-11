import { expect, test, type Page } from '@playwright/test';
import { wav } from '../fixtures/media';
import { stat } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

async function dropBytes(page: Page, name: string, type: string, bytes: Uint8Array) {
  await page.evaluate(
    ({ name, type, data }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], name, { type }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    },
    { name, type, data: Array.from(bytes) },
  );
}

test('dropped WAV plays and draws a waveform', async ({ page }) => {
  await dropBytes(page, 'tone.wav', 'audio/wav', wav({ seconds: 1, rate: 8000 }));

  const chip = page.locator('[data-kind=audio]');
  await expect(chip).toHaveText('WAV · 0:01 · 128 kbps');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const audio = page.getByTestId('media-audio');
  await expect(audio).toBeAttached();
  await expect.poll(() => audio.evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(0);

  const waveform = page.getByTestId('waveform');
  await expect(waveform).toHaveAttribute('data-drawn', 'true');
  // Some pixels were painted
  const painted = await waveform.evaluate((c: HTMLCanvasElement) => {
    const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? [];
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(100);

  // Click to seek
  await waveform.click({ position: { x: 200, y: 20 } });
  await expect
    .poll(() => audio.evaluate((el: HTMLAudioElement) => el.currentTime))
    .toBeGreaterThan(0);

  await page.keyboard.press('2');
  await expect(stat(page, 'Sample rate')).toHaveText('8,000 Hz');
  await expect(stat(page, 'Channels')).toHaveText('1 (mono)');
});

test('a MediaRecorder WebM shows the video chip and loads', async ({ page }) => {
  // Record half a second of an animated canvas in the page itself
  const data = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
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
        if (t < 500) requestAnimationFrame(frame);
        else resolve();
      };
      frame();
    });
    recorder.stop();
    await done;
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });

  await dropBytes(page, 'clip.webm', 'video/webm', new Uint8Array(data));
  const chip = page.locator('[data-kind=video]');
  await expect(chip).toHaveText(/^WebM · 160×120/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');

  const video = page.getByTestId('media-video');
  await expect(video).toBeAttached();
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(160);
  await expect(stat(page, 'Dimensions')).toHaveText('160 × 120');
});
