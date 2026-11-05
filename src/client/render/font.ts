// A 5 x 7 bitmap font for the canvas: original glyphs, one hex pair per row.
const GLYPHS: Record<string, string> = {
  A: '0e1111 1f111111', B: '1e11111e11111e', C: '0e11101010110e', D: '1e11111111111e', E: '1f10101e10101f', F: '1f10101e101010',
  G: '0e111017111 10f', H: '1111111f111111', I: '0e04040404040e', J: '0702020202120c', K: '11121418141211', L: '1010101010101f',
  M: '111b1515111111', N: '11191513111111', O: '0e11111111110e', P: '1e11111e101010', Q: '0e11111115120d', R: '1e11111e141211',
  S: '0f10100e01011e', T: '1f040404040404', U: '1111111111110e', V: '1111111111 0a04', W: '11111115151b11', X: '11110a040a1111',
  Y: '11110a04040404', Z: '1f01020408101f',
  0: '0e11131519110e', 1: '040c040404040e', 2: '0e11010204081f', 3: '1f02040201110e', 4: '02060a121f0202', 5: '1f101e0101110e',
  6: '0608101e11110e', 7: '1f010204080808', 8: '0e11110e11110e', 9: '0e11110f01020c',
  ':': '00040400040400', '.': '0000000000 0c0c', ',': '000000000c0408', '!': '04040404040004', '?': '0e110102040004',
  '-': '0000001f000000', '+': '0004041f040400', '&': '0c1214081512 0d', '/': '01010204081010', "'": '04040800000000',
  '(': '02040808080402', ')': '08040202020408', '#': '0a0a1f0a1f0a0a', '*': '0004150e150400', ' ': '00000000000000',
  '>': '08040201020408', '<': '02040810080402', '=': '00001f001f0000', '%': '19190204081313',
};

const parsed = new Map<string, number[]>();
for (const [ch, hex] of Object.entries(GLYPHS)) {
  const h = hex.replace(/ /g, '');
  const rows: number[] = [];
  for (let i = 0; i < 14; i += 2) rows.push(parseInt(h.slice(i, i + 2), 16));
  parsed.set(ch, rows);
}

/** The glyph bitmaps by character, one number per row. tools/make-font.ts builds the menu font from these. */
export const GLYPH_ROWS: Record<string, number[]> = Object.fromEntries(parsed);

export const CHAR_H = 7;
const SPACE_W = 3;

/**
 * Where a glyph's ink starts, and how wide it is. Letters are as wide as they're drawn, so an I doesn't sit in
 * gaps. Digits all keep the full width, so a running clock doesn't shuffle sideways.
 */
export function glyphBox(ch: string): { left: number; width: number } {
  if (ch === ' ') return { left: 0, width: SPACE_W };
  const rows = GLYPH_ROWS[ch];
  if (!rows || (ch >= '0' && ch <= '9')) return { left: 0, width: 5 };
  let lo = 5;
  let hi = -1;
  for (const bits of rows) for (let c = 0; c < 5; c++) if (bits & (16 >> c)) { lo = Math.min(lo, c); hi = Math.max(hi, c); }
  return hi < 0 ? { left: 0, width: SPACE_W } : { left: lo, width: hi - lo + 1 };
}

export function textWidth(text: string, scale = 1): number {
  let w = 0;
  for (const ch of text) w += glyphBox(ch.toUpperCase()).width + 1;
  return Math.max(0, w - 1) * scale;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = '#fff', scale = 1): void {
  ctx.fillStyle = color;
  let px = Math.round(x);
  const py = Math.round(y);
  for (const raw of text) {
    const ch = raw.toUpperCase();
    const rows = parsed.get(ch) ?? parsed.get(' ')!;
    const box = glyphBox(ch);
    for (let r = 0; r < 7; r++) {
      const bits = rows[r];
      if (!bits) continue;
      for (let c = 0; c < 5; c++) if (bits & (16 >> c)) ctx.fillRect(px + (c - box.left) * scale, py + r * scale, scale, scale);
    }
    px += (box.width + 1) * scale;
  }
}

export function drawTextCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color = '#fff', scale = 1): void {
  drawText(ctx, text, cx - textWidth(text, scale) / 2, y, color, scale);
}

/** White pixel text on a black strip, centred. */
export function drawStrip(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color = '#fff', scale = 1, bg = '#000'): void {
  const w = textWidth(text, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(Math.round(cx - w / 2 - 4 * scale), Math.round(y - 3 * scale), w + 8 * scale, 7 * scale + 6 * scale);
  drawText(ctx, text, cx - w / 2, y, color, scale);
}
