// Palette slots, and the colours each team's kit gives them.
import { TEAM_BY_ID, type Team } from '../../shared/data/teams';

export interface Kit { helmet: string; jersey: string; trim: string; pants: string; number: string }

export const SKINS = ['#f3cfa8', '#d9a06c', '#a8693e', '#6a4128'];
const WHITE = '#f4f4ee';

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
export const shade = (hex: string, k = 0.72): string => toHex(rgb(hex).map((v) => v * k));
export const lum = (hex: string): number => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

/** The team's home or away kit. The away kit swaps the jersey to white. */
export function teamKit(team: Team | string, away: boolean): Kit {
  const t = typeof team === 'string' ? TEAM_BY_ID[team] : team;
  // A trim too near the jersey, or a white trim on white, wouldn't show. Fall back to a colour that does.
  if (away) {
    const trim = lum(t.primary) > 0.8 ? t.secondary : t.primary;
    return { helmet: trim, jersey: WHITE, trim, pants: trim, number: trim };
  }
  const number = lum(t.primary) > 0.62 ? '#14181c' : WHITE;
  const dark = lum(t.secondary) < 0.14 && lum(t.primary) < 0.14;
  const trim = dark ? WHITE : t.secondary;
  return { helmet: trim, jersey: t.primary, trim, pants: lum(t.primary) > 0.8 ? t.secondary : WHITE, number };
}

/** The letter-to-colour table for one kit and skin tone. */
export function paletteFor(kit: Kit, skin: string): Record<string, string> {
  return {
    H: kit.helmet, h: shade(kit.helmet), J: kit.jersey, j: shade(kit.jersey), N: kit.number,
    T: kit.trim, t: shade(kit.trim), P: kit.pants, p: shade(kit.pants), S: skin, s: shade(skin),
    O: '#0c0f13', K: '#17181c', W: '#f4f4ee', w: '#c7c7bf', G: '#9aa4ad', g: '#5d666e', R: skin === SKINS[0] ? '#d6a436' : '#2a1c12',
    C: '#b49a6a', c: '#8d774f', Y: '#ffd23f',
  };
}
