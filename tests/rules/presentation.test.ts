// Score banners and replays sit between a result and what follows, and never change what follows.
import { describe, expect, it } from 'vitest';
import { advanceBanner, applyResult, applySnap, nextController, presentResult, type MatchState } from '../../src/shared/rules/match';
import type { MatchConfig } from '../../src/shared/data/config';
import type { PlayEnd } from '../../src/shared/sim/state';
import { inPlay, result } from './helpers';

function finish(cfg: Partial<MatchConfig>, end: PlayEnd, spot: number, over: Record<string, unknown> = {}, at: Partial<MatchState> = {}) {
  const m = inPlay(cfg, at);
  const r = result(m, end, spot, over);
  const plain = applyResult(applySnap(m), r);
  return { plain, shown: presentResult(plain, r) };
}
/** Follows the breaks to the end, and returns the phases seen along the way. */
function walk(m: MatchState): { phases: string[]; end: MatchState } {
  const phases: string[] = [];
  let cur = m;
  while (cur.phase === 'banner' || cur.phase === 'replay') {
    phases.push(cur.phase === 'banner' ? `banner:${cur.banner?.kind}` : 'replay');
    if (!cur.resume && cur.phase === 'banner') break;
    cur = advanceBanner(cur);
  }
  return { phases, end: cur };
}

describe('after a touchdown', () => {
  it('replays off: the banner, then the conversion', () => {
    const { plain, shown } = finish({ replays: 'off' }, 'td', 110, { big: true }, { ballX: 105 });
    const w = walk(shown);
    expect(w.phases).toEqual(['banner:touchdown']);
    expect(w.end.phase).toBe('conversion');
    expect(w.end.score).toEqual(plain.score);
    expect(shown.score).toEqual(plain.score);
  });

  it('replays on: the banner, the replay, then the conversion', () => {
    const { shown } = finish({ replays: 'big' }, 'td', 110, { big: true }, { ballX: 105 });
    const w = walk(shown);
    expect(w.phases).toEqual(['banner:touchdown', 'replay']);
    expect(w.end.phase).toBe('conversion');
    expect(w.end.resume).toBeNull();
    expect(w.end.banner).toBeNull();
  });

  it('the scorer may skip the replay, since they convert next', () => {
    const { shown } = finish({ replays: 'big' }, 'td', 110, { big: true }, { ballX: 105 });
    const replay = advanceBanner(shown);
    expect(replay.phase).toBe('replay');
    expect(nextController(replay)).toBe(replay.possession);
    expect(walk(replay).end.possession).toBe(nextController(replay));
  });
});

describe('without a score', () => {
  it('a big gain gets a replay, then the next snap', () => {
    const { shown } = finish({ replays: 'big' }, 'tackle', 75, { big: true, yards: 25 });
    expect(shown.phase).toBe('replay');
    const w = walk(shown);
    expect(w.phases).toEqual(['replay']);
    expect(w.end.phase).toBe('huddle');
    expect(nextController(shown)).toBe(w.end.play!.offense);
  });

  it('an ordinary play gets nothing', () => {
    const { plain, shown } = finish({ replays: 'all' }, 'tackle', 54);
    expect(shown).toEqual(plain);
  });

  it('replays off: a big gain goes straight to the next snap', () => {
    const { plain, shown } = finish({ replays: 'off' }, 'tackle', 75, { big: true, yards: 25 });
    expect(shown).toEqual(plain);
  });

  it('keeps a quarter banner that was already due', () => {
    const { plain, shown } = finish({ replays: 'big' }, 'tackle', 75, { big: true, yards: 25, clock: 0 }, { period: 1, clock: 2 });
    expect(plain.phase).toBe('banner');
    expect(plain.banner?.kind).toBe('quarter');
    expect(shown.phase).toBe('replay');
    const back = advanceBanner(shown);
    expect(back.phase).toBe('banner');
    expect(back.banner?.kind).toBe('quarter');
    expect(advanceBanner(back).phase).toBe(advanceBanner(plain).phase);
  });
});

describe('kicks and safeties', () => {
  const kick = (cfg: Partial<MatchConfig>, type: 'fieldGoal' | 'extraPoint', end: PlayEnd) => {
    const base = inPlay(cfg, { ballX: 80 });
    const m: MatchState = { ...base, play: { ...base.play!, type } };
    const r = result(m, end, 80, { type });
    return presentResult(applyResult(applySnap(m), r), r);
  };

  it('a field goal gets a score banner, whatever the replay setting', () => {
    const shown = kick({ replays: 'off' }, 'fieldGoal', 'fgGood');
    expect(shown.phase).toBe('banner');
    expect(shown.banner).toEqual({ kind: 'score', text: 'FIELD GOAL!' });
  });

  it('All scores replays an extra point, and Big plays does not', () => {
    expect(kick({ replays: 'all' }, 'extraPoint', 'xpGood').phase).toBe('replay');
    expect(kick({ replays: 'big' }, 'extraPoint', 'xpGood').phase).not.toBe('replay');
  });

  it('a missed kick gets no banner', () => {
    expect(kick({ replays: 'off' }, 'fieldGoal', 'fgMiss').phase).not.toBe('banner');
  });

  it('a safety gets a banner, then the free kick', () => {
    const { shown } = finish({ replays: 'off' }, 'tackle', 8, { sack: true }, { ballX: 12 });
    expect(shown.banner?.text).toBe('SAFETY!');
    expect(walk(shown).end.play?.type ?? walk(shown).end.phase).not.toBe('banner');
  });

  it('a score that ends the game still reaches the final state', () => {
    const m = inPlay({ replays: 'big', overtime: 'sudden' }, { ballX: 105, period: 5, score: [7, 7], ot: { mode: 'sudden', first: 0, stage: 'sudden' } });
    const r = result(m, 'td', 110, { big: true });
    const shown = presentResult(applyResult(applySnap(m), r), r);
    const w = walk(shown);
    expect(w.phases).toEqual(['banner:touchdown', 'replay']);
    expect(w.end.phase).toBe('final');
    expect(w.end.winner).toBe(m.possession);
  });
});
