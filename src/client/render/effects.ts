// Dust, contact bursts, confetti and fireworks. Nothing here affects the game.
import { PY, screenX, screenY, W } from './view';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; gravity: number; screen: boolean }

const CAP = 400;

export class Effects {
  private p: Particle[] = [];

  private add(q: Particle): void { if (this.p.length < CAP) this.p.push(q); }

  /** A puff of grass where someone hits the ground, in world yards. */
  dust(x: number, y: number, n = 6): void {
    for (let i = 0; i < n; i++) {
      this.add({ x, y, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 1.6, life: 0, max: 0.35 + Math.random() * 0.25, color: Math.random() < 0.5 ? '#c9b98a' : '#7fb77a', size: 2, gravity: 4, screen: false });
    }
  }

  /** A white star of sparks at a hard hit. */
  burst(x: number, y: number): void {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      this.add({ x, y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4 - 1, life: 0, max: 0.2, color: i % 2 ? '#fff' : '#ffd23f', size: 2, gravity: 0, screen: false });
    }
  }

  confetti(colors: string[], n = 120): void {
    for (let i = 0; i < n; i++) {
      this.add({ x: Math.random() * W, y: -Math.random() * 120, vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 60, life: 0, max: 2.4 + Math.random() * 1.4, color: colors[i % colors.length], size: 2, gravity: 8, screen: true });
    }
  }

  firework(colors: string[], x = 80 + Math.random() * 480, y = 30 + Math.random() * 90): void {
    const c = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const s = 40 + Math.random() * 45;
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.8 + Math.random() * 0.5, color: i % 3 ? c : '#fff', size: 2, gravity: 50, screen: true });
    }
  }

  update(dt: number): void {
    for (const q of this.p) {
      q.life += dt;
      q.vy += q.gravity * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    this.p = this.p.filter((q) => q.life < q.max);
  }

  drawWorld(ctx: CanvasRenderingContext2D, cam: number): void {
    for (const q of this.p) {
      if (q.screen) continue;
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(screenX(q.x, cam)), Math.round(screenY(q.y) - 6), q.size, q.size);
    }
    void PY;
  }

  drawScreen(ctx: CanvasRenderingContext2D): void {
    for (const q of this.p) {
      if (!q.screen) continue;
      ctx.globalAlpha = Math.min(1, (q.max - q.life) * 4);
      ctx.fillStyle = q.color;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void { this.p = []; }
  get count(): number { return this.p.length; }
}
