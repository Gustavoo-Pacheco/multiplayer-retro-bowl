import { describe, expect, it } from 'vitest';
import { attrBase, adjustScore, armRange, buildRoster, topSpeed } from '../../src/shared/data/roster';
import { formulaDef, formulaOff, TEAMS } from '../../src/shared/data/teams';

describe('teams', () => {
  it('has all 32 teams', () => expect(TEAMS.length).toBe(32));
  it('every OFF and DEF matches the plan formula', () => {
    for (const t of TEAMS) {
      expect(t.off, t.id).toBe(formulaOff(t.pf));
      expect(t.def, t.id).toBe(formulaDef(t.pa));
    }
  });
  it('league points scored equal points allowed', () => {
    const pf = TEAMS.reduce((a, t) => a + t.pf, 0);
    const pa = TEAMS.reduce((a, t) => a + t.pa, 0);
    expect(pf).toBe(12519);
    expect(pa).toBe(12519);
  });
  it('every team has valid colours', () => {
    for (const t of TEAMS) { expect(t.primary).toMatch(/^#[0-9a-f]{6}$/); expect(t.secondary).toMatch(/^#[0-9a-f]{6}$/); }
  });
});

describe('roster', () => {
  it('maps scores onto the 1-10 base', () => {
    expect(attrBase(60)).toBeCloseTo(3);
    expect(attrBase(99)).toBeCloseTo(8);
  });
  it('matches the plan examples at base 3 and base 8', () => {
    expect(armRange(3)).toBeCloseTo(30);
    expect(armRange(8)).toBeCloseTo(55);
    expect(topSpeed(3, 'RB')).toBeCloseTo(6.67, 1);
    expect(topSpeed(8, 'RB')).toBeCloseTo(8.33, 1);
  });
  it('is the same every time, and values stay within 1-10', () => {
    const a = buildRoster('SEA', 94, 99);
    expect(buildRoster('SEA', 94, 99)).toEqual(a);
    expect(a.length).toBe(17);
    for (const p of a) for (const v of Object.values(p.attrs)) { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(10); }
  });
  it('gives each team exactly one star, up to 2 above base', () => {
    for (const t of TEAMS) {
      const r = buildRoster(t.id, t.off, t.def);
      expect(r.filter((p) => p.star).length).toBe(1);
    }
  });
  it('invents short name labels', () => {
    for (const p of buildRoster('DAL', 92, 60)) expect(p.name).toMatch(/^[A-Z]\.[A-Z][a-z]+$/);
  });
  it('team rating modes compress or remove the gap', () => {
    expect(adjustScore(99, 'real')).toBe(99);
    expect(adjustScore(60, 'compressed')).toBe(70);
    expect(adjustScore(60, 'equal')).toBe(80);
  });
});
