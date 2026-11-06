// Lobby rules, permissions, timers, disconnects and restarts against the real local runtime.
import { afterEach, describe, expect, it } from 'vitest';
import { emptyStats, type PlayResult, type Seat } from '../../src/shared/sim/state';
import { DEFAULT_CONFIG } from '../../src/shared/data/config';
import type { MatchState } from '../../src/shared/rules/match';
import { FRAME_BYTES, emptyFrame, encodeFrame } from '../../src/shared/protocol';
import { joined, TestClient } from './client';
import { clearInbox, expire, pair, toScrimmage, waitState } from './helpers';

const open: TestClient[] = [];
afterEach(() => { open.splice(0).forEach((c) => c.close()); });

function result(m: MatchState, over: Partial<PlayResult> = {}): PlayResult {
  const play = m.play!;
  return {
    playId: play.id, type: play.type, end: 'tackle', spotX: play.los + play.dir * 4, possessor: play.offense, offense: play.offense, clock: m.clock,
    ezImpetus: false, lastCarrier: play.offense, sack: false, stats: [emptyStats(), emptyStats()], touches: [], armFatigue: [0, 0], injury: null, yards: 4, big: false, ...over,
  };
}

describe('lobby', () => {
  it('only the host can change settings, and a change clears both Ready states', async () => {
    const p = await pair(open);
    p.a.send({ t: 'pickTeam', team: 'SEA' });
    p.b.send({ t: 'pickTeam', team: 'LAR' });
    await p.a.wait('room', (m) => m.room.seats[1]?.team === 'LAR');
    p.b.send({ t: 'ready', ready: true });
    await p.a.wait('room', (m) => m.room.seats[1]?.ready === true);

    p.b.send({ t: 'setConfig', patch: { quarter: 1 } });
    expect((await p.b.wait('error')).code).toBe('forbidden');

    p.a.send({ t: 'setConfig', patch: { quarter: 1 } });
    const r = await p.b.wait('room', (m) => m.room.config.quarter === 1);
    expect(r.room.seats[1]?.ready).toBe(false);
  });

  it('rejects settings outside their option lists', async () => {
    const p = await pair(open);
    p.a.send({ t: 'setConfig', patch: { quarter: 7 as 1 } });
    expect((await p.a.wait('error')).code).toBe('badmsg');
    p.a.send({ t: 'setConfig', patch: { nonsense: true } as never });
    expect((await p.a.wait('error')).code).toBe('badmsg');
  });

  it('Ready locks the pick, any change of team clears both, and Ready needs a team', async () => {
    const p = await pair(open);
    p.a.send({ t: 'ready', ready: true });
    expect((await p.a.wait('error')).code).toBe('phase');
    p.a.send({ t: 'pickTeam', team: 'SEA' });
    p.b.send({ t: 'pickTeam', team: 'LAR' });
    await p.a.wait('room', (m) => m.room.seats[1]?.team === 'LAR');
    p.a.send({ t: 'ready', ready: true });
    await p.a.wait('room', (m) => m.room.seats[0]?.ready === true);
    p.a.send({ t: 'pickTeam', team: 'DAL' });
    expect((await p.a.wait('error')).code).toBe('phase');
    p.a.send({ t: 'ready', ready: false });
    await p.a.wait('room', (m) => m.room.seats[0]?.ready === false);
    p.b.send({ t: 'ready', ready: true });
    await p.a.wait('room', (m) => m.room.seats[1]?.ready === true);
    p.a.send({ t: 'pickTeam', team: 'DAL' });
    const r = await p.a.wait('room', (m) => m.room.seats[0]?.team === 'DAL');
    expect(r.room.seats[1]?.ready).toBe(false);
  });

  it('rejects an unknown team', async () => {
    const p = await pair(open);
    p.a.send({ t: 'pickTeam', team: 'XXX' });
    expect((await p.a.wait('error')).code).toBe('badmsg');
  });

  it('both players on one team: the second wears the away kit', async () => {
    const p = await pair(open, {}, ['SEA', 'SEA']);
    const m = await p.start();
    expect(m.away).toEqual([false, true]);
  });

  it('the match starts only when both are ready, and settings lock once it has', async () => {
    const p = await pair(open);
    const m = await p.start();
    expect(m.phase).toBe('coinToss');
    p.a.send({ t: 'setConfig', patch: { quarter: 1 } });
    expect((await p.a.wait('error')).code).toBe('phase');
    p.a.send({ t: 'pickTeam', team: 'DAL' });
    expect((await p.a.wait('error')).code).toBe('phase');
  });
});

