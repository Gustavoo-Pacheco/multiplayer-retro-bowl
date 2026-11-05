// Builds the menu font from the same 5 x 7 glyphs the canvas uses, so the whole game shares one typeface.
// Run with: npx tsx tools/make-font.ts
import { writeFileSync } from 'node:fs';
import { GLYPH_ROWS } from '../src/client/render/font';

const UNIT = 100; // One font pixel, in font units.
const EM = UNIT * 8;
const ASC = UNIT * 7;
const DESC = UNIT;
const ADV = UNIT * 6;

class Writer {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 255); return this; }
  u16(v: number) { return this.u8(v >> 8).u8(v); }
  i16(v: number) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number) { return this.u16(Math.floor(v / 65536)).u16(v % 65536); }
  tag(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  pad() { while (this.bytes.length % 4) this.u8(0); return this; }
}

function checksum(b: number[]): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) sum = (sum + ((b[i] << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) >>> 0) + (((b[i + 2] ?? 0) << 8) >>> 0) + (b[i + 3] ?? 0)) % 4294967296;
  return sum;
}

/** Each lit run in a row becomes one rectangle. Rows that overlap simply add up, which renders the same. */
function rectsFor(rows: number[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  rows.forEach((bits, r) => {
    let c = 0;
    while (c < 5) {
      if (!(bits & (16 >> c))) { c++; continue; }
      const start = c;
      while (c < 5 && bits & (16 >> c)) c++;
      out.push([start * UNIT, (6 - r) * UNIT, c * UNIT, (7 - r) * UNIT]);
    }
  });
  return out;
}

function glyphData(rects: [number, number, number, number][]): number[] {
  if (!rects.length) return [];
  const w = new Writer();
  const xMin = Math.min(...rects.map((q) => q[0]));
  const yMin = Math.min(...rects.map((q) => q[1]));
  const xMax = Math.max(...rects.map((q) => q[2]));
  const yMax = Math.max(...rects.map((q) => q[3]));
  w.i16(rects.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  rects.forEach((_, i) => w.u16(i * 4 + 3));
  w.u16(0); // No instructions.
  for (let i = 0; i < rects.length * 4; i++) w.u8(1); // All on-curve, with 16-bit deltas.
  let px = 0;
  let py = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x0, y0, x1, y1] of rects) {
    // Clockwise, which TrueType treats as filled.
    for (const [x, y] of [[x0, y0], [x0, y1], [x1, y1], [x1, y0]]) { xs.push(x - px); ys.push(y - py); px = x; py = y; }
  }
  xs.forEach((v) => w.i16(v));
  ys.forEach((v) => w.i16(v));
  while (w.bytes.length % 2) w.u8(0);
  return w.bytes;
}

// Glyph 0 is the empty fallback. Lowercase letters share the capitals' shapes.
const chars = Object.keys(GLYPH_ROWS).filter((c) => c !== ' ').sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0));
const glyphs: number[][] = [[], [], ...chars.map((c) => glyphData(rectsFor(GLYPH_ROWS[c])))];
const map = new Map<number, number>([[32, 1]]);
chars.forEach((c, i) => {
  map.set(c.charCodeAt(0), i + 2);
  if (c >= 'A' && c <= 'Z') map.set(c.toLowerCase().charCodeAt(0), i + 2);
});

const glyf = new Writer();
const loca = new Writer();
for (const g of glyphs) { loca.u32(glyf.bytes.length); glyf.bytes.push(...g); }
loca.u32(glyf.bytes.length);

const head = new Writer();
head.u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(EM).u32(0).u32(0).u32(0).u32(0)
  .i16(0).i16(-DESC).i16(ADV).i16(ASC).u16(0).u16(7).i16(2).i16(1).i16(0);
