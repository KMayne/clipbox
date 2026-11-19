import { css } from '@emotion/css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ValueHandle } from '../../core/types';
import type { Selection } from '../../state/captureStore';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';
import { CropBar, CropOverlay } from './CropOverlay';
import { aspectRatio, type AspectId, type Rect } from './cropGeometry';
import { useFrameSize } from './useFrameSize';
import { TrimBar } from './TrimBar';
import { channelData, computePeaks, decodeAudio } from './waveform';

const styles = {
  audio: css`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  `,
  audioBody: css`
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  `,
  head: css`
    display: flex;
    gap: 16px;
    align-items: center;
  `,
  cover: css`
    width: 120px;
    height: 120px;
    object-fit: cover;
    border-radius: 4px;
    flex: none;
  `,
  player: css`
    flex: 1;
    min-width: 200px;
  `,
  waveform: css`
    width: 100%;
    height: 120px;
    cursor: pointer;
    background: ${theme.panel};
    border-radius: 4px;
  `,
  note: css`
    color: ${theme.muted};
  `,
  video: css`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  `,
  stage: css`
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: #000;
    position: relative;
  `,
  videoEl: css`
    max-width: 100%;
    max-height: 100%;
  `,
};

/** Object URL for `blob`, revoked on change or unmount. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    // Object URL lifetime must follow the effect (StrictMode remounts would revoke a memoised one)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return blob ? url : null;
}

export function MediaView({ handle, selection }: { handle: ValueHandle; selection: Selection }) {
  const media = useAsync('media', () => handle.media());
  if (media.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (media.status === 'error') return <div className={ui.empty}>{media.error}</div>;
  const { bytes, mime } = media.value;
  return mime.startsWith('video/') ? (
    <VideoPane bytes={bytes} mime={mime} selection={selection} />
  ) : (
    <AudioPane handle={handle} bytes={bytes} mime={mime} selection={selection} />
  );
}

interface PaneProps {
  handle: ValueHandle;
  bytes: Uint8Array<ArrayBuffer>;
  mime: string;
  selection: Selection;
}

function useBlob(bytes: Uint8Array<ArrayBuffer> | null, mime: string): Blob | null {
  return useMemo(() => (bytes ? new Blob([bytes], { type: mime }) : null), [bytes, mime]);
}

function VideoPane({ bytes, mime, selection }: Omit<PaneProps, 'handle'>) {
  const url = useObjectUrl(useBlob(bytes, mime));
  const [failed, setFailed] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const frame = useFrameSize(video);
  // Crop mode, and its box in video pixels (null until one is drawn)
  const [cropMode, setCropMode] = useState(false);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [aspect, setAspect] = useState<AspectId>('free');
  const cropping = cropMode && !!frame && !!video;
  const close = useCallback(() => {
    setCropMode(false);
    setCrop(null);
  }, []);
  return (
    <div className={styles.video}>
      <div className={styles.stage}>
        {failed ? (
          <div className={styles.note}>Chromium can't play this file ({mime}).</div>
        ) : (
          url && (
            <video
              ref={setVideo}
              data-testid="media-video"
              className={styles.videoEl}
              src={url}
              controls={!cropping}
              preload="metadata"
              onError={() => setFailed(true)}
            />
          )
        )}
        {cropping && frame && video && (
          <CropOverlay
            video={video}
            frame={frame}
            rect={crop}
            aspect={aspectRatio(aspect, frame)}
            onChange={setCrop}
          />
        )}
      </div>
      {!failed &&
        (cropping && frame && video ? (
          <CropBar
            selection={selection}
            video={video}
            frame={frame}
            rect={crop}
            aspect={aspect}
            onRect={setCrop}
            onAspect={setAspect}
            onClose={close}
          />
        ) : (
          <TrimBar
            selection={selection}
            player={video}
            onCrop={frame ? () => setCropMode(true) : undefined}
          />
        ))}
    </div>
  );
}

function AudioPane({ handle, bytes, mime, selection }: PaneProps) {
  const url = useObjectUrl(useBlob(bytes, mime));
  const hasCover = handle.summary.derivations?.some(d => d.id === 'cover') ?? false;
  const cover = useAsync('cover', () => (hasCover ? handle.image() : Promise.resolve(null)));
  const coverValue = cover.status === 'ok' ? cover.value : null;
  const coverUrl = useObjectUrl(
    useBlob(coverValue?.bytes ?? null, coverValue?.mime ?? 'application/octet-stream'),
  );
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [failed, setFailed] = useState(false);

  return (
    <div className={styles.audio}>
      <div className={styles.audioBody}>
        <div className={styles.head}>
          {coverUrl && (
            <img
              data-testid="media-cover"
              className={styles.cover}
              src={coverUrl}
              alt="Cover art"
            />
          )}
          {url && (
            <audio
              ref={setAudio}
              data-testid="media-audio"
              className={styles.player}
              src={url}
              controls
              preload="metadata"
              onError={() => setFailed(true)}
            />
          )}
        </div>
        {failed && <div className={styles.note}>Chromium can't play this file ({mime}).</div>}
        <Waveform bytes={bytes} audio={audio} />
      </div>
      {!failed && <TrimBar selection={selection} player={audio} />}
    </div>
  );
}

function seekTo(el: HTMLMediaElement, seconds: number) {
  el.currentTime = seconds;
}

function Waveform({
  bytes,
  audio,
}: {
  bytes: Uint8Array<ArrayBuffer>;
  audio: HTMLAudioElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoded = useAsync('decode', async () => channelData(await decodeAudio(bytes)));
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || decoded.status !== 'ok') return;
    const channels = decoded.value;
    let peaks: Float32Array = new Float32Array(0);

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { width, height } = canvas;
      const bars = peaks.length;
      const progress =
        audio && Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.currentTime / audio.duration
          : 0;
      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;
      for (let i = 0; i < bars; i++) {
        const h = Math.max(1, (peaks[i] ?? 0) * (height - 4));
        ctx.fillStyle = i / bars < progress ? theme.accent : theme.muted;
        ctx.fillRect(i * 2, mid - h / 2, 1, h);
      }
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      peaks = computePeaks(channels, Math.floor(canvas.width / 2));
      draw();
      setDrawn(true);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    audio?.addEventListener('timeupdate', draw);
    audio?.addEventListener('seeked', draw);
    return () => {
      observer.disconnect();
      audio?.removeEventListener('timeupdate', draw);
      audio?.removeEventListener('seeked', draw);
    };
  }, [decoded, audio]);

  const seek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!audio || !Number.isFinite(audio.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(audio, ((e.clientX - rect.left) / rect.width) * audio.duration);
  };

  if (decoded.status === 'error') {
    return <div className={styles.note}>No waveform: the browser couldn't decode this audio.</div>;
  }
  return (
    <canvas
      ref={canvasRef}
      data-testid="waveform"
      data-drawn={drawn}
      className={styles.waveform}
      onClick={seek}
      title="Click to seek"
    />
  );
}
