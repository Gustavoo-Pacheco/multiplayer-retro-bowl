// Turns team scores into generated players. The same team always gets the same players.
import { T } from '../sim/tuning';
import { hashStr, rnd, type HasRng } from '../sim/rng';

export type Role = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'DB' | 'K';

export interface Attrs { spd: number; str: number; sta: number; cat: number; tck: number; blk: number; acc: number; arm: number; rng: number; kac: number }

export interface RosterPlayer { slot: number; role: Role; name: string; star: boolean; attrs: Attrs }

export const SLOTS: Role[] = ['QB', 'RB', 'WR', 'WR', 'TE', 'OL', 'OL', 'OL', 'DL', 'DL', 'DL', 'LB', 'LB', 'DB', 'DB', 'DB', 'K'];
export const OFFENSE_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];
export const DEFENSE_SLOTS = [8, 9, 10, 11, 12, 13, 14, 15];
export const KICKER_SLOT = 16;

export function attrBase(score: number): number {
  const a = T.attr;
  return a.baseLo + ((a.baseHi - a.baseLo) * (score - a.scoreLo)) / (a.scoreHi - a.scoreLo);
}

export function adjustScore(score: number, mode: 'real' | 'compressed' | 'equal'): number {
  if (mode === 'equal') return T.ratings.equalScore;
  if (mode === 'compressed') return T.ratings.compressedCenter + (score - T.ratings.compressedCenter) * T.ratings.compressedFactor;
  return score;
}

const clamp = (v: number) => Math.max(T.attr.min, Math.min(T.attr.max, v));

const SYLL_A = ['Ka', 'Bro', 'Dar', 'Ve', 'Tal', 'Mo', 'Ren', 'Sa', 'Jo', 'Lu', 'Gra', 'Pel', 'Zan', 'Cor', 'Wy', 'Hal'];
const SYLL_B = ['ven', 'dex', 'lor', 'rik', 'mon', 'tan', 'ble', 'sen', 'dor', 'ley', 'nix', 'ros', 'ton', 'via', 'gar', 'mer'];
const INITIALS = 'ABCDEFGHJKLMNPRSTVWZ';

function inventName(r: HasRng): string {
  const pick = (a: string | string[]) => a[Math.floor(rnd(r) * a.length)];
  return `${pick(INITIALS)}.${pick(SYLL_A)}${pick(SYLL_B)}`;
}

/** off and def are the scores after the Team ratings setting. Seeded from the team ID only. */
export function buildRoster(teamId: string, off: number, def: number): RosterPlayer[] {
  const r: HasRng = { rng: hashStr(`roster:${teamId}`) };
  const baseOff = attrBase(off);
  const baseDef = attrBase(def);
  const baseK = attrBase((off + def) / 2);
  const jitter = () => (rnd(r) * 2 - 1) * T.attr.positionJitter;
  const starSlot = [0, 1, 2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 15][Math.floor(rnd(r) * 13)];
  return SLOTS.map((role, slot) => {
    const base = role === 'K' ? baseK : slot < 8 ? baseOff : baseDef;
    const star = slot === starSlot;
    const v = (): number => clamp(base + jitter() + (star ? T.attr.starBonus : 0));
    const attrs: Attrs = { spd: v(), str: v(), sta: v(), cat: v(), tck: v(), blk: v(), acc: v(), arm: v(), rng: v(), kac: v() };
    return { slot, role, name: inventName(r), star, attrs };
  });
}

export function topSpeed(spd: number, role: Role): number {
  const s = T.speed;
  const raw = s.min + ((s.max - s.min) * (spd - 1)) / 9;
  return (s.spreadCenter + (raw - s.spreadCenter) * s.spread) * s.role[role];
}

export function armRange(arm: number): number {
  const p = T.pass;
  return p.rangeLo + ((p.rangeHi - p.rangeLo) * (arm - 1)) / 9;
}

export function kickRange(rng: number): number {
  const k = T.kick;
  return k.rangeLo + ((k.rangeHi - k.rangeLo) * (rng - 1)) / 9;
}
