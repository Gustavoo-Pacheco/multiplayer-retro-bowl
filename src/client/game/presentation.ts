// What a match looks and sounds like around the plays: sounds, effects, celebrations, the referee and replays.
import { TEAM_BY_ID } from '../../shared/data/teams';
import type { Frame } from '../../shared/protocol';
import type { MatchState } from '../../shared/rules/match';
import { EV, type Seat } from '../../shared/sim/state';
import { audio } from '../audio/engine';
import type { SoundName } from '../audio/sounds';
import { Effects } from '../render/effects';
import type { SceneInfo, SceneOpts } from '../render/scene';
import { prefs } from '../ui/prefs';
import { commentary } from './commentary';
import { ReplayBuffer } from './replay';

const EV_SOUNDS: [number, SoundName][] = [
  [EV.snap, 'snapCall'], [EV.throw, 'throw'], [EV.catch, 'catch'], [EV.drop, 'drop'], [EV.tackle, 'tackle'], [EV.grunt, 'grunt'],
  [EV.stiff, 'stiffArm'], [EV.dive, 'dive'], [EV.kick, 'kick'], [EV.post, 'goalpost'], [EV.whistle, 'whistle'], [EV.juke, 'throw'],
];

const CROWD_AFTER: Partial<Record<string, SoundName>> = { incomplete: 'groan', fgMiss: 'groan', xpMiss: 'groan', pi: 'boo' };
const TRAIL = 14;

export class Presentation {
  fx = new Effects();
  replay = new ReplayBuffer();
  commentary = '';
  private seenLast = -1;
  private exciteUntil = 0;
  private trail: { x: number; y: number; z: number }[] = [];
  private bannerStart = 0;
  private bannerKey = '';
  private helpedStart = 0;
  private helped: { x: number; y: number; seat: Seat; skin: number } | null = null;
  private lastFire = 0;
  private lastMeter = -1;

  /** A new play is about to start: forget the last one's frames. */
  startPlay(): void { this.replay.reset(); this.trail = []; this.lastMeter = -1; }

  /** Sounds and effects from a frame's event bits. Both screens get the same bits. */
  onEvents(ev: number, f: Frame): void {
    if (!ev) return;
    for (const [bit, name] of EV_SOUNDS) if (ev & bit) audio.play(name);
    if (ev & EV.tackle) { this.fx.burst(f.bx, f.by); this.fx.dust(f.bx, f.by); }
    if (ev & EV.dive) this.fx.dust(f.bx, f.by);
    if (ev & EV.fumble) { audio.play('drop'); audio.play('groan'); this.fx.dust(f.bx, f.by, 10); }
    if (ev & EV.int) { audio.play('turnover'); audio.play('groan'); }
    if (ev & EV.bigPlay) { audio.play('swell'); this.exciteUntil = Math.max(this.exciteUntil, performance.now() + 2500); }
  }

  /** The kicker hears the meter tick as it climbs. */
  meterTick(f: Frame): void {
    const step = Math.floor(f.ax * 10);
    if (step !== this.lastMeter) { this.lastMeter = step; audio.play('meterTick'); }
  }

  /** Reacts once to each finished play, and to each change of phase. */
  onMatch(prev: MatchState | null, m: MatchState, me: Seat | null, info: SceneInfo | null, f: Frame): void {
    const l = m.last;
    if (l && l.playId !== this.seenLast) {
      // Joining a match already under way shouldn't replay the sound of a play nobody just saw.
      if (prev) this.react(m, info, f);
      this.seenLast = l.playId;
      this.commentary = commentary(m);
    }
    const bannerKey = m.phase === 'banner' && m.banner ? `${m.banner.kind}:${m.playId}` : '';
    if (bannerKey !== this.bannerKey) {
      this.bannerKey = bannerKey;
      this.bannerStart = performance.now();
      const kind = m.banner?.kind;
      if (bannerKey) {
        if (kind === 'quarter' || kind === 'overtime' || kind === 'half') audio.play('quarterHorn');
        if (kind === 'twoMin') audio.play('whistle');
      }
      audio.setSong(kind === 'half' ? 'menu' : null);
    }
    if (m.phase === 'replay' && prev?.phase !== 'replay') this.replay.begin();
    if (m.phase !== 'replay') this.replay.active = false;
    if (m.phase === 'final' && prev?.phase !== 'final') this.onFinal(m, me);
  }

  private react(m: MatchState, info: SceneInfo | null, f: Frame): void {
    const l = m.last!;
    const team = TEAM_BY_ID[m.teams[l.possessor]];
    const colours = [team.primary, team.secondary, '#ffffff'];
    const now = performance.now();
    if (l.safety) { audio.play('fgGood'); audio.play('cheer'); }
    else if (l.scored >= 6 || (l.type === 'twoPoint' && l.scored > 0)) {
      audio.play('tdSting');
      audio.play('cheer');
      this.fx.confetti(colours);
      this.fx.firework(colours);
      this.exciteUntil = now + 4500;
    } else if (l.end === 'fgGood' || l.end === 'xpGood') {
      audio.play('fgGood');
      audio.play('cheer');
      if (l.end === 'fgGood') { this.fx.firework(colours); this.exciteUntil = now + 3000; }
    } else if (l.turnoverOnDowns) { audio.play('turnover'); audio.play('groan'); }
    else if (l.firstDown) audio.play('firstDown');
    if (l.end === 'fgMiss' || l.end === 'xpMiss') audio.play('fgMiss');
    if (l.end === 'pi') audio.play('penalty');
    if (l.sack) audio.play('groan');
    const after = CROWD_AFTER[l.end];
    if (after) audio.play(after);
    if (l.injury && info) {
      const [seat, slot] = l.injury;
      const i = info.seats.findIndex((s, n) => s === seat && info.slots[n] === slot);
      this.helped = { x: i >= 0 ? f.px[i] : f.bx, y: i >= 0 ? f.py[i] : f.by, seat, skin: i >= 0 ? info.skins[i] : 0 };
      this.helpedStart = now;
    }
  }

