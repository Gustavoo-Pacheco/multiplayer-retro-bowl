import { describe, expect, it } from 'vitest';
import { advanceBanner, afterCoinToss, applyCall, applyChoice, applyResult, applySnap, applyTimeout, awayKits, callerOf, canCall, canTimeout, concede, createMatch, defaultChoice, effectiveRoster, fieldGoalDistance, huddleTimeout, isResultValid, simContext, viewFor, voidPlay, type MatchState } from '../../src/shared/rules/match';
import { DEF_CALLS, PLAYBOOK } from '../../src/shared/data/playbook';
import { DEFAULT_CONFIG } from '../../src/shared/data/config';
import { inPlay, match, result } from './helpers';

const live = (m: MatchState) => applySnap(m);

describe('clock', () => {
  it('no snap after 0:00, but a play in progress finishes', () => {
    const m = live(inPlay({}, { clock: 1, period: 1 }));
    expect(m.phase).toBe('live');
    const after = applyResult(m, result(m, 'tackle', 55, { clock: 0 }));
    // The play counted (the spot moved), and the quarter ended instead of another snap.
    expect(after.phase).toBe('banner');
    expect(after.banner?.kind).toBe('quarter');
    expect(after.period).toBe(2);
    expect(after.clock).toBe(180);
    expect(after.ballX).toBe(120 - 55);
  });
  it('a touchdown at 0:00 still gets its conversion, then the period ends', () => {
    const m = live(inPlay({}, { clock: 0.5, period: 2 }));
    const td = applyResult(m, result(m, 'td', 110, { clock: 0 }));
    expect(td.phase).toBe('conversion');
    expect(td.score[0]).toBe(6);
    expect(td.clock).toBe(0);
    const kick = applyChoice(td, 'kick');
    expect(kick.play?.type).toBe('extraPoint');
    const after = applyResult(applySnap(kick), result(kick, 'xpGood', 94, { clock: 0, type: 'extraPoint' }));
    expect(after.score[0]).toBe(7);
    expect(after.banner?.kind).toBe('half');
  });
  it('a field goal at 0:00 ends the period with no kickoff', () => {
    let m = inPlay({}, { clock: 1, period: 1, down: 4 });
    m = { ...m, phase: 'choice4th', play: null };
    m = applyChoice(m, 'fg');
    const after = applyResult(applySnap(m), result(m, 'fgGood', 43, { clock: 0, type: 'fieldGoal' }));
    expect(after.score[0]).toBe(3);
    expect(after.phase).toBe('banner');
    expect(after.period).toBe(2);
    expect(advanceBanner(after).play?.type ?? advanceBanner(after).phase).toMatch(/kickoff|kickChoice/);
  });
  it('fixed runoff is deducted at the next snap after a play that kept the clock running', () => {
    const m = live(inPlay({ quarter: 3 }, { clock: 100, period: 1 }));
    const after = applyResult(m, result(m, 'tackle', 54, { clock: 94 }));
    expect(after.runoffPending).toBe(true);
    expect(after.clock).toBe(94);
    expect(after.play?.clock).toBe(94 - 12);
    const snapped = applySnap(after);
    expect(snapped.clock).toBe(82);
    expect(snapped.runoffPending).toBe(false);
  });
  it('waiting between plays never costs game time', () => {
    const m = live(inPlay({}, { clock: 100 }));
    const after = applyResult(m, result(m, 'tackle', 54, { clock: 94 }));
    // Time is only ever taken by a result or a snap: nothing else touches the clock.
    const paused = applyTimeout(after, 0);
    expect(paused.clock).toBe(94);
    expect(after.clock).toBe(94);
  });
  it.each([['incomplete', 50], ['oob', 53]] as const)('%s stops the clock with no runoff', (end, spot) => {
    const m = live(inPlay({}, { clock: 100 }));
    const after = applyResult(m, result(m, end, spot, { clock: 95 }));
    expect(after.runoffPending).toBe(false);
  });
  it('a change of possession stops the clock', () => {
    const m = live(inPlay({}, { clock: 100 }));
    const after = applyResult(m, result(m, 'tackle', 40, { clock: 95, possessor: 1 }));
    expect(after.possession).toBe(1);
    expect(after.runoffPending).toBe(false);
  });
  it('a runoff that would reach 0:00 ends the quarter instead of allowing a snap', () => {
    const m = live(inPlay({ quarter: 3 }, { clock: 15, period: 1 }));
    const after = applyResult(m, result(m, 'tackle', 54, { clock: 10 }));
    expect(after.phase).toBe('banner');
    expect(after.period).toBe(2);
  });
  it.each([[1, 4], [2, 8], [3, 12], [5, 20]] as const)('runoff for %i-minute quarters is %i s', (q, run) => {
    const m = live(inPlay({ quarter: q }, { clock: 50, period: 1 }));
    const after = applyResult(m, result(m, 'tackle', 54, { clock: 45 }));
    expect(after.play!.clock).toBe(45 - run);
  });
  it.each([[3, 120], [5, 120], [2, 60], [1, 30]] as const)('two-minute warning stops the clock at the right mark for %i-minute quarters', (q, mark) => {
    const m = live(inPlay({ quarter: q }, { clock: mark + 3, period: 2 }));
    const after = applyResult(m, result(m, 'tackle', 54, { clock: mark - 1 }));
    expect(after.banner?.kind).toBe('twoMin');
    expect(after.clock).toBe(mark - 1);
    expect(after.runoffPending).toBe(false);
    expect(advanceBanner(after).phase).toBe('huddle');
  });
  it('the two-minute warning fires once a half, and not in odd quarters', () => {
    const q1 = live(inPlay({ quarter: 3 }, { clock: 125, period: 1 }));
    expect(applyResult(q1, result(q1, 'tackle', 54, { clock: 119 })).banner).toBeNull();
    const q4 = live(inPlay({ quarter: 3 }, { clock: 125, period: 4, twoMinUsed: true }));
    expect(applyResult(q4, result(q4, 'tackle', 54, { clock: 119 })).banner).toBeNull();
  });
  it('a pending runoff that crosses the mark also fires the warning, at the mark', () => {
    const m = live(inPlay({ quarter: 3 }, { clock: 130, period: 2 }));
    const after = applyResult(m, result(m, 'tackle', 54, { clock: 125 }));
    expect(after.banner?.kind).toBe('twoMin');
    expect(after.clock).toBe(120);
  });
  it('the two-minute setting turns it off', () => {
    const m = live(inPlay({ quarter: 3, twoMinute: false }, { clock: 125, period: 2 }));
    expect(applyResult(m, result(m, 'tackle', 54, { clock: 119 })).banner).toBeNull();
  });
  it('play clock defaults: field goal in range, otherwise a punt', () => {
    const near = { ...inPlay({}, { ballX: 90, down: 4, toGo: 3 }), phase: 'choice4th' as const, play: null };
    expect(fieldGoalDistance(near)).toBe(20 + 7 + 10);
    expect(defaultChoice(near)).toBe('fg');
    const far = { ...inPlay({}, { ballX: 30, down: 4, toGo: 3 }), phase: 'choice4th' as const, play: null };
    expect(defaultChoice(far)).toBe('punt');
  });
  it('play clock default on a conversion is the extra point, and on a kick choice the deep kick', () => {
    const conv = { ...inPlay(), phase: 'conversion' as const };
    expect(defaultChoice(conv)).toBe('kick');
    const kc = { ...inPlay(), phase: 'kickChoice' as const };
    expect(defaultChoice(kc)).toBe('deep');
  });
});

