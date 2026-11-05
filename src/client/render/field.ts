// Draws the whole field once into an offscreen canvas, then blits the visible part.
import { T } from '../../shared/sim/tuning';
import { FIELD_TOP, PX, PY, H } from './view';

const MARGIN_YARDS = 6;

export interface EndZoneInfo { leftColor: string; rightColor: string; leftName: string; rightName: string; trimLeft: string; trimRight: string }

export interface FieldArt { canvas: HTMLCanvasElement; offsetX: number }

export function buildField(ez: EndZoneInfo): FieldArt {
  const c = document.createElement('canvas');
  const totalYards = T.field.len + MARGIN_YARDS * 2;
  c.width = Math.ceil(totalYards * PX);
  c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => (x + MARGIN_YARDS) * PX;
  const top = FIELD_TOP;
  const fh = T.view.fieldH;
  g.fillStyle = '#2d5a33';
  g.fillRect(0, 0, c.width, H);
  g.fillStyle = '#26303b';
  g.fillRect(0, 0, c.width, T.view.standsH);
  // Grass bands every 5 yards.
  for (let x = -5; x < T.field.len + 5; x += 5) {
    g.fillStyle = Math.round(x / 5) % 2 === 0 ? '#3f8a44' : '#378039';
    g.fillRect(X(x), top, 5 * PX + 1, fh);
  }
  g.fillStyle = ez.leftColor; g.fillRect(X(0), top, 10 * PX, fh);
  g.fillStyle = ez.rightColor; g.fillRect(X(110), top, 10 * PX, fh);
  g.fillStyle = '#f4f4ee';
  for (let x = 10; x <= 110; x += 5) g.fillRect(Math.round(X(x)) - (x === 10 || x === 110 ? 1 : 0), top, x === 10 || x === 110 ? 3 : 1, fh);
  g.fillRect(X(0), top - 1, 120 * PX, 2);
  g.fillRect(X(0), top + fh - 1, 120 * PX, 2);
  g.fillRect(X(0) - 1, top, 2, fh);
  g.fillRect(X(120) - 1, top, 2, fh);
  return { canvas: c, offsetX: MARGIN_YARDS * PX };
}

export function drawField(ctx: CanvasRenderingContext2D, art: FieldArt, cam: number): void {
  const sx = (cam + T.field.len * 0) * PX + art.offsetX - ctx.canvas.width / 2;
  ctx.drawImage(art.canvas, Math.round(-sx), 0);
  void PY;
}
