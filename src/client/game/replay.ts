// Plays back the frames this page already sent or received, so replays need no download.
import { emptyFrame, PLAYER_COUNT, type Frame } from '../../shared/protocol';
import { T } from '../../shared/sim/tuning';

export class ReplayBuffer {
  frames: Frame[] = [];
  readonly out: Frame = emptyFrame();
  private tick = 0;
  active = false;

  reset(): void { this.frames = []; this.active = false; }

  add(f: Frame): void {
    const last = this.frames[this.frames.length - 1];
    if (last && f.tick <= last.tick) return;
    this.frames.push(f);
    // About a minute of frames, far more than one play needs.
    if (this.frames.length > 1200) this.frames.shift();
  }

  /** Starts from a point that lets the last moments fit the replay's time. */
  begin(): boolean {
    if (this.frames.length < 2) return false;
    const last = this.frames[this.frames.length - 1].tick;
    const span = (T.timers.replay / 1000) * T.hz * T.replay.rate;
    this.tick = Math.max(this.frames[0].tick, last - span);
    this.active = true;
    return true;
  }

  update(dtMs: number): Frame | null {
    if (!this.active || !this.frames.length) return null;
    this.tick += (dtMs / 1000) * T.hz * T.replay.rate;
    const fr = this.frames;
    let i = 0;
    while (i + 1 < fr.length && fr[i + 1].tick <= this.tick) i++;
    const a = fr[i];
    const b = fr[Math.min(fr.length - 1, i + 1)];
    const span = b.tick - a.tick;
    const k = span > 0 ? Math.max(0, Math.min(1, (this.tick - a.tick) / span)) : 0;
    const lerp = (x: number, y: number) => x + (y - x) * k;
    const o = this.out;
    o.playId = a.playId; o.tick = Math.round(lerp(a.tick, b.tick)); o.clock = lerp(a.clock, b.clock);
    o.bx = lerp(a.bx, b.bx); o.by = lerp(a.by, b.by); o.bz = lerp(a.bz, b.bz);
    o.ax = a.ax; o.ay = a.ay; o.aimOn = false; o.phase = a.phase; o.carrier = a.carrier; o.meter = 0; o.ev = 0;
    for (let n = 0; n < PLAYER_COUNT; n++) {
      o.px[n] = lerp(a.px[n], b.px[n]);
      o.py[n] = lerp(a.py[n], b.py[n]);
      o.anim[n] = a.anim[n]; o.face[n] = a.face[n]; o.stunned[n] = a.stunned[n];
    }
    return o;
  }
}
