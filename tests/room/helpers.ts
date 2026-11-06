import type { Seat, ServerMsg } from '../../src/shared/protocol';
import { emptyStats } from '../../src/shared/sim/state';
import type { MatchState } from '../../src/shared/rules/match';
import type { MatchConfig } from '../../src/shared/data/config';
import { joined, newCode, TestClient } from './client';

export interface Pair { a: TestClient; b: TestClient; code: string }

export async function pair(open: TestClient[], cfg: Partial<MatchConfig> = {}, teams: [string, string] = ['SEA', 'LAR']): Promise<Pair & { start: () => Promise<MatchState> }> {
  const code = newCode();
  const a = await joined(code, 'Ann', { create: true });
  const b = await joined(code, 'Bob');
  open.push(a, b);
  a.send({ t: 'setConfig', patch: { replays: 'off', ...cfg } });
  const replays = cfg.replays ?? 'off';
  await b.wait('room', (m) => m.room.config.replays === replays);
  return {
    a, b, code,
    start: async () => {
      a.send({ t: 'pickTeam', team: teams[0] });
      b.send({ t: 'pickTeam', team: teams[1] });
      await a.wait('room', (m) => m.room.seats[1]?.team === teams[1] && m.room.seats[0]?.team === teams[0]);
      await b.wait('room', (m) => m.room.seats[1]?.team === teams[1] && m.room.seats[0]?.team === teams[0]);
      a.send({ t: 'ready', ready: true });
      await a.wait('room', (m) => m.room.seats[0]?.ready === true);
      b.send({ t: 'ready', ready: true });
      const r = await a.wait('matchState', (m) => m.match.phase === 'coinToss');
      await b.wait('matchState', (m) => m.match.phase === 'coinToss');
      return r.match;
    },
  };
}

export const expire = (c: TestClient, what: string) => c.send({ t: 'dev', op: 'expire', what });

export function clearInbox(...cs: TestClient[]): void { for (const c of cs) c.inbox.length = 0; }

export type MS = Extract<ServerMsg, { t: 'matchState' }>;

/** The newest state either way a client can learn it. */
export async function waitState(c: TestClient, pred: (m: MatchState) => boolean, ms = 8000): Promise<MatchState> {
  const until = Date.now() + ms;
  for (;;) {
    for (let i = c.inbox.length - 1; i >= 0; i--) {
      const m = c.inbox[i];
      if ((m.t === 'matchState' || m.t === 'playStart') && pred(m.match)) { c.inbox.splice(0, i + 1); return m.match; }
    }
    if (Date.now() > until) throw new Error(`state not reached; inbox=${JSON.stringify(c.inbox.map((x) => x.t))}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/** The kicking team kicks, with a touchback: what a client reports when no one returns it. */
export async function kickoffTouchback(kicker: TestClient, k: MatchState): Promise<void> {
  const play = k.play!;
  const other = (1 - play.offense) as Seat;
  kicker.send({ t: 'snap', playId: play.id });
  kicker.send({
    t: 'playResult',
    result: {
      playId: play.id, type: play.type, end: 'touchback', spotX: play.dir > 0 ? 115 : 5, possessor: other, offense: play.offense, clock: k.clock, ezImpetus: true, lastCarrier: other,
      sack: false, stats: [emptyStats(), emptyStats()], touches: [], armFatigue: [0, 0], injury: null, yards: 0, big: false,
    },
  });
}

/** Runs from the coin toss through the opening kick to the first huddle. Turn autoCall off first to stay in it. */
export async function toHuddle(p: Pair): Promise<{ huddle: MatchState; offView: MatchState; defView: MatchState; off: TestClient; def: TestClient; offSeat: Seat }> {
  expire(p.a, 'banner');
  const first = await waitState(p.a, (m) => m.phase === 'kickChoice');
  const kicker = first.kicker === 0 ? p.a : p.b;
  kicker.send({ t: 'choice', c: 'deep' });
  const k = await waitState(p.a, (m) => m.phase === 'presnap' && m.play?.type === 'kickoff');
  await kickoffTouchback(kicker, k);
  const h = await waitState(p.a, (m) => m.phase === 'huddle');
  const hb = await waitState(p.b, (m) => m.phase === 'huddle');
  const offSeat = h.play!.offense;
  const [offView, defView] = offSeat === 0 ? [h, hb] : [hb, h];
  return { huddle: h, offView, defView, offSeat, off: offSeat === 0 ? p.a : p.b, def: offSeat === 0 ? p.b : p.a };
}

/** Runs from the coin toss through any automatic kicks to the first play from scrimmage. */
export async function toScrimmage(p: Pair): Promise<{ match: MatchState; off: TestClient; def: TestClient; offSeat: Seat }> {
  expire(p.a, 'banner');
  const pre = (m: MatchState) => m.phase === 'presnap' && m.play?.type === 'scrimmage';
  const first = await waitState(p.a, (m) => m.phase === 'kickChoice');
  const kicker = first.kicker === 0 ? p.a : p.b;
  kicker.send({ t: 'choice', c: 'deep' });
  const k = await waitState(p.a, (m) => m.phase === 'presnap' && m.play?.type === 'kickoff');
  await kickoffTouchback(kicker, k);
  const m = await waitState(p.a, pre);
  await waitState(p.b, pre);
  const offSeat = m.play!.offense;
  return { match: m, offSeat, off: offSeat === 0 ? p.a : p.b, def: offSeat === 0 ? p.b : p.a };
}
