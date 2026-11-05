// The plan's balance targets, checked with bots in real games.
import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/shared/data/teams';
import { matchup, runGames } from '../../tools/balance';

const GAMES = 60;
const pair = (i: number): [string, string] => [TEAMS[(i * 7) % 32].id, TEAMS[(i * 11 + 3) % 32].id];

describe('balance targets', () => {
  const avg = matchup(80, 80, GAMES);
  const strong = matchup(99, 60, GAMES);
  const weak = matchup(60, 99, GAMES);
  const games = runGames(GAMES, {}, pair);

  it('completions run 60 to 70% at Normal with average teams', () => {
    expect(avg.comp).toBeGreaterThanOrEqual(0.6);
    expect(avg.comp).toBeLessThanOrEqual(0.7);
  });
  it('sacks come about 1 in 8 dropbacks', () => {
    expect(avg.sacksPerDropback).toBeGreaterThanOrEqual(6.5);
    expect(avg.sacksPerDropback).toBeLessThanOrEqual(10);
  });
  it('99 OFF v 60 DEF is clearly above average, but under about 9 yards a play', () => {
    expect(strong.yPlay).toBeGreaterThan(avg.yPlay + 1);
    expect(strong.yPlay).toBeLessThan(9.5);
  });
  it('60 OFF v 99 DEF is clearly below average, but above about 2 yards a play', () => {
    expect(weak.yPlay).toBeLessThan(avg.yPlay - 1);
    expect(weak.yPlay).toBeGreaterThan(2);
  });
  it('turnovers run about 1 to 3 a game', () => {
    const per = games.turnovers / games.games;
    expect(per).toBeGreaterThanOrEqual(1);
    expect(per).toBeLessThanOrEqual(3);
  });
  it('a Standard game scores about 30 to 55 combined', () => {
    const per = games.points / games.games;
    expect(per).toBeGreaterThanOrEqual(30);
    expect(per).toBeLessThanOrEqual(55);
  });
  it('every game finishes under the real rules', () => {
    expect(games.games).toBe(GAMES);
    expect(games.plays / games.games).toBeGreaterThan(40);
  });
});
