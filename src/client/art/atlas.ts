// Recolours the composed sprites for a kit and bakes them into an offscreen canvas.
import { BUILDS, type BuildName } from './parts';
import { ART_SCALE, CELL_H, CELL_W, CELLS, cellIndex, composedCells } from './compose';
import { paletteFor, SKINS, type Kit } from './palette';

const COLS = 20;
// The atlas keeps one pixel per art pixel, and draw() scales it up by a whole number of canvas pixels.
const ART_W = CELL_W / ART_SCALE;
const ART_H = CELL_H / ART_SCALE;

export class Atlas {
  canvas: HTMLCanvasElement;
  constructor(kit: Kit, skinIndex: number) {
    const cells = composedCells();
    const rows = Math.ceil(cells.length / COLS);
    const c = document.createElement('canvas');
    c.width = COLS * ART_W;
    c.height = rows * ART_H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(c.width, c.height);
    const data = new Uint32Array(img.data.buffer);
    const pal = new Map<string, number>();
    for (const [k, hex] of Object.entries(paletteFor(kit, SKINS[skinIndex]))) {
      const r = parseInt(hex.slice(1, 3), 16);
      const gr = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      pal.set(k, (255 << 24) | (b << 16) | (gr << 8) | r);
    }
    cells.forEach((cell, i) => {
      const ox = (i % COLS) * ART_W;
      const oy = Math.floor(i / COLS) * ART_H;
      for (let y = 0; y < ART_H; y++) {
        const row = cell.rows[y * ART_SCALE];
        for (let x = 0; x < ART_W; x++) {
          const ch = row[x * ART_SCALE];
          if (ch !== '.') data[(oy + y) * c.width + ox + x] = pal.get(ch) ?? 0xffff00ff;
        }
      }
    });
    g.putImageData(img, 0, 0);
    this.canvas = c;
  }

  /**
   * Draws one frame with its feet at (x, y). At scale 1 an art pixel is ART_SCALE pixels of the
   * target; a smaller scale needs a target with enough pixels to keep that a whole number.
   */
  draw(ctx: CanvasRenderingContext2D, build: BuildName, name: string, frame: number, x: number, y: number, face: number, scale = 1): void {
    const i = cellIndex(build, name, frame);
    const sx = (i % COLS) * ART_W;
    const sy = Math.floor(i / COLS) * ART_H;
    const u = ART_SCALE * scale;
    const w = ART_W * u;
    const h = ART_H * u;
    // Snapping to the art grid keeps figures as chunky as they are drawn.
    const dx = Math.round(x / u) * u - w / 2;
    const dy = Math.round(y / u) * u - h + u;
    ctx.imageSmoothingEnabled = false;
    if (face >= 0) ctx.drawImage(this.canvas, sx, sy, ART_W, ART_H, dx, dy, w, h);
    else {
      ctx.save();
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.canvas, sx, sy, ART_W, ART_H, 0, 0, w, h);
      ctx.restore();
    }
  }
}

/** Both kits in all four skin tones, baked once at the start of a match. */
export class AtlasSet {
  private map = new Map<string, Atlas>();
  get(kit: Kit, skin: number): Atlas {
    const key = `${kit.helmet}${kit.jersey}${kit.trim}${kit.pants}:${skin}`;
    let a = this.map.get(key);
    if (!a) { a = new Atlas(kit, skin); this.map.set(key, a); }
    return a;
  }
  /** Bakes ahead of time, so the first frame of a match doesn't hitch. */
  prepare(kits: Kit[]): void { for (const k of kits) for (let s = 0; s < SKINS.length; s++) this.get(k, s); }
}

export const ATLAS = new AtlasSet();
export const CELL_COUNT = CELLS.length;
export const BUILD_NAMES = Object.keys(BUILDS) as BuildName[];