describe('downs and scoring', () => {
  it('moves the chains on a first down', () => {
    const m = live(inPlay({}, { down: 2, toGo: 4 }));
    const a = applyResult(m, result(m, 'tackle', 55));
    expect([a.down, a.toGo, a.ballX]).toEqual([1, 10, 55]);
    expect(a.last?.firstDown).toBe(true);
  });
  it('short of the sticks is the next down', () => {
    const m = live(inPlay({}, { down: 1, toGo: 10 }));
    const a = applyResult(m, result(m, 'tackle', 53));
    expect([a.down, a.toGo, a.ballX]).toEqual([2, 7, 53]);
  });
  it('first-and-goal counts distance to the goal line', () => {
    const m = live(inPlay({}, { ballX: 95 }));
    const a = applyResult(m, result(m, 'tackle', 105));
    expect([a.down, a.toGo]).toEqual([1, 5]);
  });
  it('an incomplete pass keeps the spot and uses a down', () => {
    const m = live(inPlay({}, { down: 3, toGo: 8 }));
    const a = applyResult(m, result(m, 'incomplete', 50));
    expect([a.down, a.toGo, a.ballX]).toEqual([4, 8, 50]);
    expect(a.phase).toBe('choice4th');
  });
  it('a 4th-down sack is a turnover on downs, not a punt', () => {
    let m = inPlay({}, { down: 4, toGo: 5, chosen4th: true });
    m = live(m);
    const a = applyResult(m, result(m, 'tackle', 44, { sack: true }));
    expect(a.possession).toBe(1);
    expect(a.ballX).toBe(44);
    expect(a.down).toBe(1);
    expect(a.last?.turnoverOnDowns).toBe(true);
    expect(a.play?.type).toBe('scrimmage');
    expect(a.runoffPending).toBe(false);
  });
  it('a sack in a player\'s own end zone is a safety, followed by a free kick', () => {
    const m = live(inPlay({}, { ballX: 12, down: 1 }));
    const a = applyResult(m, result(m, 'tackle', 8, { sack: true }));
    expect(a.score).toEqual([0, 2]);
    expect(a.last?.safety).toBe(true);
    expect(a.kicker).toBe(0);
    expect(a.kickKind).toBe('freeKick');
    const kick = a.phase === 'kickChoice' ? applyChoice(a, 'deep') : a;
    expect(kick.play?.type).toBe('freeKick');
    expect(kick.play?.los).toBe(10 + 20);
  });
  it('a fumble out of the carrier\'s own end zone is a safety', () => {
    const m = live(inPlay({}, { ballX: 12 }));
    const a = applyResult(m, result(m, 'fumbleOutEndZone', 0, { lastCarrier: 0, possessor: 0 }));
    expect(a.score).toEqual([0, 2]);
    expect(a.last?.safety).toBe(true);
  });
  it('a fumble out of the defending team\'s end zone is a touchback to them', () => {
    const m = live(inPlay({}, { ballX: 105 }));
    const a = applyResult(m, result(m, 'fumbleOutEndZone', 120, { lastCarrier: 0, possessor: 0 }));
    expect(a.score).toEqual([0, 0]);
    expect(a.possession).toBe(1);
    expect(a.ballX).toBe(110 - 25);
    expect(a.down).toBe(1);
  });
  it('a defender fumbling out of his own end zone gives up a safety', () => {
    const m = live(inPlay({}, { ballX: 105 }));
    const a = applyResult(m, result(m, 'fumbleOutEndZone', 120, { lastCarrier: 1, possessor: 1 }));
    expect(a.score).toEqual([2, 0]);
  });
  it('backward contact spots the ball where the receiver ends up', () => {
    const m = live(inPlay({}, { ballX: 50, down: 1, toGo: 10 }));
    const a = applyResult(m, result(m, 'tackle', 47.5));
    expect(a.ballX).toBe(47.5);
    expect(a.toGo).toBeCloseTo(12.5);
    expect(a.down).toBe(2);
  });
  it('an interception in a player\'s own end zone can be run out or taken as a touchback', () => {
    const m = live(inPlay({}, { ballX: 100 }));
    const taken = applyResult(m, result(m, 'touchback', 115, { possessor: 1 }));
    expect(taken.possession).toBe(1);
    expect(taken.ballX).toBe(85);
    expect(taken.last?.touchback).toBe(true);
    const ranOut = applyResult(m, result(m, 'tackle', 104, { possessor: 1 }));
    expect(ranOut.possession).toBe(1);
    expect(ranOut.ballX).toBe(104);
  });
  it('downed in the end zone after a pick is a touchback, not a safety', () => {
    const m = live(inPlay({}, { ballX: 100 }));
    const a = applyResult(m, result(m, 'tackle', 113, { possessor: 1, ezImpetus: true }));
    expect(a.score).toEqual([0, 0]);
    expect(a.ballX).toBe(85);
  });
  it('a return touchdown is followed by the new offense\'s conversion', () => {
    const m = live(inPlay({}, { ballX: 50 }));
    const a = applyResult(m, result(m, 'td', 10, { possessor: 1 }));
    expect(a.score).toEqual([0, 6]);
    expect(a.phase).toBe('conversion');
    expect(a.possession).toBe(1);
    const conv = applyChoice(a, 'two');
    expect(conv.play?.offense).toBe(1);
    expect(conv.play?.type).toBe('twoPoint');
    expect(conv.play?.los).toBe(12); // seat 1 attacks toward x = 10
  });
  it('a turnover on a two-point try ends the try, and the scoring team kicks off', () => {
    let m: MatchState = { ...inPlay(), phase: 'conversion' as const, play: null };
    m = applyChoice(m, 'two');
    const a = applyResult(live(m), result(m, 'tryFailed', 100, { type: 'twoPoint', possessor: 1 }));
    expect(a.score).toEqual([0, 0]);
    expect(a.kicker).toBe(0);
    expect(a.phase === 'kickChoice' || a.phase === 'presnap').toBe(true);
  });
  it('a successful two-point try scores 2', () => {
    let m: MatchState = { ...inPlay(), phase: 'conversion' as const, play: null };
    m = applyChoice(m, 'two');
    expect(m.play?.los).toBe(108);
    const a = applyResult(live(m), result(m, 'td', 110, { type: 'twoPoint' }));
    expect(a.score).toEqual([2, 0]);
  });
  it('the two-point setting skips the choice', () => {
    const m = live(inPlay({ twoPoint: false }));
    const a = applyResult(m, result(m, 'td', 110));
    expect(a.phase).toBe('presnap');
    expect(a.play?.type).toBe('extraPoint');
  });
  it('an extra point is a 33-yard kick', () => {
    let m: MatchState = { ...inPlay(), phase: 'conversion' as const, play: null };
    m = applyChoice(m, 'kick');
    expect(m.play!.type).toBe('extraPoint');
    expect(120 - (m.play!.los - 7)).toBe(33);
    const a = applyResult(live(m), result(m, 'xpGood', 87, { type: 'extraPoint' }));
    expect(a.score).toEqual([1, 0]);
  });
  it('a field goal scores 3 and a miss gives the ball over at the spot of the kick', () => {
    let m: MatchState = { ...inPlay({}, { ballX: 85, down: 4 }), phase: 'choice4th' as const, play: null };
    m = applyChoice(m, 'fg');
    const good = applyResult(live(m), result(m, 'fgGood', 78, { type: 'fieldGoal' }));
    expect(good.score).toEqual([3, 0]);
    expect(good.kicker).toBe(0);
    const miss = applyResult(live(m), result(m, 'fgMiss', 78, { type: 'fieldGoal' }));
    expect(miss.possession).toBe(1);
    expect(miss.ballX).toBe(78);
    expect(miss.score).toEqual([0, 0]);
  });
  it('a kickoff touchback goes to the 25', () => {
    const m = afterCoinToss(match());
    const k = m.phase === 'kickChoice' ? applyChoice(m, 'deep') : m;
    const a = applyResult(live(k), result(k, 'touchback', 0, { possessor: (1 - k.kicker) as 0 | 1, type: 'kickoff' }));
    expect(a.possession).toBe(1 - k.kicker);
    const yard = a.attack[a.possession] > 0 ? a.ballX - 10 : 110 - a.ballX;
    expect(yard).toBe(25);
  });
  it('kickoffs come from the kicking team\'s 35', () => {
    const m = afterCoinToss(match());
    const k = m.phase === 'kickChoice' ? applyChoice(m, 'deep') : m;
    const yard = k.attack[k.kicker] > 0 ? k.play!.los - 10 : 110 - k.play!.los;
    expect(yard).toBe(35);
  });
  it('a punt return tackled at a spot gives the receiver 1st & 10 there', () => {
    let m: MatchState = { ...inPlay({}, { ballX: 40, down: 4 }), phase: 'choice4th' as const, play: null };
    m = applyChoice(m, 'punt');
    const a = applyResult(live(m), result(m, 'tackle', 80, { type: 'punt', possessor: 1 }));
    expect(a.possession).toBe(1);
    expect(a.ballX).toBe(80);
    expect(a.down).toBe(1);
  });
  it('pass interference is an automatic first down at the spot', () => {
    const m = live(inPlay({}, { down: 3, toGo: 8, clock: 100 }));
    const a = applyResult(m, result(m, 'pi', 72, { clock: 96 }));
    expect([a.down, a.ballX]).toEqual([1, 72]);
    expect(a.runoffPending).toBe(false);
  });
  it('onside is offered only when tied or trailing', () => {
    const m = live(inPlay({}, { ballX: 100, score: [0, 14] }));
    const a = applyResult(m, result(m, 'td', 110));
    const kick = applyResult(applySnap(applyChoice(a, 'kick')), result(applyChoice(a, 'kick'), 'xpGood', 87, { type: 'extraPoint' }));
    expect(kick.phase).toBe('kickChoice');
    const ons = applyChoice(kick, 'onside');
    expect(ons.play?.type).toBe('onside');
    const lead = live(inPlay({}, { ballX: 100, score: [21, 0] }));
    const a2 = applyResult(lead, result(lead, 'td', 110));
    const k2 = applyResult(applySnap(applyChoice(a2, 'kick')), result(applyChoice(a2, 'kick'), 'xpGood', 87, { type: 'extraPoint' }));
    expect(k2.phase).toBe('presnap');
    expect(k2.play?.type).toBe('kickoff');
  });
  it('the onside setting removes the choice', () => {
    const m = afterCoinToss(match({ onside: false }));
    expect(m.phase).toBe('presnap');
  });
  it('a recovered onside kick gives the kicking team the ball at the spot', () => {
    const m = afterCoinToss(match());
    const k = applyChoice(m, 'onside');
    const kicker = k.kicker;
    const dir = k.attack[kicker];
    const spot = k.play!.los + dir * 12;
    const a = applyResult(applySnap(k), result(k, 'tackle', spot, { type: 'onside', possessor: kicker, offense: kicker }));
    expect(a.possession).toBe(kicker);
    expect(a.ballX).toBe(spot);
    expect(a.down).toBe(1);
  });
});

