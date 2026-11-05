// The stadium behind the title screen, and the game's name in the bitmap font.
import type { Weather } from '../../shared/data/config';
import { TEAM_BY_ID } from '../../shared/data/teams';
import { ATLAS } from '../art/atlas';
import { shade, teamKit } from '../art/palette';
import { buildField, drawField } from './field';
import { drawText, textWidth } from './font';
import { H, screenX, screenY, W } from './view';

const LINEUP: [string, string, number, number, number][] = [
  // Team seat, pose, x, y, facing
  ['a', 'stance', 37, 8.6, 1], ['a', 'stance3', 41, 6.4, 1], ['a', 'stance3', 41, 8.6, 1], ['a', 'stance3', 41, 10.8, 1], ['a', 'ready', 35, 12.5, 1],
  ['a', 'ready', 41, 1.8, 1], ['a', 'ready', 41, 15.2, 1], ['b', 'stance3', 69, 7.2, -1], ['b', 'stance3', 69, 10.1, -1], ['b', 'ready', 73, 8.6, -1],
  ['b', 'ready', 75, 3.2, -1], ['b', 'ready', 75, 14, -1],
];

/** A canvas with a still picture of a game about to start. */
export function titleArt(weather: Weather = 'clear'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.className = 'title-art';
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const a = TEAM_BY_ID.SEA;
  const b = TEAM_BY_ID.LAR;
  const art = buildField({ left: a, right: b, home: a, visitor: b, weather, seed: 4 });
  const cam = 55;
  drawField(g, art, cam);
  const kits = { a: teamKit(a, false), b: teamKit(b, false) };
  [...LINEUP].sort((p, q) => p[3] - q[3]).forEach(([team, pose, x, y, face], i) => {
    const build = pose === 'stance3' ? 'big' : 'std';
    const sx = screenX(x, cam);
    const sy = screenY(y);
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(sx - 6, sy - 1, 12, 3);
    ATLAS.get(kits[team as 'a' | 'b'], i % 4).draw(g, build, pose, 0, sx, sy, face);
  });
  return c;
}

/** The game's name as a canvas, drawn big in the bitmap font with a block shadow. */
export function logoCanvas(): HTMLCanvasElement {
  const text = 'BORG BOWL';
  const scale = 6;
  const c = document.createElement('canvas');
  c.width = textWidth(text, scale) + 16;
  c.height = 7 * scale + 16;
  c.className = 'logo';
  const g = c.getContext('2d')!;
  const gold = '#ffd23f';
  for (let i = 5; i > 0; i--) drawText(g, text, 4 + i, 4 + i, i > 3 ? '#000' : shade(gold, 0.45), scale);
  drawText(g, text, 4, 4, gold, scale);
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', 'Borg Bowl');
  return c;
}
