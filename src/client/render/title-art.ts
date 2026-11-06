// The stadium behind the title screen, and the game's name in the bitmap font.
import type { Weather } from '../../shared/data/config';
import { TEAM_BY_ID } from '../../shared/data/teams';
import { T } from '../../shared/sim/tuning';
import { ATLAS } from '../art/atlas';
import { teamKit } from '../art/palette';
import { buildField, drawField } from './field';
import { drawText, textWidth } from './font';
import { FIG, H, RES, screenX, screenY, W } from './view';

const LINEUP: [string, string, number, number, number][] = [
  // Team seat, pose, x, lateral yards from the field's center, facing
  ['a', 'stance', 37, 0, 1], ['a', 'stance3', 41, -2.2, 1], ['a', 'stance3', 41, 0, 1], ['a', 'stance3', 41, 2.2, 1], ['a', 'ready', 35, 3.9, 1],
  ['a', 'ready', 41, -6.8, 1], ['a', 'ready', 41, 6.6, 1], ['b', 'stance3', 69, -1.4, -1], ['b', 'stance3', 69, 1.5, -1], ['b', 'ready', 73, 0, -1],
  ['b', 'ready', 75, -5.4, -1], ['b', 'ready', 75, 5.4, -1],
];

/** A canvas with a still picture of a game about to start. */
export function titleArt(weather: Weather = 'clear'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W * RES;
  c.height = H * RES;
  c.className = 'title-art';
  const g = c.getContext('2d')!;
  g.setTransform(RES, 0, 0, RES, 0, 0);
  g.imageSmoothingEnabled = false;
  const a = TEAM_BY_ID.SEA;
  const b = TEAM_BY_ID.LAR;
  const art = buildField({ left: a, right: b, home: a, visitor: b, weather, seed: 4, midfield: false });
  const cam = 55;
  drawField(g, art, cam);
  const kits = { a: teamKit(a, false), b: teamKit(b, false) };
  [...LINEUP].sort((p, q) => p[3] - q[3]).forEach(([team, pose, x, y, face], i) => {
    const build = pose === 'stance3' ? 'big' : 'std';
    const sx = screenX(x, cam);
    const sy = screenY(T.field.center + y);
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(Math.round(sx) - 4.5, Math.round(sy) - 1, 9, 2.5);
    ATLAS.get(kits[team as 'a' | 'b'], i % 4).draw(g, build, pose, 0, sx, sy, face, FIG);
  });
  return c;
}

/** The game's name as a canvas, drawn big in the bitmap font with a block shadow. */
export function logoCanvas(): HTMLCanvasElement {
  const text = 'BORG BOWL';
  const scale = 6;
  const c = document.createElement('canvas');
  c.width = textWidth(text, scale) + 20;
  c.height = 7 * scale + 20;
  c.className = 'logo';
  const g = c.getContext('2d')!;
  // A stack of hard offsets makes the letters look cut from a block.
  const gold = '#ffd23f';
  for (let i = 8; i > 0; i -= 2) drawText(g, text, 4 + i, 4 + i, i > 6 ? '#000' : '#c0261c', scale);
  drawText(g, text, 2, 2, '#000', scale);
  drawText(g, text, 4, 4, gold, scale);
  // A light band across the top of the letters.
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#fff4b8';
  g.fillRect(4, 4, c.width, scale * 2);
  g.globalCompositeOperation = 'source-over';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', 'Borg Bowl');
  return c;
}
