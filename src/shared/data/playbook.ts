// About a dozen plays. Waypoints are [forward, out] offsets from the player's start:
// "out" is positive toward that player's sideline.
export type RouteName = 'hitch' | 'dig' | 'out' | 'go' | 'slant' | 'flat' | 'up' | 'block';

export interface RouteDef { pts: [number, number][]; stop: boolean }

export const ROUTES: Record<Exclude<RouteName, 'block'>, RouteDef> = {
  hitch: { pts: [[6.5, 0], [5.5, 0]], stop: true },
  dig: { pts: [[9, 0], [10, -2], [10, -14]], stop: false },
  out: { pts: [[7, 0], [8, 1], [8, 8]], stop: false },
  go: { pts: [[60, 0]], stop: false },
  slant: { pts: [[1.5, 1], [3, -1], [15, -12]], stop: false },
  flat: { pts: [[0.5, 2], [1.5, 8]], stop: false },
  up: { pts: [[60, 0]], stop: false },
};

export interface Play {
  id: number; name: string;
  wr1: RouteName; wr2: RouteName; te: RouteName; rb: RouteName;
  /** The run lane if the player hands off. Inside is safer, outside has more upside. */
  lane: 'inside' | 'outside';
  tag: 'short' | 'medium' | 'long';
}

const p = (id: number, name: string, wr1: RouteName, wr2: RouteName, te: RouteName, rb: RouteName, lane: 'inside' | 'outside', tag: Play['tag']): Play => ({ id, name, wr1, wr2, te, rb, lane, tag });

export const PLAYBOOK: Play[] = [
  p(0, 'Twin Hitch', 'hitch', 'hitch', 'up', 'flat', 'inside', 'short'),
  p(1, 'Twin Dig', 'dig', 'dig', 'up', 'slant', 'inside', 'medium'),
  p(2, 'Twin Out', 'out', 'out', 'up', 'flat', 'outside', 'medium'),
  p(3, 'Hitch Go', 'hitch', 'go', 'up', 'slant', 'inside', 'medium'),
  p(4, 'Dig Go', 'dig', 'go', 'up', 'flat', 'outside', 'long'),
  p(5, 'Out Go', 'out', 'go', 'up', 'slant', 'outside', 'long'),
  p(6, 'Verticals', 'go', 'go', 'up', 'flat', 'outside', 'long'),
  p(7, 'Go Dig', 'go', 'dig', 'up', 'slant', 'inside', 'long'),
  p(8, 'Go Out', 'go', 'out', 'up', 'flat', 'outside', 'long'),
  p(9, 'Go Hitch', 'go', 'hitch', 'up', 'slant', 'inside', 'medium'),
  p(10, 'Power Inside', 'hitch', 'hitch', 'block', 'flat', 'inside', 'short'),
  p(11, 'Sweep Outside', 'out', 'hitch', 'block', 'flat', 'outside', 'short'),
];

/** The down-and-distance filter: which tags suit this situation. */
export function suitablePlays(down: number, toGo: number): Play[] {
  let tags: Play['tag'][];
  if (toGo <= 3) tags = ['short', 'medium'];
  else if (toGo >= 11 || (down >= 3 && toGo >= 7)) tags = ['long', 'medium'];
  else tags = ['medium', 'short', 'long'];
  return PLAYBOOK.filter((x) => tags.includes(x.tag));
}

export function pickPlay(roll: number, down: number, toGo: number, exclude = -1): Play {
  const list = suitablePlays(down, toGo).filter((x) => x.id !== exclude);
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}