describe('permissions', () => {
  it('rejects gameplay messages from the watcher, and accepts them from the offense', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    const id = match.play!.id;
    clearInbox(off, def);
    for (const m of [
      { t: 'snap', playId: id }, { t: 'timeout' }, { t: 'choice', c: 'go' },
      { t: 'playResult', result: result(match) },
    ] as const) {
      def.send(m);
      expect((await def.wait('error')).code).toBe('forbidden');
    }
    expect(off.inbox.some((x) => x.t === 'snap')).toBe(false);
    off.send({ t: 'snap', playId: id });
    const s = await def.wait('snap');
    expect(s.playId).toBe(id);
    expect(s.auto).toBe(false);
  });

  it('rejects a snap for the wrong play id', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off } = await toScrimmage(p);
    clearInbox(off);
    off.send({ t: 'snap', playId: match.play!.id + 5 });
    expect((await off.wait('error')).code).toBe('phase');
  });

  it('relays frames only from the controller, and drops oversized ones', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    off.send({ t: 'snap', playId: match.play!.id });
    await def.wait('snap');
    const f = encodeFrame(emptyFrame());
    expect(f.byteLength).toBe(FRAME_BYTES);
    def.frames.length = 0;
    off.frames.length = 0;
    def.sendRaw(f);
    off.sendRaw(new ArrayBuffer(300));
    off.sendRaw(f);
    await new Promise((r) => setTimeout(r, 200));
    expect(def.frames.length).toBe(1);
    expect(def.frames[0].byteLength).toBe(FRAME_BYTES);
    expect(off.frames.length).toBe(0);
  });

  it('checks results for bounds and for a clock that only counts down', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off } = await toScrimmage(p);
    off.send({ t: 'snap', playId: match.play!.id });
    await new Promise((r) => setTimeout(r, 50));
    clearInbox(off);
    off.send({ t: 'playResult', result: result(match, { spotX: 500 }) });
    expect((await off.wait('error')).code).toBe('badmsg');
    off.send({ t: 'playResult', result: result(match, { clock: match.clock + 50 }) });
    expect((await off.wait('error')).code).toBe('badmsg');
    off.send({ t: 'playResult', result: result(match, { playId: match.play!.id + 1 }) });
    expect((await off.wait('error')).code).toBe('badmsg');
  });

  it('rate limits a flood of messages', async () => {
    const p = await pair(open);
    for (let i = 0; i < 120; i++) p.a.send({ t: 'ptr', x: 0, y: 0 });
    expect((await p.a.wait('error')).code).toBe('rate');
  });

  it('accepts a pause or concede from either player', async () => {
    const p = await pair(open);
    await p.start();
    const { def, off } = await toScrimmage(p);
    def.send({ t: 'pause' });
    const paused = await off.wait('paused', (m) => m.by !== null);
    expect(paused.by).toBe(def.seat);
    expect(paused.left).toBeGreaterThan(0);
    def.send({ t: 'pause' });
    await off.wait('paused', (m) => m.by === null);
    off.send({ t: 'concede' });
    const final = await waitState(def, (m) => m.phase === 'final');
    expect(final.winner).toBe(def.seat);
    expect(final.conceded).toBe(off.seat);
  });
});