const hhea = new Writer();
hhea.u32(0x00010000).i16(ASC).i16(-DESC).i16(0).u16(ADV).i16(0).i16(0).i16(ADV).i16(1).i16(0).i16(0);
for (let i = 0; i < 4; i++) hhea.i16(0);
hhea.i16(0).u16(glyphs.length);
const hmtx = new Writer();
for (let i = 0; i < glyphs.length; i++) hmtx.u16(ADV).i16(0);
const maxp = new Writer();
const maxRects = Math.max(...chars.map((c) => rectsFor(GLYPH_ROWS[c]).length));
maxp.u32(0x00010000).u16(glyphs.length).u16(maxRects * 4).u16(maxRects);
for (let i = 0; i < 2; i++) maxp.u16(0);
maxp.u16(2);
for (let i = 0; i < 8; i++) maxp.u16(0);

const codes = [...map.keys()].sort((a, b) => a - b);
const cmap = new Writer();
cmap.u16(0).u16(1).u16(3).u16(1).u32(12);
const segs = [...codes, 0xffff];
const n = segs.length;
const search = 2 * 2 ** Math.floor(Math.log2(n));
cmap.u16(4).u16(16 + n * 8).u16(0).u16(n * 2).u16(search).u16(Math.floor(Math.log2(n))).u16(n * 2 - search);
segs.forEach((c) => cmap.u16(c));
cmap.u16(0);
segs.forEach((c) => cmap.u16(c));
segs.forEach((c) => cmap.u16(c === 0xffff ? 1 : (map.get(c)! - c + 65536) % 65536));
segs.forEach(() => cmap.u16(0));

const nameStrings: [number, string][] = [[1, 'Borg Pixel'], [2, 'Regular'], [4, 'Borg Pixel'], [6, 'BorgPixel-Regular']];
const name = new Writer();
name.u16(0).u16(nameStrings.length).u16(6 + nameStrings.length * 12);
let off = 0;
for (const [id, str] of nameStrings) { name.u16(3).u16(1).u16(0x409).u16(id).u16(str.length * 2).u16(off); off += str.length * 2; }
for (const [, str] of nameStrings) for (const c of str) name.u16(c.charCodeAt(0));

const post = new Writer();
post.u32(0x00030000).u32(0).i16(0).i16(0).u32(1).u32(0).u32(0).u32(0).u32(0);
const os2 = new Writer();
os2.u16(3).i16(ADV).u16(400).u16(5).u16(0);
for (let i = 0; i < 10; i++) os2.i16(0);
os2.i16(0);
for (let i = 0; i < 10; i++) os2.u8(0);
for (let i = 0; i < 4; i++) os2.u32(0);
os2.tag('BORG').u16(0x40).u16(32).u16(0xffff).i16(ASC).i16(-DESC).i16(0).u16(ASC).u16(DESC).u32(1).u32(0).i16(UNIT * 5).i16(UNIT * 7).u16(0).u16(32).u16(0);

const tables: [string, number[]][] = [
  ['OS/2', os2.bytes], ['cmap', cmap.bytes], ['glyf', glyf.bytes], ['head', head.bytes], ['hhea', hhea.bytes],
  ['hmtx', hmtx.bytes], ['loca', loca.bytes], ['maxp', maxp.bytes], ['name', name.bytes], ['post', post.bytes],
];
const file = new Writer();
const pow = 2 ** Math.floor(Math.log2(tables.length));
file.u32(0x00010000).u16(tables.length).u16(pow * 16).u16(Math.floor(Math.log2(tables.length))).u16(tables.length * 16 - pow * 16);
let at = 12 + tables.length * 16;
for (const [tag, b] of tables) {
  file.tag(tag).u32(checksum(b)).u32(at).u32(b.length);
  at += (b.length + 3) & ~3;
}
for (const [, b] of tables) { file.bytes.push(...b); file.pad(); }
writeFileSync('public/borg-pixel.ttf', Buffer.from(file.bytes));
console.log(`public/borg-pixel.ttf: ${file.bytes.length} bytes, ${glyphs.length} glyphs`);
