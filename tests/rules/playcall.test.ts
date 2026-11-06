// The coach's picks: sensible for the situation, varied, and the same on every machine.
import { describe, expect, it } from 'vitest';
import { DEF_CALLS, PLAYBOOK, isRunKind } from '../../src/shared/data/playbook';
import { botCall, coachDefense, coachOffense, defenseScore, tendencies, type Situation } from '../../src/shared/rules/playcall';

const sit = (over: Partial<Situation> = {}): Situation => ({ down: 1, toGo: 10, toGoal: 60, clock: 600, period: 1, lead: 0, hurry: false, twoPoint: false, recent: [], ...over });
const picks = (s: Situation, n = 300) => Array.from({ length: n }, (_, i) => PLAYBOOK[coachOffense(s, i * 7919 + 1)]);
const defPicks = (s: Situation, n = 300, spread?: number) => Array.from({ length: n }, (_, i) => DEF_CALLS[coachDefense(s, i * 7919 + 1, spread)]);
const share = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length / xs.length;

describe('the offense coach', () => {
  it('is deterministic for a seed, so the room and both browsers agree', () => {
    for (let seed = 1; seed < 50; seed++) expect(coachOffense(sit(), seed)).toBe(coachOffense(sit(), seed));
  });
  it('mixes its calls on 1st & 10, with runs and passes both common', () => {
    const p = picks(sit());
    expect(new Set(p.map((x) => x.id)).size).toBeGreaterThanOrEqual(10);
    const run = share(p, (x) => isRunKind(x.kind));
    expect(run).toBeGreaterThan(0.25);
    expect(run).toBeLessThan(0.65);
  });
  it('on 3rd & long it throws past the sticks, and never sneaks', () => {
    const p = picks(sit({ down: 3, toGo: 12 }));
    expect(share(p, (x) => x.kind === 'sneak')).toBe(0);
    expect(share(p, (x) => isRunKind(x.kind) && x.name !== 'HB DRAW')).toBeLessThan(0.05);
    expect(share(p, (x) => x.gain[1] >= 12)).toBeGreaterThan(0.8);
  });
  it('on 3rd & 1 it mostly runs, and the sneak is a real option', () => {
    const p = picks(sit({ down: 3, toGo: 1 }));
    expect(share(p, (x) => isRunKind(x.kind))).toBeGreaterThan(0.5);
    expect(share(p, (x) => x.kind === 'sneak')).toBeGreaterThan(0.1);
  });
  it('trailing in the hurry window it stops running', () => {
    expect(share(picks(sit({ hurry: true, lead: -4, clock: 40, period: 4 })), (x) => isRunKind(x.kind))).toBeLessThan(0.05);
  });
  it('protecting a late lead it runs the clock', () => {
    expect(share(picks(sit({ period: 4, lead: 7, clock: 120 })), (x) => isRunKind(x.kind))).toBeGreaterThan(0.6);
  });
  it('rarely repeats the last call', () => {
    const p = picks(sit({ recent: [7] }));
    expect(share(p, (x) => x.id === 7)).toBeLessThan(0.05);
  });
  it('near the goal line it never takes a shot longer than the field left', () => {
    const p = picks(sit({ toGoal: 3, toGo: 3 }));
    expect(share(p, (x) => x.cat === 'deep' && x.gain[0] >= 3)).toBeLessThan(0.05);
  });
});

describe('the defense coach', () => {
  it('sells out against short yardage, and stays deep against long', () => {
    const short = defPicks(sit({ down: 3, toGo: 1 }));
    expect(share(short, (c) => c.name === 'PREVENT')).toBe(0);
    expect(share(short, (c) => c.cat === 'pressure' || c.cat === 'man')).toBeGreaterThan(0.6);
    const long = defPicks(sit({ down: 3, toGo: 20 }));
    expect(share(long, (c) => c.name === 'RUN STUFF')).toBe(0);
    expect(share(long, (c) => c.cat === 'zone')).toBeGreaterThan(0.6);
  });
  it('never plays Prevent in the red zone', () => {
    expect(share(defPicks(sit({ toGoal: 8, toGo: 8 }), 300, 2.2), (c) => c.name === 'PREVENT')).toBe(0);
  });
  it("reads the offense's tendencies", () => {
    const runs = [0, 1, 2, 0, 1, 2];
    expect(tendencies(runs).run).toBe(1);
    const stuff = DEF_CALLS.find((c) => c.name === 'RUN STUFF')!;
    expect(defenseScore(stuff, sit({ recent: runs }))).toBeGreaterThan(defenseScore(stuff, sit()));
  });
  it("the computer's own calls are spread wider than its suggestions", () => {
    const s = sit({ down: 2, toGo: 8 });
    expect(new Set(defPicks(s, 300, 2.2).map((c) => c.id)).size).toBeGreaterThan(new Set(defPicks(s, 300, 0.3).map((c) => c.id)).size);
  });
});

describe('a bot calling plays', () => {
  it("mostly takes the coach's pick, otherwise one of the same kind", () => {
    let same = 0;
    for (let i = 0; i < 100; i++) {
      const r = i / 100;
      const id = botCall('off', 12, r);
      if (id === 12) same += 1;
      expect(PLAYBOOK[id].cat).toBe(PLAYBOOK[12].cat);
      expect(DEF_CALLS[botCall('def', 4, r)].cat).toBe(DEF_CALLS[4].cat);
    }
    expect(same).toBeGreaterThanOrEqual(65);
  });
});
