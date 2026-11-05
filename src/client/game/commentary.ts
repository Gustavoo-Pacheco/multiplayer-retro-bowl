// One line of commentary for the play that just ended. The strip's colour shows who had the ball.
import { TEAM_BY_ID } from '../../shared/data/teams';
import type { MatchState } from '../../shared/rules/match';

const pick = (lines: string[], n: number): string => lines[Math.abs(n) % lines.length];

export function commentary(m: MatchState): string {
  const l = m.last;
  if (!l) return '';
  if (l.note) return l.note;
  const team = TEAM_BY_ID[m.teams[l.possessor]].nick.toUpperCase();
  const n = l.playId;
  if (l.safety) return pick(['SAFETY! TWO POINTS AND THE BALL', 'TRAPPED IN THE END ZONE. SAFETY!'], n);
  if (l.type === 'twoPoint' && l.end === 'td') return pick(['THE TWO-POINT TRY IS GOOD!', 'TWO MORE ON THE BOARD!'], n);
  if (l.type === 'twoPoint') return pick(['THE TWO-POINT TRY FAILS', 'NO GOOD ON THE TWO-POINT TRY'], n);
  if (l.end === 'td') {
    if (l.turnover) return pick(['RETURNED ALL THE WAY FOR A TOUCHDOWN!', `${team} TAKE IT BACK TO THE HOUSE!`], n);
    return pick([`TOUCHDOWN ${team}!`, 'INTO THE END ZONE! TOUCHDOWN!', `${team} PUNCH IT IN!`], n);
  }
  if (l.end === 'fgGood') return pick(['THE KICK IS GOOD!', 'RIGHT DOWN THE MIDDLE. IT IS GOOD!', 'THROUGH THE UPRIGHTS!'], n);
  if (l.end === 'fgMiss') return pick(['NO GOOD!', 'WIDE! THE KICK IS NO GOOD', 'IT MISSES!'], n);
  if (l.end === 'xpGood') return 'EXTRA POINT IS GOOD';
  if (l.end === 'xpMiss') return 'EXTRA POINT IS NO GOOD!';
  if (l.turnoverOnDowns) return pick(['TURNOVER ON DOWNS', 'STOPPED! TURNOVER ON DOWNS'], n);
  if (l.end === 'pi') return 'FLAG ON THE PLAY. PASS INTERFERENCE, FIRST DOWN';
  if (l.touchback) return pick(['TOUCHBACK', 'DOWNED IN THE END ZONE. TOUCHBACK'], n);
  if (l.turnover) return pick([`${team} TAKE OVER!`, `TURNOVER! ${team} BALL`], n);
  if (l.end === 'incomplete') return pick(['INCOMPLETE', 'THROWN AWAY. INCOMPLETE', 'THE PASS FALLS INCOMPLETE'], n);
  if (l.sack) return pick([`SACKED FOR A LOSS OF ${Math.abs(l.yards)}`, `DOWN GOES THE QUARTERBACK. LOSS OF ${Math.abs(l.yards)}`], n);
  if (l.firstDown) return pick([`FIRST DOWN! GAIN OF ${l.yards}`, `MOVES THE CHAINS. GAIN OF ${l.yards}`], n);
  if (l.big && l.yards > 0) return pick([`BIG PLAY! GAIN OF ${l.yards}`, `WHAT A PLAY! ${l.yards} YARDS`], n);
  if (l.big) return pick(['WHAT A RETURN!', 'A BIG RETURN!'], n);
  if (l.type !== 'scrimmage') return l.type === 'punt' ? 'THE PUNT IS RETURNED' : 'THE KICK IS RETURNED';
  if (l.yards === 0) return 'NO GAIN';
  return l.yards > 0 ? pick([`GAIN OF ${l.yards}`, `PICKS UP ${l.yards}`], n) : `LOSS OF ${-l.yards}`;
}