describe('direction and periods', () => {
  it('teams change ends each quarter, and the ball mirrors with them', () => {
    const m = live(inPlay({}, { clock: 1, period: 1, ballX: 70, down: 2, toGo: 5 }));
    const a = applyResult(m, result(m, 'tackle', 72, { clock: 0 }));
    expect(a.attack).toEqual([-1, 1]);
    expect(a.ballX).toBe(120 - 72);
    expect(a.down).toBe(3);
    expect(a.toGo).toBe(3);
    const next = advanceBanner(a);
    expect(next.play?.dir).toBe(-1);
    expect(next.play?.los).toBe(48);
  });
  it('at halftime the team that kicked first receives', () => {
    const start = match();
    const m = live(inPlay({}, { clock: 1, period: 2, openingKicker: 0, coinWinner: 1 }));
    const a = applyResult(m, result(m, 'tackle', 72, { clock: 0 }));
    expect(a.banner?.kind).toBe('half');
    const next = advanceBanner(a);
    expect(next.kicker).toBe(1);
    expect(start.config.quarter).toBe(3);
  });
  it('the coin toss winner receives the opening kick', () => {
    const m = match();
    const k = afterCoinToss(m);
    expect(k.kicker).toBe(1 - m.coinWinner);
    expect(k.openingKicker).toBe(1 - m.coinWinner);
  });
  it('a game ends after Q4 with a winner', () => {
    const m = live(inPlay({}, { clock: 1, period: 4, score: [14, 7], twoMinUsed: true }));
    const a = applyResult(m, result(m, 'tackle', 72, { clock: 0 }));
    expect(a.phase).toBe('final');
    expect(a.winner).toBe(0);
  });
  it('with overtime off, ties stand', () => {
    const m = live(inPlay({ overtime: 'off' }, { clock: 1, period: 4, score: [7, 7], twoMinUsed: true }));
    const a = applyResult(m, result(m, 'tackle', 72, { clock: 0 }));
    expect(a.phase).toBe('final');
    expect(a.winner).toBe('tie');
  });
  it('points are recorded by quarter', () => {
    const m = live(inPlay({}, { period: 3 }));
    const a = applyResult(m, result(m, 'td', 110));
    expect(a.scoreByPeriod[0]).toEqual([0, 0, 6, 0]);
  });
  it('possession time and stats accumulate', () => {
    const m = live(inPlay({}, { clock: 100 }));
    const st = result(m, 'tackle', 55, { clock: 94 });
    st.stats[0].passYds = 5; st.stats[0].att = 1; st.stats[0].comp = 1;
    const a = applyResult(m, st);
    expect(a.stats[0].passYds).toBe(5);
    expect(a.stats[0].top).toBe(6);
  });
});

