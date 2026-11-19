/**
 * Media times as the Trim and Video frame settings write them, shared by the action code and
 * the player's trim bar. No imports, so the UI can use it.
 */

/** Seconds from the start, or a fraction (0–1) of the way through. */
export type FrameTime = { seconds: number } | { fraction: number };
/** A frame time, or seconds before the end. */
export type TrimPoint = FrameTime | { beforeEnd: number };

/** "12.5" → 12.5 s, "1:02:03.5" → 3723.5 s, "10%" → a tenth of the way through. */
export function parseFrameTime(text: string): FrameTime {
  const t = text.trim().replace(/\s*s$/, '');
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1).trim());
    if (!Number.isFinite(pct) || pct > 100) throw new Error(`Invalid percentage '${text.trim()}'`);
    return { fraction: pct / 100 };
  }
  const parts = t.split(':').map(Number);
  if (!parts.length || parts.some(n => !Number.isFinite(n))) {
    throw new Error(`Invalid time '${text.trim()}'`);
  }
  return { seconds: parts.reduce((acc, n) => acc * 60 + n, 0) };
}

/** A Trim setting: "" → undefined (the end), "-5" → 5 s before the end, else as a frame time. */
export function parseTrimPoint(text: string): TrimPoint | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (t.startsWith('-')) {
    const at = parseFrameTime(t.slice(1));
    if (!('seconds' in at)) throw new Error(`Invalid time '${t}'`);
    return { beforeEnd: at.seconds };
  }
  return parseFrameTime(t);
}

/** "5", "65.25" → "0:05", "1:05.25"; hours when needed, to the hundredth. */
export function clock(seconds: number): string {
  const cs = Math.round(Math.max(0, seconds) * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  const frac = cs % 100 ? `.${String(cs % 100).padStart(2, '0')}`.replace(/0$/, '') : '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h ? `${h}:${pad(m)}` : m}:${pad(s)}${frac}`;
}

/** A point as seconds from the start of media running from `first` to `duration`. */
export function pointSeconds(point: TrimPoint, first: number, duration: number): number {
  if ('fraction' in point) return first + (duration - first) * point.fraction;
  if ('beforeEnd' in point) return duration - point.beforeEnd;
  return point.seconds;
}
