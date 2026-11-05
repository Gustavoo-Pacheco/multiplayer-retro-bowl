// The sprites are pure data until a browser recolours them, so all of it can be checked here.
import { describe, expect, it } from 'vitest';
import { A } from '../../src/shared/sim/state';
import { ALL_FRAMES, CELL_H, CELL_W, CELLS, composedCells, composePose } from '../../src/client/art/compose';
import { BUILDS, type BuildName } from '../../src/client/art/parts';
import { GROUPS, POSES } from '../../src/client/art/poses';
import { lum, paletteFor, SKINS, teamKit } from '../../src/client/art/palette';
import { TEAMS } from '../../src/shared/data/teams';

describe('sprites', () => {
  it('has the 13 groups in the spec, with every frame it lists', () => {
    expect(GROUPS.length).toBe(13);
    const want: Record<string, string[]> = {
      Quarterback: ['stance', 'dropBack', 'aim', 'throw', 'handoff', 'run', 'scramble', 'sacked'],
      'Runner or receiver': ['ready', 'run', 'runBall', 'catch', 'drop', 'jukeL', 'jukeR', 'stiff', 'dive', 'truck', 'tackled', 'fumble', 'getUp'],
      'Tight end': ['block', 'catch', 'tackled'],
      'Offensive line': ['stance3', 'block', 'push', 'pushed'],
      'Defensive line': ['stance3', 'rush', 'tackle', 'sack'],
      'Linebacker and defensive back': ['ready', 'backpedal', 'run', 'tackle', 'dive', 'int'],
      Kicker: ['kickStance', 'kickApproach', 'kick', 'onside', 'celebrate'],
      'Punter or holder': ['hold', 'punt'],
      Referee: ['refTd', 'refFirst', 'refIncomplete', 'refPenalty'],
      Celebrations: ['spike', 'taunt', 'kneel', 'pile'],
      Cheerleaders: ['cheerIdle', 'cheer'],
      Injury: ['hurt', 'helped'],
      'Sideline crowd': ['coachIdle', 'benchIdle', 'photoIdle'],
    };
    for (const [name, frames] of Object.entries(want)) {
      const g = GROUPS.find((x) => x.name === name);
      expect(g, name).toBeDefined();
      for (const f of frames) expect(g!.frames, `${name}: ${f}`).toContain(f);
    }
  });

  it('every frame a group lists exists', () => {
    for (const g of GROUPS) for (const f of g.frames) expect(POSES[f], `${g.name}: ${f}`).toBeDefined();
  });

  it('every animation the sim can send has a drawing', () => {
    for (const name of Object.keys(A)) expect(POSES[name], name).toBeDefined();
  });

  it('nothing is cut off by the edge of its cell, and nothing is blank', () => {
    const cells = composedCells();
    cells.forEach((c, i) => {
      const r = CELLS[i];
      expect(c.clipped, `${r.build}:${r.name}:${r.frame} lost pixels`).toBe(0);
      expect(c.rows.length).toBe(CELL_H);
      expect(c.rows.every((row) => row.length === CELL_W)).toBe(true);
      expect(c.rows.join('').replace(/[.O]/g, '').length, `${r.build}:${r.name}`).toBeGreaterThan(40);
    });
  });

  it('every figure stands on the ground unless its pose lifts it', () => {
    composedCells().forEach((c, i) => {
      const r = CELLS[i];
      const pose = POSES[r.name][r.frame];
      const lowest = c.rows.reduce((low, row, y) => (/[^.O]/.test(row) ? y : low), 0);
      expect(lowest, `${r.build}:${r.name}`).toBe(CELL_H - 1 - (pose.air ?? 0));
    });
  });

  it('every letter used has a colour in every kit and skin tone', () => {
    const used = new Set(composedCells().flatMap((c) => c.rows.join('').split('')));
    used.delete('.');
    for (const skin of SKINS) {
      const pal = paletteFor(teamKit(TEAMS[0], false), skin);
      for (const ch of used) expect(pal[ch], `letter ${ch}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('draws the same pose from a shared body in each build', () => {
    const size = (b: BuildName) => composePose(POSES.stance[0], b).rows.join('').replace(/[.]/g, '').length;
    expect(size('big')).toBeGreaterThan(size('std'));
    expect(size('std')).toBeGreaterThan(size('slim'));
    expect(Object.keys(BUILDS).length).toBeLessThanOrEqual(8);
    expect(ALL_FRAMES.length).toBeGreaterThan(40);
  });
});

describe('kits', () => {
  it('every team has a readable home and away kit', () => {
    for (const t of TEAMS) {
      const home = teamKit(t, false);
      const away = teamKit(t, true);
      expect(away.jersey, t.id).toBe('#f4f4ee');
      expect(Math.abs(lum(home.jersey) - lum(home.number)), `${t.id} number`).toBeGreaterThan(0.25);
      expect(Math.abs(lum(away.jersey) - lum(away.trim)), `${t.id} away trim`).toBeGreaterThan(0.2);
    }
  });
});