function reachOt(over = {}): MatchState {
  const m = live(inPlay(over, { clock: 1, period: 4, score: [7, 7], twoMinUsed: true }));
  const a = applyResult(m, result(m, 'tackle', 72, { clock: 0 }));
  expect(a.banner?.kind).toBe('overtime');
  return a;
}

/** Puts overtime's receiving team on offense in midfield. */
function otOnOffense(a: MatchState, down = 1): MatchState {
  const first = a.ot!.first;
  return { ...a, phase: 'presnap', possession: first, ballX: 60, down, toGo: 10, chosen4th: down === 4, play: { id: 500, type: 'scrimmage', seed: 1, offense: first, dir: a.attack[first], los: 60, down, toGo: 10, playbook: 6, defense: 0, clock: a.clock }, playId: 500 };
}

describe('overtime', () => {
  it('starts with a coin flip and 2 timeouts each', () => {
    const a = reachOt();
    expect(a.period).toBe(5);
    expect(a.timeouts).toEqual([2, 2]);
    expect(a.clock).toBe(180);
    const next = advanceBanner(a);
    expect(next.kicker).toBe(1 - a.ot!.first);
  });
  it('a touchdown ends it, with no conversion once the winner is decided', () => {
    const o = otOnOffense(reachOt());
    const a = applyResult(live(o), result(o, 'td', o.attack[o.possession] > 0 ? 110 : 10));
    expect(a.phase).toBe('final');
    expect(a.winner).toBe(o.ot!.first);
    expect(a.score[o.ot!.first]).toBe(13);
  });
  it('a safety ends overtime', () => {
    const o = otOnOffense(reachOt());
    const f = o.ot!.first;
    const inOwnEz = o.attack[f] > 0 ? 5 : 115;
    const a = applyResult(live(o), result(o, 'tackle', inOwnEz));
    expect(a.phase).toBe('final');
    expect(a.winner).toBe(1 - f);
  });
  it('a field goal followed by a failed drive ends it', () => {
    const o = otOnOffense(reachOt(), 4);
    const f = o.ot!.first;
    const fg = applyChoice({ ...o, phase: 'choice4th', play: null, chosen4th: false }, 'fg');
    const afterFg = applyResult(live(fg), result(fg, 'fgGood', 60, { type: 'fieldGoal' }));
    expect(afterFg.phase === 'kickChoice' || afterFg.phase === 'presnap').toBe(true);
    expect(afterFg.ot?.stage).toBe('answer');
    // The other team's drive fails: turnover on downs.
    const other = (1 - f) as 0 | 1;
    const drive: MatchState = { ...afterFg, phase: 'presnap', possession: other, ballX: 60, down: 4, toGo: 5, chosen4th: true, play: { id: 600, type: 'scrimmage', seed: 1, offense: other, dir: afterFg.attack[other], los: 60, down: 4, toGo: 5, playbook: 6, defense: 0, clock: afterFg.clock }, playId: 600 };
    const end = applyResult(live(drive), result(drive, 'incomplete', 60));
    expect(end.phase).toBe('final');
    expect(end.winner).toBe(f);
  });
  it('after a field goal, an answering touchdown wins with no conversion', () => {
    const o = otOnOffense(reachOt(), 4);
    const f = o.ot!.first;
    const fg = applyChoice({ ...o, phase: 'choice4th', play: null, chosen4th: false }, 'fg');
    const afterFg = applyResult(live(fg), result(fg, 'fgGood', 60, { type: 'fieldGoal' }));
    const other = (1 - f) as 0 | 1;
    const drive: MatchState = { ...afterFg, phase: 'presnap', possession: other, ballX: 60, down: 1, toGo: 10, play: { id: 600, type: 'scrimmage', seed: 1, offense: other, dir: afterFg.attack[other], los: 60, down: 1, toGo: 10, playbook: 6, defense: 0, clock: afterFg.clock }, playId: 600 };
    const end = applyResult(live(drive), result(drive, 'td', drive.attack[other] > 0 ? 110 : 10));
    expect(end.winner).toBe(other);
    expect(end.phase).toBe('final');
  });
  it('after a field goal, an answering field goal continues in sudden death', () => {
    const o = otOnOffense(reachOt(), 4);
    const f = o.ot!.first;
    const fg = applyChoice({ ...o, phase: 'choice4th', play: null, chosen4th: false }, 'fg');
    const afterFg = applyResult(live(fg), result(fg, 'fgGood', 60, { type: 'fieldGoal' }));
    const other = (1 - f) as 0 | 1;
    const drive: MatchState = { ...afterFg, phase: 'choice4th', possession: other, ballX: 60, down: 4, toGo: 5, chosen4th: false, play: null };
    const fg2 = applyChoice(drive, 'fg');
    const end = applyResult(live(fg2), result(fg2, 'fgGood', 60, { type: 'fieldGoal' }));
    expect(end.winner).toBeNull();
    expect(end.ot?.stage).toBe('sudden');
    expect(end.score[0]).toBe(end.score[1]);
    // Any score now wins.
    const k: MatchState = { ...end, phase: 'choice4th', possession: f, ballX: 60, down: 4, toGo: 5, chosen4th: false, play: null };
    const fg3 = applyChoice(k, 'fg');
    const fin = applyResult(live(fg3), result(fg3, 'fgGood', 60, { type: 'fieldGoal' }));
    expect(fin.phase).toBe('final');
    expect(fin.winner).toBe(f);
  });
  it('a first drive with no score leaves sudden death', () => {
    const o = otOnOffense(reachOt(), 4);
    const a = applyResult(live({ ...o, chosen4th: true }), result(o, 'incomplete', 60));
    expect(a.ot?.stage).toBe('sudden');
    expect(a.winner).toBeNull();
  });
  it('in Sudden death mode, a first-drive field goal wins', () => {
    const o = otOnOffense(reachOt({ overtime: 'sudden' }), 4);
    expect(o.ot?.mode).toBe('sudden');
    const fg = applyChoice({ ...o, phase: 'choice4th', play: null, chosen4th: false }, 'fg');
    const a = applyResult(live(fg), result(fg, 'fgGood', 60, { type: 'fieldGoal' }));
    expect(a.phase).toBe('final');
    expect(a.winner).toBe(o.ot!.first);
  });
  it('overtime lasts one period; level at the end is a tie', () => {
    const o = otOnOffense(reachOt());
    const end = { ...o, clock: 0.5, play: { ...o.play!, clock: 0.5 } };
    const a = applyResult(live(end), result(end, 'tackle', 62, { clock: 0 }));
    expect(a.phase).toBe('final');
    expect(a.winner).toBe('tie');
  });
  it('an answer interrupted by the clock goes to the leader', () => {
    const o = otOnOffense(reachOt());
    const led: MatchState = { ...o, clock: 0.5, score: [10, 7], ot: { ...o.ot!, stage: 'answer' }, possession: 1, play: { ...o.play!, offense: 1, clock: 0.5 } };
    const a = applyResult(live(led), result(led, 'tackle', 62, { clock: 0, possessor: 1, offense: 1 }));
    expect(a.phase).toBe('final');
    expect(a.winner).toBe(0);
  });
});

