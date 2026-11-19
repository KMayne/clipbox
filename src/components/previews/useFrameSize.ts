import { useEffect, useState } from 'react';
import type { Size } from './cropGeometry';

/** The video's frame size in pixels, once its metadata has loaded. */
export function useFrameSize(video: HTMLVideoElement | null): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    if (!video) return;
    const update = () =>
      setSize(
        video.videoWidth && video.videoHeight
          ? { width: video.videoWidth, height: video.videoHeight }
          : null,
      );
    update();
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
    };
  }, [video]);
  return size;
}
