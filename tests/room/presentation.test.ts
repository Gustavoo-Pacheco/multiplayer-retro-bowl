// Replays and score banners through the real room.
import { afterEach, describe, expect, it } from 'vitest';
import type { MatchConfig } from '../../src/shared/data/config';
import type { MatchState } from '../../src/shared/rules/match';
import { inPlay, result } from '../rules/helpers';
import { TestClient } from './client';
import { clearInbox, expire, pair, toScrimmage, waitState } from './helpers';

const open: TestClient[] = [];
afterEach(() => { open.splice(0).forEach((c) => c.close()); });

async function scrimmage(cfg: Partial<MatchConfig>) {
  const p = await pair(open, cfg);
  await p.start();
  return toScrimmage(p);
}

const send = (off: TestClient, m: MatchState, end: 'tackle' | 'td', spot: number, big: boolean) => {
  off.send({ t: 'snap', playId: m.play!.id });
  void inPlay;
  off.send({ t: 'playResult', result: result({ ...m, phase: 'live' }, end, spot, { big, yards: Math.round((spot - m.play!.los) * m.play!.dir) }) });
};

describe('replays in a room', () => {
  it('Big plays shows the replay to both players, and the next controller can skip it', async () => {
    const { match, off, def } = await scrimmage({ replays: 'big' });
    send(off, match, 'tackle', match.play!.los + match.play!.dir * 25, true);
    await waitState(off, (m) => m.phase === 'replay');
    await waitState(def, (m) => m.phase === 'replay');
    clearInbox(off, def);
    // The player who doesn't have the ball next can't skip it.
    def.send({ t: 'skip' });
    await new Promise((r) => setTimeout(r, 250));
    expect(off.inbox.some((m) => m.t === 'playStart')).toBe(false);
    off.send({ t: 'skip' });
    await waitState(def, (m) => m.phase === 'presnap');
  });

  it('a replay nobody skips ends by itself', async () => {
    const { match, off, def } = await scrimmage({ replays: 'big' });
    send(off, match, 'tackle', match.play!.los + match.play!.dir * 25, true);
    await waitState(def, (m) => m.phase === 'replay');
    expire(off, 'banner');
    await waitState(def, (m) => m.phase === 'presnap');
  });

  it('Off shows none', async () => {
    const { match, off, def } = await scrimmage({ replays: 'off' });
    send(off, match, 'tackle', match.play!.los + match.play!.dir * 25, true);
    const m = await waitState(def, (x) => x.phase !== 'live' && x.play?.id !== match.play!.id);
    expect(m.phase).toBe('presnap');
    expect(def.inbox.some((x) => x.t === 'matchState' && x.match.phase === 'replay')).toBe(false);
  });

  it('a touchdown shows the banner to both, then the conversion, and the score is there from the start', async () => {
    const { match, off, def } = await scrimmage({ replays: 'off' });
    const goal = match.play!.dir > 0 ? 110 : 10;
    send(off, match, 'td', goal, true);
    const banner = await waitState(def, (m) => m.phase === 'banner');
    expect(banner.banner?.kind).toBe('touchdown');
    expect(banner.score[match.play!.offense]).toBe(6);
    expire(off, 'banner');
    await waitState(def, (m) => m.phase === 'conversion');
  });

  it('a player dropping during a replay holds the next phase until they return', async () => {
    const { match, off, def } = await scrimmage({ replays: 'big' });
    send(off, match, 'td', match.play!.dir > 0 ? 110 : 10, true);
    await waitState(off, (m) => m.phase === 'banner');
    expire(off, 'banner');
    await waitState(off, (m) => m.phase === 'replay');
    const seat = def.seat!;
    def.close();
    await off.wait('room', (m) => m.room.seats[seat]?.online === false);
    expire(off, 'banner');
    const w = await off.wait('waiting', (m) => m.on);
    expect(w.missing[seat]).toBe(true);
  });
});
