// The watcher's frame buffer: holds about 150 ms, smooths between frames, and holds still when it runs dry.
import { decodeFrame, emptyFrame, type Frame, PLAYER_COUNT } from '../../shared/protocol';
import { T } from '../../shared/sim/tuning';

export class FrameBuffer {
  private frames: Frame[] = [];
  private playId = -1;
  private playTick = 0;
  private started = false;
  /** How many times playback caught up with the newest frame and had to hold. */
  underruns = 0;
  received = 0;
  /** The longest time playback held still waiting for a frame, in ms. */
  worstHoldMs = 0;
  private holdStart = 0;
  evPending = 0;
  readonly out: Frame = emptyFrame();

  reset(playId: number): void {
    this.playId = playId;
    this.frames = [];
    this.started = false;
    this.playTick = 0;
    this.holdStart = 0;
  }

  /** The new controller's frames continue the same tick count, so nothing else needs to change. */
  push(buf: ArrayBuffer): Frame | null {
    const f = decodeFrame(buf);
    if (f.playId !== (this.playId & 0xffff)) return null;
    const lastTick = this.frames.length ? this.frames[this.frames.length - 1].tick : -1;
    if (f.tick < lastTick) return null;
    this.frames.push(f);
    this.received += 1;
    this.evPending |= f.ev;
    return f;
  }

  /** Advances playback and writes the interpolated frame to `out`. Returns false with nothing to show. */
  update(dtMs: number, speed: number, nowMs: number): boolean {
    const fr = this.frames;
    if (!fr.length) return false;
    const tickPerMs = (T.hz / 1000) * speed;
    const newest = fr[fr.length - 1].tick;
    const wantTicks = T.net.bufferMs * tickPerMs;
    if (!this.started) {
      if (newest - fr[0].tick < wantTicks) { this.copy(fr[0], fr[0], 0); return true; }
      this.started = true;
      this.playTick = fr[0].tick;
    }
    const before = this.playTick;
    this.playTick += dtMs * tickPerMs;
    const maxTicks = T.net.bufferMaxMs * tickPerMs;
    if (newest - this.playTick > maxTicks) this.playTick = newest - wantTicks;
    if (this.playTick >= newest) {
      // Frames stop for good when a play ends, so running dry there isn't a stutter.
      if (before < newest && fr[fr.length - 1].phase !== 'dead') this.underruns += 1;
      this.playTick = newest;
      if (!this.holdStart) this.holdStart = nowMs;
      if (fr[fr.length - 1].phase !== 'dead') this.worstHoldMs = Math.max(this.worstHoldMs, nowMs - this.holdStart);
    } else this.holdStart = 0;
    while (fr.length > 2 && fr[1].tick <= this.playTick) fr.shift();
    const a = fr[0];
    const b = fr[1] ?? fr[0];
    const span = b.tick - a.tick;
    const k = span > 0 ? Math.max(0, Math.min(1, (this.playTick - a.tick) / span)) : 0;
    this.copy(a, b, k);
    return true;
  }

  private copy(a: Frame, b: Frame, k: number): void {
    const o = this.out;
    const lerp = (x: number, y: number) => x + (y - x) * k;
    o.playId = a.playId; o.tick = Math.round(lerp(a.tick, b.tick)); o.clock = lerp(a.clock, b.clock);
    o.bx = lerp(a.bx, b.bx); o.by = lerp(a.by, b.by); o.bz = lerp(a.bz, b.bz);
    o.ax = a.ax; o.ay = a.ay; o.aimOn = a.aimOn; o.phase = a.phase; o.carrier = a.carrier; o.meter = a.meter; o.ev = 0;
    for (let i = 0; i < PLAYER_COUNT; i++) {
      o.px[i] = lerp(a.px[i], b.px[i]);
      o.py[i] = lerp(a.py[i], b.py[i]);
      o.anim[i] = a.anim[i]; o.face[i] = a.face[i]; o.stunned[i] = a.stunned[i];
    }
  }
}