describe('timeouts', () => {
  it('a timeout on 4th down reopens the choice', () => {
    let m: MatchState = { ...inPlay({}, { down: 4, toGo: 3 }), phase: 'choice4th' as const, play: null };
    m = applyChoice(m, 'go') ;
    expect(m.phase).toBe('huddle');
    const t = applyTimeout(m, 0);
    expect(t.phase).toBe('choice4th');
    expect(t.timeouts[0]).toBe(m.timeouts[0] - 1);
    expect(applyChoice(t, 'punt').play?.type).toBe('punt');
  });
  it('a timeout after choosing a field goal also reopens the choice', () => {
    let m: MatchState = { ...inPlay({}, { down: 4, toGo: 3 }), phase: 'choice4th' as const, play: null };
    m = applyChoice(m, 'fg') ;
    const t = applyTimeout(m, 0);
    expect(t.phase).toBe('choice4th');
    expect(applyChoice(t, 'go').play?.type).toBe('scrimmage');
  });
  it('only the offense can call a timeout', () => {
    const m = inPlay();
    expect(canTimeout(m, 0)).toBe(true);
    expect(canTimeout(m, 1)).toBe(false);
    expect(applyTimeout(m, 1).timeouts).toEqual(m.timeouts);
  });
  it('a timeout stops the runoff', () => {
    const m = live(inPlay({}, { clock: 100 }));
    const a = applyResult(m, result(m, 'tackle', 54, { clock: 94 }));
    const t = applyTimeout(a, 0);
    expect(t.runoffPending).toBe(false);
    expect(t.play?.clock).toBe(94);
    expect(applySnap(t).clock).toBe(94);
  });
  it('no timeouts left means none can be called', () => {
    const m = inPlay({}, { timeouts: [0, 3] });
    expect(canTimeout(m, 0)).toBe(false);
  });
  it('timeouts reset at halftime', () => {
    const m = live(inPlay({}, { clock: 1, period: 2, timeouts: [0, 1] }));
    const a = applyResult(m, result(m, 'tackle', 72, { clock: 0 }));
    expect(a.timeouts).toEqual([3, 3]);
  });
  it.each([['auto', 1, 2], ['auto', 2, 2], ['auto', 3, 3], ['auto', 5, 3], [1, 3, 1]] as const)('timeouts %s with %i-minute quarters give %i', (t, q, n) => {
    expect(match({ timeouts: t, quarter: q }).timeouts).toEqual([n, n]);
  });
});

