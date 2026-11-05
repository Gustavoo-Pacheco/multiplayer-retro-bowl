// Ends a play and builds the result the rules module will read.
import { T } from './tuning';
import { dirOf, EV, inOwnEndZone, isKickType, type PlayEnd, type PlayResult, type SimState } from './state';

export function endPlay(s: SimState, end: PlayEnd, spotOverride?: number): void {
  if (s.phase === 'dead') return;
  const holder = s.ball.holder >= 0 ? s.players[s.ball.holder] : null;
  let spotX = spotOverride ?? (holder ? holder.x : s.ball.x);
  spotX = Math.max(0, Math.min(T.field.len, spotX));
  const dir = s.desc.dir;
  const off = s.desc.offense;
  const gain = (spotX - s.desc.los) * dir;
  const yards = s.possessor === off ? Math.round(gain) : 0;
  const stats = s.stats[off];
  const isScrimmage = s.desc.type === 'scrimmage' || s.desc.type === 'twoPoint';
  const wasSack = s.phase === 'pocket' && holder?.job === 'qb' && (end === 'tackle' || end === 'oob');
  if (isScrimmage && s.possessor === off) {
    if (wasSack) { stats.sacks += 1; }
    else if (s.pass && s.catchX !== 0 && end !== 'incomplete' && end !== 'pi') stats.passYds += yards;
    else if (!s.pass && end !== 'incomplete') stats.rushYds += yards;
  }
  const dirHolder = holder ? dirOf(s, holder.seat) : dir;
  let ret = 0;
  if (isKickType(s.desc.type) && s.kick?.caught && s.possessor !== off) {
    ret = Math.round((spotX - s.catchX) * dirOf(s, s.possessor));
    s.stats[s.possessor].retYds += ret;
  }
  const big = (isScrimmage && Math.abs(yards) >= T.play.bigGain) || ret >= T.play.bigReturn || end === 'td' || end === 'fgGood';
  const r: PlayResult = {
    playId: s.desc.id, type: s.desc.type, end, spotX, possessor: s.possessor, offense: off,
    clock: Math.max(0, s.clock), ezImpetus: s.ezImpetus && inOwnEndZone(spotX, dirHolder),
    lastCarrier: s.lastCarrier, sack: wasSack, stats: s.stats, touches: s.touches, armFatigue: s.armFatigue,
    injury: s.injury, yards, big,
  };
  s.result = r;
  s.phase = 'dead';
  s.phaseT = 0;
  s.deadT = 0;
  s.clockRun = false;
  s.ev |= EV.whistle;
  if (end === 'td') s.ev |= EV.td;
  if (big) s.ev |= EV.bigPlay;
}
