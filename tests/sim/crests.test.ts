// The team crests are hand-drawn data, so a slip in a row or a colour clash would only show on one team.
import { describe, expect, it } from 'vitest';
import { CRESTS, EMBLEM_SIZE, crestColors, starRating } from '../../src/client/art/crests';
import { lum } from '../../src/client/art/palette';
import { TEAMS } from '../../src/shared/data/teams';

describe('team crests', () => {
  it('has one for every team, and none left over', () => {
    expect(Object.keys(CRESTS).sort()).toEqual(TEAMS.map((t) => t.id).sort());
  });

  it('draws each emblem on the same grid with known letters', () => {
    for (const [id, crest] of Object.entries(CRESTS)) {
      expect(crest.art.length, id).toBeGreaterThan(0);
      expect(crest.art.length, id).toBeLessThanOrEqual(EMBLEM_SIZE);
      for (const row of crest.art) {
        expect(row.length, `${id}: ${row}`).toBe(EMBLEM_SIZE);
        expect(row, id).toMatch(/^[.#o+lkw]+$/);
      }
    }
  });

  it('gives every team its own emblem', () => {
    const art = Object.values(CRESTS).map((c) => c.art.join());
    expect(new Set(art).size).toBe(art.length);
  });

  it('keeps the main colour readable on the crest body for every team', () => {
    for (const t of TEAMS) {
      const { body, main } = crestColors(t);
      expect(Math.abs(lum(main) - lum(body)), t.id).toBeGreaterThan(0.25);
    }
  });
});

describe('star rating', () => {
  it('runs from half a star to five, in half steps', () => {
    expect(starRating(60, 60)).toBe(0.5);
    expect(starRating(99, 99)).toBe(5);
    for (const t of TEAMS) {
      const s = starRating(t.off, t.def);
      expect(s * 2, t.id).toBe(Math.round(s * 2));
      expect(s, t.id).toBeGreaterThanOrEqual(0.5);
      expect(s, t.id).toBeLessThanOrEqual(5);
    }
  });

  it('never ranks a weaker team above a stronger one', () => {
    const sorted = [...TEAMS].sort((a, b) => a.off + a.def - (b.off + b.def));
    for (let i = 1; i < sorted.length; i++) {
      const [a, b] = [sorted[i - 1]!, sorted[i]!];
      expect(starRating(a.off, a.def), `${a.id} v ${b.id}`).toBeLessThanOrEqual(starRating(b.off, b.def));
    }
  });
});