/** The next play's huddle, after a short gain from the 50. */
function huddle(over = {}, patch: Partial<MatchState> = {}): MatchState {
  const m = live(inPlay(over, patch));
  const a = applyResult(m, result(m, 'tackle', 54));
  expect(a.phase).toBe('huddle');
  return a;
}

describe('the huddle', () => {
  it('every play from scrimmage starts in a huddle, with a coach\'s pick for each side', () => {
    const h = huddle();
    expect(h.huddle?.calls).toEqual([-1, -1]);
    expect(h.play?.playbook).toBe(-1);
    const [o, d] = h.huddle!.suggest;
    expect(PLAYBOOK[o]).toBeDefined();
    expect(DEF_CALLS[d]).toBeDefined();
    expect(h.huddle?.computer).toBe(false);
  });
  it('each side calls its own play, once, and the huddle breaks when both are in', () => {
    const h = huddle();
    const off = h.play!.offense;
    const def = (1 - off) as 0 | 1;
    expect(callerOf(h, 'off')).toBe(off);
    expect(callerOf(h, 'def')).toBe(def);
    expect(canCall(h, def, 'off', 7)).toBe(false);
    expect(canCall(h, off, 'def', 3)).toBe(false);
    expect(canCall(h, off, 'off', PLAYBOOK.length)).toBe(false);
    expect(canCall(h, def, 'def', -1)).toBe(false);
    const a = applyCall(h, off, 'off', 7);
    expect(a.phase).toBe('huddle');
    expect(applyCall(a, off, 'off', 8)).toBe(a);
    const b = applyCall(a, def, 'def', 3);
    expect(b.phase).toBe('presnap');
    expect(b.play?.playbook).toBe(7);
    expect(b.play?.defense).toBe(3);
    expect(b.huddle).toBeNull();
    expect(b.recent[off].at(-1)).toBe(7);
  });
  it("time's up: whoever hasn't called gets the coach's pick", () => {
    const h = huddle();
    const a = applyCall(h, h.play!.offense, 'off', 12);
    const b = huddleTimeout(a);
    expect(b.phase).toBe('presnap');
    expect(b.play?.playbook).toBe(12);
    expect(b.play?.defense).toBe(h.huddle!.suggest[1]);
    const c = huddleTimeout(h);
    expect([c.play?.playbook, c.play?.defense]).toEqual(h.huddle!.suggest);
  });
  it('with the computer on defense, its call is in from the start', () => {
    const h = huddle({ defense: 'computer' });
    expect(h.huddle?.computer).toBe(true);
    expect(DEF_CALLS[h.huddle!.calls[1]]).toBeDefined();
    expect(callerOf(h, 'def')).toBeNull();
    const a = applyCall(h, h.play!.offense, 'off', 0);
    expect(a.phase).toBe('presnap');
    expect(a.play?.defense).toBe(h.huddle!.calls[1]);
  });
  it("each seat's view hides the other side's call and its pick", () => {
    const h = huddle();
    const off = h.play!.offense;
    const def = (1 - off) as 0 | 1;
    const a = applyCall(h, off, 'off', 9);
    expect(viewFor(a, def).huddle?.calls).toEqual([-2, -1]);
    expect(viewFor(a, def).huddle?.suggest[0]).toBe(-1);
    expect(viewFor(a, def).huddle?.suggest[1]).toBe(h.huddle!.suggest[1]);
    expect(viewFor(a, off).huddle?.calls).toEqual([9, -1]);
    expect(viewFor(a, off).huddle?.suggest[1]).toBe(-1);
    // One screen for both: both picks show, no call does.
    expect(viewFor(a, 'shared').huddle?.calls).toEqual([-2, -1]);
    expect(viewFor(a, 'shared').huddle?.suggest).toEqual(h.huddle!.suggest);
    expect(viewFor(a, off).huddle).not.toBe(a.huddle);
    expect(a.huddle?.calls).toEqual([9, -1]);
  });
  it('a timeout in the huddle sends both sides back with fresh calls', () => {
    const h = huddle({}, { timeouts: [3, 3] });
    const off = h.play!.offense;
    const a = applyCall(h, off, 'off', 4);
    expect(canTimeout(a, off)).toBe(true);
    const t = applyTimeout(a, off);
    expect(t.phase).toBe('huddle');
    expect(t.huddle?.calls).toEqual([-1, -1]);
    expect(t.timeouts[off]).toBe(2);
  });
  it('the last plays are kept for the coach to read tendencies, eight at most', () => {
    let m = huddle();
    const off = m.play!.offense;
    for (let i = 0; i < 10; i++) {
      m = huddleTimeout(applyCall(m, off, 'off', i));
      m = applyResult(live(m), result(m, 'tackle', m.ballX + m.attack[off] * 2));
      expect(m.phase).toBe('huddle');
      m = { ...m, down: 1 };
    }
    expect(m.recent[off]).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('other events', () => {
  it('voiding a play replays the down and restores the game clock', () => {
    const pre = inPlay({}, { clock: 100, down: 3, toGo: 4 });
    const v = voidPlay(pre);
    expect([v.down, v.toGo, v.ballX, v.clock]).toEqual([3, 4, 50, 100]);
    // A new snap of the same down, so a new huddle.
    expect(v.phase).toBe('huddle');
    expect(v.playId).toBeGreaterThan(pre.playId);
  });
  it('conceding ends the match for the other seat', () => {
    const c = concede(inPlay(), 0);
    expect(c.phase).toBe('final');
    expect(c.winner).toBe(1);
  });
  it('result checks catch bad data', () => {
    const m = live(inPlay({}, { clock: 100 }));
    expect(isResultValid(m, result(m, 'tackle', 55, { clock: 95 }))).toBe(true);
    expect(isResultValid(m, result(m, 'tackle', 200, { clock: 95 }))).toBe(false);
    expect(isResultValid(m, result(m, 'tackle', 55, { clock: 120 }))).toBe(false);
    expect(isResultValid(m, result(m, 'tackle', 55, { clock: 95, playId: 999 }))).toBe(false);
  });
  it('both players picking the same team puts the second in the away kit', () => {
    expect(awayKits('SEA', 'SEA')).toEqual([false, true]);
    expect(awayKits('SEA', 'LAR')[0]).toBe(false);
  });
  it('team colours too close also use the away kit', () => {
    expect(awayKits('NE', 'SEA')).toEqual([false, true]); // both navy
    expect(awayKits('KC', 'SEA')).toEqual([false, false]);
  });
  it('team ratings settings flow into rosters', () => {
    const real = createMatch(DEFAULT_CONFIG, ['SEA', 'DAL'], 1);
    const equal = createMatch({ ...DEFAULT_CONFIG, ratings: 'equal' }, ['SEA', 'DAL'], 1);
    expect(real.scores[1]).toEqual([92, 60]);
    expect(equal.scores[1]).toEqual([80, 80]);
    expect(effectiveRoster(equal, 0)).toEqual(effectiveRoster(createMatch({ ...DEFAULT_CONFIG, ratings: 'equal' }, ['SEA', 'DAL'], 9), 0));
    expect(simContext(real).cfg.coverLag).toBe(0.3);
  });
  it('an injury replaces the player with a backup rated 2 lower', () => {
    const m = createMatch(DEFAULT_CONFIG, ['SEA', 'DAL'], 1);
    const base = effectiveRoster(m, 0)[2];
    const hurt = { ...m, injured: [[2], []] as [number[], number[]] };
    const backup = effectiveRoster(hurt, 0)[2];
    expect(backup.attrs.spd).toBeCloseTo(Math.max(1, base.attrs.spd - 2));
    expect(backup.star).toBe(false);
  });
  it('condition accumulates from touches', () => {
    const m = live(inPlay());
    const r = result(m, 'tackle', 55);
    r.touches = [[0, 2, -0.02], [0, 2, -0.01]];
    expect(applyResult(m, r).condition[0][2]).toBeCloseTo(0.97);
  });
});

describe('coin toss', () => {
  it('after the coin toss the kick is offered', () => {
    const m = afterCoinToss(match());
    expect(m.phase).toBe('kickChoice'); // 0-0 is tied, so onside is offered
    expect(applyChoice(m, 'deep').play?.type).toBe('kickoff');
    expect(applyChoice(m, 'onside').play?.type).toBe('onside');
  });
});