  private onFinal(m: MatchState, me: Seat | null): void {
    audio.play('gameHorn');
    audio.setCrowd(false);
    audio.setSong(null);
    const won = m.winner !== 'tie' && m.winner !== null && (me === null || m.winner === me);
    if (m.winner !== 'tie') audio.play(won ? 'winSting' : 'lossSting');
    else audio.play('lossSting');
    if (m.winner !== 'tie' && m.winner !== null) this.fx.confetti(this.winnerColours(m), 160);
  }

  private winnerColours(m: MatchState): string[] {
    const t = TEAM_BY_ID[m.teams[m.winner as Seat]];
    return [t.primary, t.secondary, '#ffffff', '#ffd23f'];
  }

  get excited(): boolean { return performance.now() < this.exciteUntil; }

  update(dt: number, m: MatchState | null, f: Frame, now: number): void {
    this.fx.update(dt);
    // Keep the trail while the ball is in the air.
    if (f.carrier < 0 && f.bz > 0.2) {
      this.trail.push({ x: f.bx, y: f.by, z: f.bz });
      if (this.trail.length > TRAIL) this.trail.shift();
    } else if (this.trail.length) this.trail.shift();
    if (!m) return;
    const scoring = m.phase === 'banner' && (m.banner?.kind === 'touchdown' || m.banner?.kind === 'score');
    const won = m.phase === 'final' && m.winner !== 'tie' && m.winner !== null;
    if ((scoring || won) && now - this.lastFire > (won ? 500 : 800)) {
      this.lastFire = now;
      const l = m.last;
      if (won) this.fx.firework(this.winnerColours(m));
      else if (l) { const t = TEAM_BY_ID[m.teams[l.possessor]]; this.fx.firework([t.primary, t.secondary, '#fff']); }
    }
  }

  /** Who stands where while the banner runs. */
  private celebrating(m: MatchState, info: SceneInfo, f: Frame): ((i: number) => string | null) | null {
    if (m.phase !== 'banner' || !m.last || (m.banner?.kind !== 'touchdown' && m.banner?.kind !== 'score')) return null;
    const scorer = m.last.possessor;
    const star = m.last.playId % 3;
    const tick = Math.floor(performance.now() / 200);
    let lead = f.carrier;
    if (lead < 0) lead = info.seats.findIndex((s) => s === scorer);
    return (i) => {
      if (info.seats[i] !== scorer) return i % 3 === 0 ? 'kneel' : 'stance';
      if (i === lead) return (['spike', 'tdDance', 'taunt'] as const)[star];
      const near = Math.hypot(f.px[i] - f.px[lead], f.py[i] - f.py[lead]) < 9;
      if (near && m.banner?.kind === 'touchdown' && (i + tick) % 7 === 0) return 'pile';
      return 'celebrate';
    };
  }

  /** The referee stands behind the ball and signals what happened. */
  private refFor(m: MatchState | null, info: SceneInfo, f: Frame): SceneOpts['ref'] {
    const x = f.phase === 'pre' ? info.desc.los - info.desc.dir * 7 : f.bx - 5;
    const y = 2.2;
    const face = f.bx >= x ? 1 : -1;
    if (m && f.phase !== 'pre' && (m.phase !== 'live' && m.phase !== 'presnap')) {
      const l = m.last;
      const pose = !l ? 'stance' : l.scored > 0 || l.end === 'fgGood' || l.end === 'xpGood' ? 'refTd' : l.end === 'pi' ? 'refPenalty' : l.end === 'incomplete' || l.end === 'fgMiss' || l.end === 'xpMiss' ? 'refIncomplete' : l.firstDown ? 'refFirst' : 'stance';
      return { x, y, pose, face };
    }
    return { x, y, pose: 'stance', face };
  }

  sceneOpts(m: MatchState | null, info: SceneInfo, f: Frame, now: number): SceneOpts {
    let helped: SceneOpts['helped'] = null;
    if (this.helped) {
      const age = now - this.helpedStart;
      if (age > 4000) this.helped = null;
      else helped = { x: this.helped.x, y: Math.max(-1, this.helped.y - age / 450), seat: this.helped.seat, skin: this.helped.skin, tick: Math.floor(age / 16) };
    }
    return {
      nameTags: prefs.nameTags, starMarkers: prefs.starMarkers,
      override: m ? this.celebrating(m, info, f) : null,
      ref: this.refFor(m, info, f), helped, trail: this.trail, excited: this.excited, now,
    };
  }

  bannerAge(now: number): number { return now - this.bannerStart; }
}