describe('timers', () => {
  it('play clock expiry snaps the play for both players', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    clearInbox(off, def);
    expire(p.a, 'playClock');
    const s1 = await off.wait('snap');
    const s2 = await def.wait('snap');
    expect(s1.auto).toBe(true);
    expect(s2.auto).toBe(true);
    expect(s1.playId).toBe(match.play!.id);
  });

  it('play clock expiry on an open choice takes its default', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off } = await toScrimmage(p);
    p.a.send({ t: 'dev', op: 'patch', patch: { phase: 'choice4th', down: 4, toGo: 5, ballX: match.attack[match.possession] > 0 ? 40 : 80, play: null, chosen4th: false } });
    await waitState(off, (m) => m.phase === 'choice4th');
    expire(p.a, 'playClock');
    // From deep in its own half with no field goal in range, the safe default is a punt.
    const m2 = await waitState(off, (m) => m.phase !== 'choice4th');
    expect(m2.possession === match.possession ? m2.chosen4th : true).toBeTruthy();
  });

  it('a pause holds the play clock and ends by itself', async () => {
    const p = await pair(open);
    await p.start();
    const { off, def } = await toScrimmage(p);
    clearInbox(off, def);
    off.send({ t: 'pause' });
    const ms = await def.wait('matchState');
    expect(ms.pc).toBe(null);
    expect(ms.match.pauses[off.seat as Seat]).toBe(DEFAULT_CONFIG.pauses - 1);
    expire(p.a, 'pause');
    await def.wait('paused', (m) => m.by === null);
    const ps = await def.wait('playStart');
    expect(ps.pc).toBeGreaterThan(0);
  });

  it('no game time passes between plays while waiting, and rooms clean up after two hours', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    await new Promise((r) => setTimeout(r, 1200));
    off.send({ t: 'pause' });
    const ms = await def.wait('matchState', (m) => m.pc === null);
    expect(ms.match.clock).toBe(match.clock);
    expire(p.a, 'cleanup');
    expect(await p.a.waitClose()).toBe(4010);
    const late = await new TestClient(p.code).open();
    open.push(late);
    late.send({ t: 'join', nick: 'Late' });
    expect((await late.wait('error')).code).toBe('notfound');
  });
});

