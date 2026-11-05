// Turns pointer events into simulation inputs. Pure logic with no DOM, so it can be unit tested.
// Events are queued as they happen, so very short taps still count.
import { T } from '../../shared/sim/tuning';
import type { SimInput, SimPhase } from '../../shared/sim/state';
import { PX, PY } from '../render/view';

export interface GestureContext {
  phase: SimPhase;
  /** The player in control here. False while watching. */
  active: boolean;
  /** Canvas positions of the QB and RB, for tap targets. */
  qb: { x: number; y: number } | null;
  rb: { x: number; y: number } | null;
  handoffOpen: boolean;
}

type Mode = 'none' | 'pending' | 'aim' | 'run' | 'done';

interface Press { id: number; x0: number; y0: number; t0: number; x: number; y: number; mode: Mode; pendingOn: 'rb' | 'qb' | null; ox: number; oy: number; ot: number; truck: boolean; moved: boolean }

const dist = (p: { x: number; y: number } | null, x: number, y: number): number =>
  (p ? Math.hypot(p.x - x, p.y - 12 - y) : 1e9);
const hit = (p: { x: number; y: number } | null, x: number, y: number): boolean => dist(p, x, y) <= T.input.touchRadius;

export class GestureRecognizer {
  private press: Press | null = null;
  ctx: GestureContext = { phase: 'pre', active: false, qb: null, rb: null, handoffOpen: false };
  out: SimInput[] = [];

  private emit(i: SimInput): void { this.out.push(i); }
  drain(): SimInput[] { const o = this.out; this.out = []; return o; }

  down(id: number, x: number, y: number, t: number, button = 0): void {
    if (!this.ctx.active) return;
    if (this.press && this.press.id !== id) {
      // A second finger while aiming is the bullet pass.
      if (this.press.mode === 'aim') this.emit({ k: 'bullet' });
      return;
    }
    if (button === 2) {
      if (this.press?.mode === 'aim') this.emit({ k: 'bullet' });
      return;
    }
    const p: Press = { id, x0: x, y0: y, t0: t, x, y, mode: 'none', pendingOn: null, ox: x, oy: y, ot: t, truck: false, moved: false };
    this.press = p;
    switch (this.ctx.phase) {
      case 'pre': this.emit({ k: 'snap' }); p.mode = 'done'; break;
      case 'kickPower': case 'kickAim': case 'kickFlight': this.emit({ k: 'tap' }); p.mode = 'done'; break;
      case 'pocket':
        {
          // Touch targets overlap, so the nearer player wins.
          const onRb = this.ctx.handoffOpen && hit(this.ctx.rb, x, y);
          const onQb = hit(this.ctx.qb, x, y);
          if (onRb && (!onQb || dist(this.ctx.rb, x, y) < dist(this.ctx.qb, x, y))) { p.mode = 'pending'; p.pendingOn = 'rb'; }
          else if (onQb) { p.mode = 'pending'; p.pendingOn = 'qb'; }
          else this.beginAim(p);
        }
        break;
      case 'run': p.mode = 'run'; this.emit({ k: 'tap' }); break;
      default: p.mode = 'none';
    }
  }

  /** The right mouse button, pressed while another button is held. */
  rightClick(): void { if (this.press?.mode === 'aim') this.emit({ k: 'bullet' }); }

  private beginAim(p: Press): void {
    p.mode = 'aim';
    this.emit({ k: 'aimStart' });
    this.emitAim(p);
  }

  private emitAim(p: Press): void {
    // Slingshot: drag away from the target. Pixels become yards at the field's own scale.
    const s = T.input.aimScale;
    const dx = (p.x0 - p.x) * s;
    const dy = (p.y0 - p.y) * s * (PX / PY);
    this.emit({ k: 'aim', dx, dy });
  }

  move(id: number, x: number, y: number, t: number): void {
    const p = this.press;
    if (!p || p.id !== id) return;
    p.x = x; p.y = y;
    if (p.mode === 'pending') {
      if (Math.hypot(x - p.x0, y - p.y0) >= T.input.tapMaxMove) this.beginAim(p);
      return;
    }
    if (p.mode === 'aim') { this.emitAim(p); return; }
    if (p.mode === 'run') {
      const dx = x - p.ox;
      const dy = y - p.oy;
      const d = Math.hypot(dx, dy);
      if (d >= T.input.tapMaxMove && p.truck) { p.truck = false; this.emit({ k: 'truck', on: false }); }
      if (d >= T.input.swipePx) {
        if (t - p.ot <= T.input.swipeMs) this.emit({ k: 'swipe', dx, dy });
        p.ox = x; p.oy = y; p.ot = t; p.moved = true;
      } else if (t - p.ot > T.input.swipeMs) {
        if (d >= T.input.tapMaxMove) { p.ox = x; p.oy = y; p.moved = true; }
        p.ot = t;
      }
    }
  }

  up(id: number, _x: number, _y: number, t: number): void {
    const p = this.press;
    if (!p || p.id !== id) return;
    if (p.mode === 'pending') {
      if (t - p.t0 <= T.input.tapMaxMs) this.emit(p.pendingOn === 'rb' ? { k: 'handoff' } : { k: 'qbRun' });
    } else if (p.mode === 'aim') {
      this.emit({ k: 'throw' });
    } else if (p.truck) {
      this.emit({ k: 'truck', on: false });
    }
    this.press = null;
  }

  cancel(id: number): void {
    const p = this.press;
    if (!p || p.id !== id) return;
    if (p.mode === 'aim') this.emit({ k: 'aimCancel' });
    if (p.truck) this.emit({ k: 'truck', on: false });
    this.press = null;
  }

  /** Runs each frame, for time-based gestures. Also resets when the play moves on. */
  tick(t: number): void {
    const p = this.press;
    if (!p) return;
    if (p.mode === 'pending' && t - p.t0 > T.input.tapMaxMs) { this.beginAim(p); return; }
    if ((p.mode === 'aim' || p.mode === 'pending') && this.ctx.phase !== 'pocket') p.mode = 'none';
    if (p.mode === 'none' && this.ctx.phase === 'run' && this.ctx.active) { p.mode = 'run'; p.ox = p.x; p.oy = p.y; p.ot = t; p.t0 = t; p.moved = false; }
    if (p.mode === 'run') {
      if (this.ctx.phase !== 'run') { if (p.truck) this.emit({ k: 'truck', on: false }); p.truck = false; p.mode = 'done'; return; }
      if (!p.truck && !p.moved && t - p.t0 >= T.input.truckHoldMs && Math.hypot(p.x - p.ox, p.y - p.oy) < T.input.tapMaxMove) {
        p.truck = true;
        this.emit({ k: 'truck', on: true });
      }
    }
  }

  reset(): void { this.press = null; this.out = []; }
}
