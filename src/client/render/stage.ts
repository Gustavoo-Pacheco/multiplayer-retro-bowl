// The 640 x 360 canvas, scaled evenly to fit the window, with menus layered above it.
// Its buffer is RES times that, and drawing code works in the 640 x 360 grid.
import { H, RES, W } from './view';

export class Stage {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  overlay: HTMLDivElement;
  scale = 1;
  private onResize = () => this.fit();

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'stage';
    this.root.dataset.testid = 'stage';
    this.canvas = document.createElement('canvas');
    this.canvas.width = W * RES;
    this.canvas.height = H * RES;
    this.canvas.dataset.testid = 'canvas';
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.ctx.setTransform(RES, 0, 0, RES, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.root.append(this.canvas, this.overlay);
    parent.append(this.root);
    addEventListener('resize', this.onResize);
    addEventListener('orientationchange', this.onResize);
    this.fit();
  }

  fit(): void {
    const vw = innerWidth;
    const vh = innerHeight;
    let s = Math.min(vw / W, vh / H);
    const whole = Math.floor(s);
    if (whole >= 1 && s - whole < 0.05) s = whole; // exact multiples stay crisp at 720p, 1080p, 1440p, 4K
    this.scale = s;
    this.root.style.width = `${Math.floor(W * s)}px`;
    this.root.style.height = `${Math.floor(H * s)}px`;
    this.root.style.setProperty('--u', `${s}px`);
  }

  /** Converts client coordinates to canvas pixels. */
  toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * W, y: ((clientY - r.top) / r.height) * H };
  }

  destroy(): void {
    removeEventListener('resize', this.onResize);
    removeEventListener('orientationchange', this.onResize);
    this.root.remove();
  }
}