describe('disconnects', () => {
  it('watcher drops at a dead ball: the match waits with the clock stopped, then carries on', async () => {
    const p = await pair(open);
    await p.start();
    const { off, def } = await toScrimmage(p);
    const token = def.token;
    const seat = def.seat as Seat;
    clearInbox(off);
    def.close();
    const w = await off.wait('waiting', (m) => m.on);
    expect(w.missing[seat]).toBe(true);
    expect(w.left[seat]).toBeGreaterThan(0);
    off.send({ t: 'snap', playId: 1 });
    expect((await off.wait('error')).code).toBe('phase');
    const back = await joined(p.code, 'Back', { token });
    open.push(back);
    expect(back.seat).toBe(seat);
    await off.wait('waiting', (m) => !m.on);
    const ps = await back.wait('playStart');
    expect(ps.pc).toBeGreaterThan(0);
  });

  it('controller drops before the snap: the match waits', async () => {
    const p = await pair(open);
    await p.start();
    const { off, def } = await toScrimmage(p);
    const token = off.token;
    clearInbox(def);
    off.close();
    await def.wait('waiting', (m) => m.on);
    const back = await joined(p.code, 'Off', { token });
    open.push(back);
    await def.wait('waiting', (m) => !m.on);
    await back.wait('playStart');
  });

  it('hiding the page counts as away at a dead ball', async () => {
    const p = await pair(open);
    await p.start();
    const { off, def } = await toScrimmage(p);
    clearInbox(off, def);
    def.send({ t: 'visibility', visible: false });
    await off.wait('waiting', (m) => m.on);
    def.send({ t: 'visibility', visible: true });
    await off.wait('waiting', (m) => !m.on);
  });

  it('controller drops mid-play: frames stop, and after the watchdog the down replays with the clock restored', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    const token = off.token;
    off.send({ t: 'snap', playId: match.play!.id });
    await def.wait('snap');
    clearInbox(def);
    off.close();
    // The down is replayed from a fresh huddle.
    const m2 = await waitState(def, (m) => m.phase === 'huddle' || m.phase === 'presnap', 9000);
    expect(m2.down).toBe(match.down);
    expect(m2.clock).toBe(match.clock);
    expect(m2.ballX).toBe(match.ballX);
    const back = await joined(p.code, 'Off', { token });
    open.push(back);
    await back.wait('playStart');
  });

  it('a frozen sim hands off to a present watcher, and the old controller yields', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    const id = match.play!.id;
    off.send({ t: 'snap', playId: id });
    await def.wait('snap');
    const state = { fake: 'state' } as never;
    off.send({ t: 'handoff', playId: id, state, to: def.seat as Seat, reason: 'int', spotX: 60 });
    const y = await off.wait('yield');
    expect(y.reason).toBe('int');
    const h = await def.wait('handoff');
    expect(h.reason).toBe('int');
    // Now the new controller's messages are accepted and the old one's are not.
    def.frames.length = 0;
    off.frames.length = 0;
    def.sendRaw(encodeFrame(emptyFrame()));
    await new Promise((r) => setTimeout(r, 80));
    expect(off.frames.length).toBe(1);
    off.send({ t: 'playResult', result: result(match) });
    expect((await off.wait('error')).code).toBe('forbidden');
  });

  it('turnover with the watcher offline or hidden: the old controller is told to continue', async () => {
    for (const how of ['offline', 'hidden'] as const) {
      const p = await pair(open);
      await p.start();
      const { match, off, def } = await toScrimmage(p);
      const id = match.play!.id;
      off.send({ t: 'snap', playId: id });
      await def.wait('snap');
      const gone = def.seat as Seat;
      if (how === 'offline') def.close();
      else def.send({ t: 'visibility', visible: false });
      await off.wait('room', (m) => m.room.seats[gone]?.online === false || m.room.seats[gone]?.visible === false);
      off.send({ t: 'handoff', playId: id, state: {} as never, to: (1 - (off.seat as number)) as Seat, reason: 'fumble', spotX: 60 });
      expect((await off.wait('continue')).playId).toBe(id);
      // The auto-runner's result still ends the play, and the match then waits for the missing player.
      clearInbox(off);
      off.send({ t: 'playResult', result: result(match, { possessor: (1 - (off.seat as number)) as Seat, spotX: 60 }) });
      await off.wait('waiting', (m) => m.on);
      const st = await waitState(off, (m) => m.phase === 'huddle' || m.phase === 'presnap' || m.phase === 'banner');
      expect(st.possession).toBe(1 - (off.seat as number));
    }
  });

  it('controller drops after a turnover handoff: the turnover stands at the handoff spot', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    const id = match.play!.id;
    off.send({ t: 'snap', playId: id });
    await def.wait('snap');
    off.send({ t: 'handoff', playId: id, state: {} as never, to: def.seat as Seat, reason: 'int', spotX: 62 });
    await def.wait('handoff');
    clearInbox(off);
    // The new controller vanishes without sending a frame.
    def.close();
    const m2 = await waitState(off, (m) => m.phase === 'huddle' || m.phase === 'presnap' || m.phase === 'banner', 9000);
    expect(m2.possession).toBe(def.seat);
    expect(m2.ballX).toBe(62);
    expect(m2.down).toBe(1);
  });

  it('reconnect expiry lets the remaining player claim the win or keep waiting', async () => {
    const p = await pair(open);
    await p.start();
    const { off, def } = await toScrimmage(p);
    clearInbox(off, def);
    def.send({ t: 'claimWin' });
    expect((await def.wait('error')).code).toBe('forbidden');
    def.close();
    await off.wait('waiting', (m) => m.on);
    off.send({ t: 'claimWin' });
    expect((await off.wait('error')).code).toBe('forbidden');
    expire(off, 'reconnect');
    const w = await off.wait('waiting', (m) => m.canClaim === off.seat);
    expect(w.on).toBe(true);
    off.send({ t: 'claimWin' });
    const m = await waitState(off, (x) => x.phase === 'final');
    expect(m.winner).toBe(off.seat);
  });

  it('a player who returns after expiry cancels the claim, and the game goes on', async () => {
    const p = await pair(open);
    await p.start();
    const { off, def } = await toScrimmage(p);
    const token = def.token;
    def.close();
    await off.wait('waiting', (m) => m.on);
    expire(off, 'reconnect');
    await off.wait('waiting', (m) => m.canClaim === off.seat);
    const back = await joined(p.code, 'Back', { token });
    open.push(back);
    await off.wait('waiting', (m) => !m.on && m.canClaim === null);
    off.send({ t: 'claimWin' });
    expect((await off.wait('error')).code).toBe('forbidden');
  });

  it('both players drop: state stays saved, and both resume', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    const [ta, tb] = [off.token, def.token];
    off.close();
    def.close();
    await new Promise((r) => setTimeout(r, 200));
    const a2 = await joined(p.code, 'A', { token: ta });
    const b2 = await joined(p.code, 'B', { token: tb });
    open.push(a2, b2);
    expect(a2.seat).toBe(off.seat);
    expect(b2.seat).toBe(def.seat);
    const ps = await a2.wait('playStart');
    expect(ps.play.id).toBe(match.play!.id);
    await b2.wait('playStart');
  });

  it('room restart mid-match: state reloads and any play in progress is voided', async () => {
    const p = await pair(open);
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    const [to, td] = [off.token, def.token];
    const seatOff = off.seat;
    off.send({ t: 'snap', playId: match.play!.id });
    await def.wait('snap');
    off.send({ t: 'dev', op: 'restart' });
    await off.waitClose();
    await def.waitClose();
    const o2 = await joined(p.code, 'O', { token: to });
    const d2 = await joined(p.code, 'D', { token: td });
    open.push(o2, d2);
    expect(o2.seat).toBe(seatOff);
    const m2 = await waitState(o2, (m) => m.phase === 'presnap');
    expect(m2.down).toBe(match.down);
    expect(m2.clock).toBe(match.clock);
    expect(m2.score).toEqual(match.score);
    expect(m2.play!.offense).toBe(match.play!.offense);
  });

  it('restart at a dead ball keeps the room, teams and score', async () => {
    const p = await pair(open, { quarter: 1 });
    await p.start();
    const { match, off, def } = await toScrimmage(p);
    const [to, td] = [off.token, def.token];
    off.send({ t: 'dev', op: 'restart' });
    await off.waitClose();
    const o2 = await joined(p.code, 'O', { token: to });
    const d2 = await joined(p.code, 'D', { token: td });
    open.push(o2, d2);
    const r = await o2.wait('room', (m) => m.room.seats[0]?.team === 'SEA');
    expect(r.room.config.quarter).toBe(1);
    expect(r.room.screen).toBe('match');
    const m2 = await waitState(o2, (m) => m.phase === 'presnap');
    expect(m2.ballX).toBe(match.ballX);
  });
});

describe('rematch', () => {
  it('resets the match but keeps the room and settings', async () => {
    const p = await pair(open, { quarter: 2 });
    await p.start();
    const { off, def } = await toScrimmage(p);
    off.send({ t: 'rematch' });
    expect((await off.wait('error')).code).toBe('phase');
    off.send({ t: 'concede' });
    await waitState(def, (m) => m.phase === 'final');
    def.send({ t: 'rematch' });
    const r = await off.wait('room', (m) => m.room.screen === 'lobby');
    expect(r.room.code).toBe(p.code);
    expect(r.room.config.quarter).toBe(2);
    expect(r.room.seats[0]?.ready).toBe(false);
    expect(r.room.seats[1]?.ready).toBe(false);
    expect(r.room.seats[0]?.nick).toBe('Ann');
    expect(r.room.seats[0]?.team).toBe('SEA');
  });
});
