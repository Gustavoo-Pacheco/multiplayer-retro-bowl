// The playbook and the defense's calls: the data holds together, and each call does on the field what its card says.
import { describe, expect, it } from 'vitest';
import { DEF_CALLS, DEF_CATS, FORMATIONS, PLAY_CATS, PLAYBOOK, ROUTES, playsIn, rushers } from '../../src/shared/data/playbook';
import { acceptHandoff } from '../../src/shared/sim/contact';
import { step } from '../../src/shared/sim/step';
import { T } from '../../src/shared/sim/tuning';
import type { SimInput, SimState } from '../../src/shared/sim/state';
import { play } from './helpers';

const id = (name: string) => PLAYBOOK.find((p) => p.name === name)!.id;
const def = (name: string) => DEF_CALLS.find((c) => c.name === name)!.id;
const depth = (s: SimState, i: number) => (s.players[i].x - s.desc.los) * s.desc.dir;

function stepFor(s: SimState, seconds: number, first: SimInput[] = []): void {
  step(s, first);
  for (let i = 1; i < seconds * T.hz && !s.finished; i++) { if (s.frozen) acceptHandoff(s); step(s); }
}

describe('the data', () => {
  it('24 plays, six in each tab, with ids that match their place', () => {
    expect(PLAYBOOK).toHaveLength(24);
    PLAYBOOK.forEach((p, i) => expect(p.id).toBe(i));
    for (const c of PLAY_CATS) expect(playsIn(c.id)).toHaveLength(6);
  });
  it('every play names a real formation and real routes, and runs have a hole', () => {
    for (const p of PLAYBOOK) {
      expect(FORMATIONS[p.formation]).toBeDefined();
      for (const a of [p.wr1, p.wr2, p.te, p.rb]) if (a !== 'block' && a !== 'stalk' && a !== 'lead') expect(ROUTES[a]).toBeDefined();
      if (p.kind === 'run' || p.kind === 'pa') expect(p.run).toBeDefined();
      expect(p.gain[0]).toBeLessThanOrEqual(p.gain[1]);
      expect(p.name.length).toBeLessThanOrEqual(11);
    }
  });
  it('nine defensive calls, three in each tab, eight jobs each, man jobs on real receivers', () => {
    expect(DEF_CALLS).toHaveLength(9);
    for (const c of DEF_CATS) expect(DEF_CALLS.filter((d) => d.cat === c.id)).toHaveLength(3);
    for (const c of DEF_CALLS) {
      expect(c.jobs).toHaveLength(8);
      for (const j of c.jobs) if (j.k === 'man') expect([1, 2, 3, 4]).toContain(j.on);
      expect(rushers(c)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the defense lines up for its call', () => {
  it('Man Press puts the corners on the line, and jams the receivers', () => {
    const s = play({ defense: def('MAN PRESS') });
    expect(depth(s, 13)).toBeLessThan(2);
    expect(depth(s, 14)).toBeLessThan(2);
    expect(s.players[2].jam).toBeGreaterThan(0);
    const off = play({ defense: def('COVER 1') });
    expect(depth(off, 13)).toBeGreaterThan(3);
    expect(off.players[2].jam).toBe(0);
  });
  it('LB Blitz sends a linebacker, Cover 0 sends five, Run Stuff crashes both linebackers', () => {
    expect(play({ defense: def('LB BLITZ') }).players.filter((p) => p.job === 'rush')).toHaveLength(4);
    expect(play({ defense: def('COVER 0') }).players.filter((p) => p.job === 'rush')).toHaveLength(5);
    const rs = play({ defense: def('RUN STUFF') });
    expect([rs.players[11].job, rs.players[12].job]).toEqual(['crash', 'crash']);
  });
  it('Cover 2 and Cover 3 play zones, with their deep zones deep', () => {
    for (const name of ['COVER 2', 'COVER 3']) {
      const s = play({ defense: def(name) });
      const zones = s.players.filter((p) => p.job === 'zone');
      expect(zones.length).toBe(5);
      expect(zones.filter((p) => p.zone!.deep).length).toBe(name === 'COVER 2' ? 2 : 3);
    }
  });
  it('Fire Zone drops a lineman into coverage', () => {
    const s = play({ defense: def('FIRE ZONE') });
    expect(s.players[9].job).toBe('zone');
    expect(s.players.filter((p) => p.job === 'rush')).toHaveLength(4);
  });
});

describe('each kind of play', () => {
  it('every play against every call ends', () => {
    for (const p of PLAYBOOK) {
      for (const c of DEF_CALLS) {
        const s = play({ playbook: p.id, defense: c.id, seed: p.id * 31 + c.id });
        stepFor(s, 40, [{ k: 'snap' }]);
        expect(s.finished, `${p.name} v ${c.name}`).toBe(true);
      }
    }
  });
  it('a screen lets the rush in, then the linemen release in front of the back', () => {
    const s = play({ playbook: id('HB SCREEN') });
    stepFor(s, T.play.screenRelease + 0.2, [{ k: 'snap' }]);
    expect(s.players.slice(5, 8).some((p) => p.job === 'release' || p.job === 'stalk')).toBe(true);
  });
  it('power pulls a guard to the hole', () => {
    const s = play({ playbook: id('POWER O') });
    expect(s.players.slice(5, 8).filter((p) => p.job === 'path')).toHaveLength(1);
  });
  it('a sneak keeps the ball with the QB', () => {
    const s = play({ playbook: id('QB SNEAK'), toGo: 1 });
    stepFor(s, 0.3, [{ k: 'snap' }]);
    expect(s.phase).toBe('run');
    expect(s.ball.holder).toBe(0);
  });
  it('Max Protect keeps the tight end and the back in to block', () => {
    const s = play({ playbook: id('MAX PROTECT') });
    expect([s.players[1].job, s.players[4].job]).toEqual(['block', 'block']);
  });
});

describe('the calls change what happens', () => {
  /** Average yards from a play against a call, over many seeds. */
  const avg = (playbook: number, defense: number, n = 60) => {
    let y = 0;
    for (let seed = 1; seed <= n; seed++) {
      const s = play({ playbook, defense, seed: seed * 101 });
      stepFor(s, 40, [{ k: 'snap' }]);
      y += s.result!.yards;
    }
    return y / n;
  };
  it('a dive gains less into Run Stuff than into Prevent', () => {
    expect(avg(id('HB DIVE'), def('RUN STUFF'))).toBeLessThan(avg(id('HB DIVE'), def('PREVENT')));
  });
});
