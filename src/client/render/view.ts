// Screen layout. World yards to canvas pixels.
import { T } from '../../shared/sim/tuning';

export const W = T.view.w;
export const H = T.view.h;
export const PX = W / T.view.yards;
export const FIELD_TOP = T.view.standsH + T.view.walkH + T.view.stripH;
export const PY = T.view.fieldH / T.field.width;

export function screenX(x: number, cam: number): number { return (x - cam) * PX + W / 2; }
export function screenY(y: number): number { return FIELD_TOP + y * PY; }

export class Camera {
  x = 60;
  /** Eases toward a target, keeping the view on the field. */
  follow(target: number, dt: number): void {
    const k = Math.min(1, dt * T.view.camEase);
    this.x += (this.clamp(target) - this.x) * k;
  }
  snap(target: number): void { this.x = this.clamp(target); }
  clamp(x: number): number {
    const half = T.view.yards / 2;
    return Math.max(half - 3, Math.min(T.field.len - half + 3, x));
  }
}
