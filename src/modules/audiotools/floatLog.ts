const CHUNK = 1 << 16;

/** An append-only list of float32 values, grown in chunks so long files don't keep reallocating. */
export class FloatLog {
  private chunks: Float32Array[] = [];
  private current = new Float32Array(CHUNK);
  private used = 0;

  get length(): number {
    return this.chunks.length * CHUNK + this.used;
  }

  push(v: number): void {
    if (this.used === CHUNK) {
      this.chunks.push(this.current);
      this.current = new Float32Array(CHUNK);
      this.used = 0;
    }
    this.current[this.used++] = v;
  }

  /** Raises the value at `i` to at least `v`, appending zeros up to `i` if needed. */
  max(i: number, v: number): void {
    while (this.length <= i) this.push(0);
    const chunk = Math.floor(i / CHUNK);
    const at = i % CHUNK;
    const target = chunk < this.chunks.length ? this.chunks[chunk] : this.current;
    if (target && v > (target[at] ?? 0)) target[at] = v;
  }

  toArray(): Float32Array<ArrayBuffer> {
    const out = new Float32Array(this.length);
    this.chunks.forEach((c, i) => out.set(c, i * CHUNK));
    out.set(this.current.subarray(0, this.used), this.chunks.length * CHUNK);
    return out;
  }
}
