// The match on this device: runs the sim when this player has the ball, plays frames otherwise.
import { decodeFrame, encodeFrame, emptyFrame, frameFromSim, type Frame, type HandoffReason, type RoomView, type ServerMsg } from '../../shared/protocol';
import { DEF_CALLS, PLAYBOOK, isRunKind } from '../../shared/data/playbook';
import { TEAM_BY_ID } from '../../shared/data/teams';
import { botChoice } from '../../shared/rules/coach';
import { botCall } from '../../shared/rules/playcall';
import { applySnap, callerOf, effectiveRoster, nextController, simContext, type CallSide, type MatchState } from '../../shared/rules/match';
import { hashStr } from '../../shared/sim/rng';
import { botInputs, newBot, type BotState } from '../../shared/sim/bot';
import { acceptHandoff, continueWithAutoRunner } from '../../shared/sim/contact';
import { aimFadeAlpha } from '../../shared/sim/pass';
import { createPlay } from '../../shared/sim/setup';
import { DT, step } from '../../shared/sim/step';
import { dirOf, type PlayDesc, type Seat, type SimInput, type SimPhase, type SimState } from '../../shared/sim/state';
import { T } from '../../shared/sim/tuning';
import { GestureRecognizer } from '../input/gestures';
import { bindKeyboard } from '../input/keyboard';
import { bindPointer } from '../input/pointer';
import { FrameBuffer } from '../net/buffer';
import type { NetLike } from '../net/socket';
import { audio } from '../audio/engine';
import { ATLAS } from '../art/atlas';
import { lum, teamKit, type Kit } from '../art/palette';
import { drawField, buildField, type FieldArt } from '../render/field';
import { drawStrip, drawText, textWidth } from '../render/font';
import { downText, drawHud, spotText } from '../render/hud';
import { drawBanner, drawKickMeter, drawScoreboard, drawWeather } from '../render/overlays';
import { drawBallOverHud, drawScene, routeLines, type SceneInfo } from '../render/scene';
import { Stage } from '../render/stage';
import { Camera, screenX, screenY } from '../render/view';
import { devTuningChanges, mountDevPanel, type DevPanel, type ForceKind } from '../ui/dev-panel';
import { HudOverlay } from '../ui/hud';
import { openHelp, openPrefs } from '../ui/panels';
import { PlaybookPanel, type PlaybookView } from '../ui/playbook';
import { applyFullscreen, prefs } from '../ui/prefs';
import { Presentation } from './presentation';

export interface SessionOpts {
  local: boolean; bot: boolean; speed: number; dev: boolean;
  /** Called when the match reaches its final state. */
  onFinal(m: MatchState): void;
}

export function kitsFor(m: MatchState): [Kit, Kit] {
  return [teamKit(m.teams[0], m.away[0]), teamKit(m.teams[1], m.away[1])];
}

/** Sprite details for each player on the field: skin tone, star marker and name. */
function rosterArt(s: SimState, m: MatchState): Pick<SceneInfo, 'skins' | 'stars' | 'names' | 'slots'> {
  const rosters = [effectiveRoster(m, 0), effectiveRoster(m, 1)];
  return {
    skins: s.players.map((p) => (hashStr(`${m.teams[p.seat]}:${p.slot}`) >>> 0) % 4),
    stars: s.players.map((p) => !!rosters[p.seat][p.slot]?.star),
    names: s.players.map((p) => rosters[p.seat][p.slot]?.name ?? ''),
    slots: s.players.map((p) => p.slot),
  };
}

/** The bottom hint before the snap, which depends on the play that was called. */
function snapHint(s: SimState): string {
  if (s.desc.type !== 'scrimmage' && s.desc.type !== 'twoPoint') return 'TAP TO SNAP';
  const kind = PLAYBOOK[s.desc.playbook]?.kind ?? 'pass';
  if (kind === 'sneak') return 'TAP TO SNAP. THE QB PUSHES AHEAD';
  if (isRunKind(kind)) return 'TAP TO SNAP. TAP THE QB TO KEEP IT';
  return 'TAP TO SNAP. TAP THE QB TO RUN';
}

export class Session {
  stage: Stage;
  hud: HudOverlay;
  playbook: PlaybookPanel;
  match: MatchState | null = null;
  room: RoomView | null = null;
  seat: Seat | null = null;
  sim: SimState | null = null;
  desc: PlayDesc | null = null;
  info: SceneInfo | null = null;
  frame: Frame = emptyFrame();
  hasFrame = false;
  buffer = new FrameBuffer();
  cam = new Camera();
  gestures = new GestureRecognizer();
  queue: SimInput[] = [];
  bot: BotState;
  stats = { framesSent: 0, framesRecv: 0, handoffs: 0, yields: 0, continues: 0, plays: 0, snaps: 0, watcherUnderruns: 0, watcherFrames: 0, worstHold: 0 };
  log: string[] = [];
  paused = false;
  pausedBy: Seat | null = null;
  waiting = false;
  waitingInfo: Extract<ServerMsg, { t: 'waiting' }> | null = null;
  playClockEnd: number | null = null;
  bannerEnd = 0;
  turnBanner = '';
  turnBannerEnd = 0;
  pres = new Presentation();
  /** Whether the last drawn frame included the kick meter. */
  meterShown = false;
  private holdUntil = 0;
  private acc = 0;
  private lastFrameSent = 0;
  private sendEv = 0;
  private sentSnap = false;
  private handoffSent = false;
  private resultSent = false;
  private lastNow = 0;
  private fieldCache = new Map<string, FieldArt>();
  private unbind: (() => void)[] = [];
  private raf = 0;
  private botChoiceAt = 0;
  private live = false;
  private shadow: SimState | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private devPanel: DevPanel | null = null;
  private armedForce: ForceKind | null = null;
  /** The huddle view on screen, and when a bot makes its call for it. */
  private huddleView: PlaybookView | null = null;
  private botCallKey = '';
  private botCallAt = 0;
  private readonly keys = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

  constructor(parent: HTMLElement, public net: NetLike, public opts: SessionOpts) {
    this.stage = new Stage(parent);
    this.bot = newBot(Math.floor(Math.random() * 1e9));
    this.hud = new HudOverlay(this.stage.overlay, {
      timeout: () => this.sendTimeout(), pause: () => this.net.send({ t: 'pause' }),
      choice: (c) => this.net.send({ t: 'choice', c }), concede: () => this.net.send({ t: 'concede' }),
      claim: () => this.net.send({ t: 'claimWin' }), skip: () => this.net.send({ t: 'skip' }),
      settings: () => openPrefs(), help: () => openHelp(),
    });
    this.playbook = new PlaybookPanel(this.stage.overlay, (side, id) => this.sendCall(side, id));
    this.unbind.push(bindPointer(this.stage, this.gestures));
    this.unbind.push(bindKeyboard({
      phase: () => (this.controlling() ? this.sim!.phase : null),
      forwardKey: () => (this.sim && dirOf(this.sim, this.sim.possessor) > 0 ? 'ArrowRight' : 'ArrowLeft'),
      input: (i) => { if (this.controlling()) this.queue.push(i); },
      timeout: () => this.sendTimeout(), choice: (n) => this.hud.pressChoice(n), pause: () => this.net.send({ t: 'pause' }),
      playbookKey: (e) => this.playbook.key(e),
    }));
    if (opts.dev) {
      this.devPanel = mountDevPanel(this.stage.overlay, {
        bot: { get: () => this.opts.bot, set: (on) => { this.opts.bot = on; } },
        force: (what) => { this.armedForce = what; },
        lowClock: () => this.setLowClock(),
        download: () => this.downloadLastPlay(),
      });
    }
    this.raf = requestAnimationFrame((t) => this.loop(t));
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisible);
    audio.setSong(null);
    audio.setCrowd(true);
    this.stage.root.addEventListener('pointerdown', this.onFirstTap, { once: true });
  }

  /** Fullscreen needs a tap, so it waits for the first one in the match. */
  private onFirstTap = (): void => { if (prefs.fullscreen) applyFullscreen(); };

  private onVisible = (): void => { if (!document.hidden) void this.acquireWakeLock(); };
  private async acquireWakeLock(): Promise<void> {
    try { this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null; } catch { /* optional */ }
  }

  /** The socket came back: anything unconfirmed gets sent again if it's still needed. */
  onReconnected(): void {
    this.handoffSent = false;
    this.resultSent = false;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    void this.wakeLock?.release().catch(() => {});
    document.removeEventListener('visibilitychange', this.onVisible);
    audio.setCrowd(false);
    for (const u of this.unbind) u();
    this.devPanel?.destroy();
    this.playbook.destroy();
    this.hud.destroy();
    this.stage.destroy();
  }

  /** A forced event stays armed until it really happens, since a forced pass can still fall incomplete. A bot is steered into it too. */
  private applyForce(): void {
    const s = this.sim;
    const what = this.armedForce;
    if (!what || !s || !this.controlling()) return;
    const stat = what === 'int' ? 'int' : what === 'fumble' ? 'fumLost' : 'sacks';
    if (s.stats[0][stat] + s.stats[1][stat] > 0) { this.armedForce = null; return; }
    if (s.desc.type !== 'scrimmage' || s.phase !== 'pre' || s.force === what) return;
    s.force = what;
    if (this.opts.bot) {
      this.bot.playId = s.desc.id;
      this.bot.plan = what === 'fumble' ? 'run' : 'pass';
      this.bot.holdUntil = what === 'sack' ? T.dev.forceHoldSack : T.dev.forceHoldInt;
    }
  }

  private setLowClock(): void {
    const m = this.match;
    if (!m) return;
    const clock = T.dev.lowClock;
    if (this.sim) this.sim.clock = clock;
    this.net.send({ t: 'dev', op: 'patch', patch: { clock, play: m.play ? { ...m.play, clock } : m.play } });
  }

  /** Saves the play's frames and state, for bug reports. */
  private downloadLastPlay(): void {
    const data = {
      savedAt: new Date().toISOString(), seat: this.seat, match: this.match, desc: this.desc ?? this.sim?.desc ?? null,
      sim: this.sim, frames: this.pres.replay.frames, tuning: devTuningChanges(), stats: this.stats, log: this.log.slice(-50),
    };
    const text = JSON.stringify(data, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v));
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `borg-bowl-play-${this.match?.playId ?? 0}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  controlling(): boolean { return !!this.sim && (this.opts.local || this.sim.control === this.seat); }

  /** The seat whose choices this screen makes right now. */
  private actingSeat(): Seat | null {
    if (!this.match) return null;
    if (this.opts.local) return this.controllerOf(this.match);
    return this.seat;
  }

  private controllerOf(m: MatchState): Seat {
    if (m.play && (m.phase === 'presnap' || m.phase === 'live')) return m.play.offense;
    if (m.phase === 'kickChoice') return m.kicker;
    return m.possession;
  }

  private isMyDecision(): boolean {
    const m = this.match;
    if (!m) return false;
    if (this.opts.local) return true;
    return this.seat === this.controllerOf(m);
  }

  private sendCall(side: CallSide, id: number): void { if (this.match?.play) this.net.send({ t: 'call', playId: this.match.play.id, side, id }); }
  private sendTimeout(): void { if (this.isMyDecision()) this.net.send({ t: 'timeout' }); }

  // --- Messages --------------------------------------------------------------

  onMsg(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome': this.seat = m.seat; break;
      case 'room': this.room = m.room; break;
      case 'playStart': this.onPlayStart(m.play, m.match, m.pc); break;
      case 'error': if (m.msg === 'dev tools off') this.devPanel?.note('The server refused: its dev tools are off.'); break;
      case 'matchState': this.onMatchState(m); break;
      case 'snap': this.onSnap(m); break;
      case 'handoff': this.onHandoffToMe(m); break;
      case 'yield': this.onYield(m); break;
      case 'continue':
        if (this.sim && this.sim.desc.id === m.playId) { continueWithAutoRunner(this.sim); this.handoffSent = false; this.stats.continues += 1; this.log.push('continue'); }
        break;
      case 'clock': this.playClockEnd = m.pc === null ? null : performance.now() + m.pc; break;
      case 'paused': this.paused = m.by !== null; this.pausedBy = m.by; break;
      case 'waiting': this.waiting = m.on; this.waitingInfo = m; break;
      default: break;
    }
  }

  onFrame(b: ArrayBuffer): void {
    if (this.sim && this.controlling()) return;
    const f = this.buffer.push(b);
    if (f) this.pres.replay.add(f);
    this.stats.framesRecv += 1;
  }

  private setMatch(m: MatchState): void {
    const prev = this.match;
    this.match = m;
    if (!prev) ATLAS.prepare(kitsFor(m));
    this.pres.onMatch(prev, m, this.opts.local ? null : this.seat, this.info, this.frame);
    if (m.phase === 'final') { this.sim = null; this.opts.onFinal(m); }
  }

  private buildInfo(desc: PlayDesc, s: SimState, m: MatchState): SceneInfo {
    const firstDown = desc.type === 'scrimmage' ? desc.los + desc.dir * desc.toGo : null;
    return {
      desc, seats: s.players.map((p) => p.seat), roles: s.players.map((p) => p.role), kits: kitsFor(m),
      routes: routeLines(s),
      firstDownX: firstDown !== null && firstDown > 10 && firstDown < 110 ? firstDown : null,
      aimAlpha: aimFadeAlpha(s, m.config.aimCursor === 'full'), field: this.fieldFor(m),
      ...rosterArt(s, m),
    };
  }

  private fieldFor(m: MatchState): FieldArt {
    const leftSeat: Seat = m.attack[0] > 0 ? 0 : 1;
    const rightSeat: Seat = (1 - leftSeat) as Seat;
    const key = `${m.teams[leftSeat]}:${m.teams[rightSeat]}`;
    let art = this.fieldCache.get(key);
    if (!art) {
      art = buildField({
        left: TEAM_BY_ID[m.teams[leftSeat]], right: TEAM_BY_ID[m.teams[rightSeat]], home: TEAM_BY_ID[m.teams[0]], visitor: TEAM_BY_ID[m.teams[1]],
        weather: m.weather, seed: hashStr(`${m.teams[0]}:${m.teams[1]}`),
      });
      this.fieldCache.set(key, art);
    }
    return art;
  }

  private onPlayStart(play: PlayDesc, m: MatchState, pc: number | null): void {
    this.setMatch(m);
    this.playClockEnd = pc === null ? null : performance.now() + pc;
    this.desc = play;
    const ctx = simContext(m);
    const s = createPlay(play, ctx.teams, ctx.cfg);
    this.info = this.buildInfo(play, s, m);
    frameFromSim(s, this.frame);
    this.hasFrame = true;
    this.live = false;
    this.buffer.reset(play.id);
    this.pres.startPlay();
    this.sentSnap = false;
    this.handoffSent = false;
    this.resultSent = false;
    this.sendEv = 0;
    this.acc = 0;
    this.shadow = null;
    this.gestures.reset();
    this.sim = this.opts.local || play.offense === this.seat ? s : null;
    if (this.sim) this.sim.control = play.offense;
    this.cam.snap(play.los + play.dir * T.view.camLead);
  }

  private onMatchState(m: Extract<ServerMsg, { t: 'matchState' }>): void {
    this.setMatch(m.match);
    this.playClockEnd = m.pc === null ? null : performance.now() + m.pc;
    this.bannerEnd = m.bannerMs === null ? 0 : performance.now() + m.bannerMs;
    if (m.match.phase !== 'live') { this.sim = null; this.shadow = null; this.live = false; this.buffer.markEnded(); }
    else if (m.live) {
      // A rejoin mid-play. A page that kept its sim carries on; otherwise it watches until the play ends.
      this.live = true;
      // The server moved control while this page was away: drop the old sim and watch.
      if (this.sim && !this.opts.local && m.live.controller !== this.seat) { this.sim = null; this.buffer.reset(m.live.playId); }
      if (!this.sim && m.match.play) {
        this.desc = m.match.play;
        const ctx = simContext(m.match);
        const s = createPlay(m.match.play, ctx.teams, ctx.cfg);
        this.info = this.buildInfo(m.match.play, s, m.match);
        this.buffer.reset(m.match.play.id);
      }
      if (this.sim && this.sim.desc.id !== m.live.playId) this.sim = null;
    }
  }

  private onSnap(m: Extract<ServerMsg, { t: 'snap' }>): void {
    if (this.match && this.match.phase === 'presnap') this.match = applySnap(this.match);
    if (this.match) this.match.clock = m.clock;
    this.playClockEnd = null;
    this.live = true;
    this.stats.snaps += 1;
    if (this.sim && this.sim.desc.id === m.playId && (this.sim.phase === 'pre' || this.sim.phase === 'kickPower')) {
      this.sim.clock = m.clock;
      this.queue.push({ k: 'snap' });
      this.sentSnap = true;
    }
  }

  private onHandoffToMe(m: Extract<ServerMsg, { t: 'handoff' }>): void {
    this.stats.handoffs += 1;
    this.log.push(`handoff:${m.reason}`);
    const s = m.state;
    acceptHandoff(s);
    this.sim = s;
    this.shadow = null;
    this.handoffSent = false;
    this.resultSent = false;
    this.sendEv = 0;
    this.acc = 0;
    this.sentSnap = true;
    this.gestures.reset();
    frameFromSim(s, this.frame);
    this.hasFrame = true;
    if (m.reason === 'kick') { this.holdUntil = 0; return; }
    // Freeze for a moment, then the runner keeps moving with no input needed.
    this.holdUntil = performance.now() + T.timers.handoffBanner / this.opts.speed;
    this.turnBanner = 'YOUR BALL!';
    this.turnBannerEnd = this.holdUntil;
    audio.play('confirm');
    if (navigator.vibrate) { try { navigator.vibrate(120); } catch { /* optional */ } }
  }

  private onYield(m: Extract<ServerMsg, { t: 'yield' }>): void {
    this.stats.yields += 1;
    this.log.push(`yield:${m.reason}`);
    // A kick has no freeze: this page keeps flying the ball until the receiver's frames catch up.
    this.shadow = m.reason === 'kick' ? this.sim : null;
    if (this.shadow) this.shadow.handoff = null;
    this.sim = null;
    this.handoffSent = false;
    this.buffer.reset(m.playId);
    this.showTurnover(m.reason, performance.now());
  }

  private showTurnover(reason: HandoffReason, now: number): void {
    if (reason === 'kick') return;
    if (this.turnBannerEnd > now) return;
    this.turnBanner = reason === 'int' ? 'INTERCEPTED!' : reason === 'fumble' ? 'FUMBLE LOST!' : 'ONSIDE RECOVERED!';
    this.turnBannerEnd = now + T.timers.handoffBanner / this.opts.speed;
  }

  // --- The loop --------------------------------------------------------------

  private loop(now: number): void {
    const dtMs = this.lastNow ? Math.min(100, now - this.lastNow) : 16;
    this.lastNow = now;
    this.tick(now, dtMs);
    this.draw(now, dtMs);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private syncGestures(): void {
    const s = this.sim;
    if (!s || !this.controlling()) { this.gestures.ctx = { phase: 'dead', active: false, qb: null }; return; }
    this.gestures.ctx = {
      phase: s.phase, active: !s.frozen && !s.autoRun && !this.opts.bot,
      qb: { x: screenX(s.players[0].x, this.cam.x), y: screenY(s.players[0].y) },
    };
  }

  private tick(now: number, dtMs: number): void {
    this.syncGestures();
    this.gestures.tick(now);
    this.botDecisions(now);
    this.applyForce();
    const s = this.sim;
    if (this.shadow) this.tickShadow(dtMs, now);
    else if (s && this.controlling()) {
      if (this.paused || this.waiting) {
        this.gestures.drain();
        this.queue.length = 0;
      } else if (now >= this.holdUntil && !s.frozen) {
        this.acc += (dtMs / 1000) * this.opts.speed;
        while (this.acc >= DT && !s.frozen && !s.finished) {
          this.acc -= DT;
          const inputs = [...this.gestures.drain(), ...this.queue.splice(0)];
          if (this.opts.bot) inputs.push(...botInputs(s, this.bot, s.control));
          step(s, inputs);
        }
        if (this.acc > DT * 4) this.acc = 0;
      }
      this.afterSteps(s, now);
      frameFromSim(s, this.frame);
      this.hasFrame = true;
    } else if (this.buffer.update(dtMs, this.opts.speed, now)) {
      const o = this.buffer.out;
      this.frame = o;
      this.hasFrame = true;
      if (this.buffer.evPending) { this.pres.onEvents(this.buffer.evPending, o); this.buffer.evPending = 0; }
      this.stats.watcherUnderruns = this.buffer.underruns;
      this.stats.watcherFrames = this.buffer.received;
      this.stats.worstHold = this.buffer.worstHoldMs;
      if (this.match && this.live && o.playId === (this.match.playId & 0xffff)) this.match.clock = o.clock;
    }
    this.syncGestures();
  }

  /** Runs a slowed copy of the kick until the playback from the receiver is ahead of it. */
  private tickShadow(dtMs: number, now: number): void {
    const sh = this.shadow!;
    this.acc += (dtMs / 1000) * this.opts.speed * T.kick.shadowRate;
    while (this.acc >= DT) { this.acc -= DT; if (!sh.finished) step(sh, []); }
    frameFromSim(sh, this.frame);
    this.hasFrame = true;
    if (this.buffer.update(dtMs, this.opts.speed, now) && this.buffer.out.tick >= sh.tick) {
      this.shadow = null;
      this.acc = 0;
      this.frame = this.buffer.out;
    }
  }

  private afterSteps(s: SimState, now: number): void {
    if (!this.sentSnap && s.phase !== 'pre' && s.phase !== 'kickPower') {
      this.sentSnap = true;
      this.live = true;
      this.playClockEnd = null;
      // Same pure step the server runs, so both agree on any clock runoff.
      if (this.match?.phase === 'presnap') { this.match = applySnap(this.match); s.clock = this.match.clock; }
      this.net.send({ t: 'snap', playId: s.desc.id });
    }
    if (s.ev) { frameFromSim(s, this.frame); this.pres.onEvents(s.ev, this.frame); }
    if (s.phase === 'kickPower') { frameFromSim(s, this.frame); this.pres.meterTick(this.frame); }
    this.sendEv |= s.ev;
    s.ev = 0;
    if (this.sentSnap && now - this.lastFrameSent >= T.net.frameMs) {
      this.lastFrameSent = now;
      frameFromSim(s, this.frame);
      this.frame.ev = this.sendEv;
      this.sendEv = 0;
      const bytes = encodeFrame(this.frame);
      this.net.sendFrame(bytes);
      this.pres.replay.add(decodeFrame(bytes));
      this.stats.framesSent += 1;
    }
    if (s.handoff && !this.handoffSent) {
      this.handoffSent = true;
      this.net.send({ t: 'handoff', playId: s.desc.id, state: s, to: s.handoff.to, reason: s.handoff.reason, spotX: s.handoff.spotX });
      this.showTurnover(s.handoff.reason, now);
    }
    // While a handoff is undecided, the server hasn't said whether this page still owns the play.
    if (s.finished && s.result && !this.resultSent && !s.handoff) {
      this.resultSent = true;
      this.stats.plays += 1;
      this.net.send({ t: 'playResult', result: s.result });
    }
  }

  private botDecisions(now: number): void {
    if (!this.opts.bot || !this.match || this.paused || this.waiting) return;
    const m = this.match;
    // A bot has seen enough, and skips replays as a person may.
    if (m.phase === 'replay') {
      if ((this.opts.local || nextController(m) === this.seat) && now >= this.botChoiceAt) { this.botChoiceAt = now + 300; this.net.send({ t: 'skip' }); }
      return;
    }
    if (m.phase === 'huddle') {
      const v = this.huddleView;
      // The bot waits for the panel to show this call, so a pick is never lost while the last call still flashes.
      if (!v || v.mode !== 'call' || !this.playbook.showing(v.key)) return;
      if (this.botCallKey !== v.key) { this.botCallKey = v.key; this.botCallAt = now + (500 + Math.random() * 1300) / this.opts.speed; return; }
      if (now < this.botCallAt) return;
      this.botCallAt = Infinity;
      this.playbook.pick(botCall(v.side, v.suggest, Math.random()));
      return;
    }
    if (m.phase === 'choice4th' || m.phase === 'conversion' || m.phase === 'kickChoice') {
      if (!this.isMyDecision() || now < this.botChoiceAt) return;
      this.botChoiceAt = now + 300;
      const c = botChoice(m, Math.random());
      if (c) this.net.send({ t: 'choice', c });
    }
  }

  // --- Drawing ---------------------------------------------------------------

  private draw(now: number, dtMs: number): void {
    const ctx = this.stage.ctx;
    const m = this.match;
    if (!m) { ctx.fillStyle = '#14202c'; ctx.fillRect(0, 0, 640, 360); return; }
    const replay = m.phase === 'replay' ? this.pres.replay.update(dtMs * this.opts.speed) : null;
    const f = replay ?? this.frame;
    this.pres.update(dtMs / 1000, m, f, now);
    const info = this.info ?? this.placeholderInfo(m);
    info.field = this.fieldFor(m);
    const camTarget = (this.hasFrame ? f.bx : m.ballX) + (m.attack[m.possession] ?? 1) * T.view.camLead;
    this.cam.follow(camTarget, dtMs / 1000);
    if (!this.controlling()) info.aimAlpha = 1;
    if (this.hasFrame && this.info) {
      drawScene(ctx, f, info, this.cam.x, this.pres.sceneOpts(m, info, f, now));
      this.pres.fx.drawWorld(ctx, this.cam.x);
    } else drawField(ctx, info.field, this.cam.x);
    drawWeather(ctx, m.weather, now);
    const live = this.sim && this.sim.phase !== 'pre' ? this.sim.clock : m.clock;
    const pc = this.playClockEnd === null ? null : Math.max(0, (this.playClockEnd - now) / 1000);
    // The huddle has its own timer on the playbook.
    drawHud(ctx, m, this.hasFrame && this.frame.phase !== 'pre' && m.phase === 'live' ? this.frame.clock : live, m.phase === 'huddle' ? null : pc, this.opts.local ? null : this.seat);
    if (this.hasFrame && this.info) drawBallOverHud(ctx, f, this.cam.x);
    this.drawOverlays(ctx, m, now);
    if (replay) this.drawReplayFrame(ctx, now);
    this.pres.fx.drawScreen(ctx);
    this.huddleView = this.viewHuddle(m, now);
    this.playbook.show(this.huddleView, now);
    const acting = this.actingSeat();
    this.hud.update(m, acting, this.isMyDecision(), this.paused, this.waiting);
    this.hud.setSkip(m.phase === 'replay' && (this.opts.local || nextController(m) === this.seat));
    this.hud.setStatus(this.statusText(m));
    this.hud.setClaim(!this.opts.local && m.phase !== 'final' && this.waitingInfo?.canClaim === this.seat && this.seat !== null);
  }

  private drawReplayFrame(ctx: CanvasRenderingContext2D, now: number): void {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 344, 640, 16);
    ctx.fillRect(4, 4, 120, 22);
    if (Math.floor(now / 500) % 2 === 0) { ctx.fillStyle = '#ff3b30'; ctx.fillRect(10, 10, 10, 10); }
    drawText(ctx, 'REPLAY', 26, 8, '#fff', 2);
  }

  private placeholderInfo(m: MatchState): SceneInfo {
    const desc: PlayDesc = { id: 0, type: 'kickoff', seed: 0, offense: 0, dir: 1, los: m.ballX, down: 1, toGo: 10, playbook: 0, defense: 0, clock: m.clock };
    return { desc, seats: [], roles: [], slots: [], kits: kitsFor(m), routes: [], firstDownX: null, aimAlpha: 1, field: this.fieldFor(m), skins: [], stars: [], names: [] };
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, m: MatchState, now: number): void {
    const mine = this.isMyDecision();
    let bottom = '';
    const sim = this.sim;
    if (m.phase === 'coinToss') {
      const name = TEAM_BY_ID[m.teams[m.coinWinner]].nick.toUpperCase();
      drawBanner(ctx, 'COIN TOSS', 'quarter', `${name} WIN THE TOSS AND RECEIVE`, null, 1000);
    } else if (m.phase === 'banner' && m.banner) {
      const scoring = m.banner.kind === 'touchdown' || m.banner.kind === 'score';
      const team = scoring && m.last ? m.teams[m.last.possessor] : null;
      const sub = team ? TEAM_BY_ID[team].nick.toUpperCase() : '';
      drawBanner(ctx, m.banner.text, m.banner.kind, sub, team, this.pres.bannerAge(now));
      if (m.banner.kind === 'half') drawScoreboard(ctx, m);
    } else if (sim && this.controlling()) {
      if (sim.phase === 'pre') bottom = snapHint(sim);
      else if (sim.phase === 'kickPower') bottom = 'TAP IN THE GREEN FOR POWER';
      else if (sim.phase === 'kickAim') bottom = 'TAP AS THE ARROW CROSSES THE MIDDLE';
      else if (sim.phase === 'pocket') bottom = sim.aim.on ? 'RELEASE TO THROW' : 'DRAG BACK TO AIM';
      else if (sim.ezWait > 0) bottom = 'TAP TO RUN IT OUT';
    } else if (!this.opts.local && m.phase !== 'choice4th' && m.phase !== 'conversion' && m.phase !== 'kickChoice' && m.phase !== 'final' && m.phase !== 'replay' && !mine) {
      if (m.phase !== 'huddle') bottom = `WATCHING: ${TEAM_BY_ID[m.teams[this.controllerOf(m)]].id} ON OFFENSE`;
    }
    // The line on the last play runs until the huddle: by the time a play from scrimmage lines up, it's old news.
    const c = this.pres.commentary;
    const huddled = m.phase === 'huddle' || (m.phase === 'presnap' && m.play?.type === 'scrimmage');
    if (c && !huddled && m.phase !== 'live' && m.phase !== 'coinToss' && m.phase !== 'final' && m.phase !== 'banner' && m.phase !== 'replay' && m.last) {
      const team = TEAM_BY_ID[m.teams[m.last.possessor]];
      drawStrip(ctx, c, 320, 74, lum(team.primary) > 0.62 ? '#14181c' : '#fff', textWidth(c, 2) <= 620 ? 2 : 1, team.primary);
    }
    if (bottom) {
      // A long hint sits higher, clear of the buttons in the bottom corners. A short one goes on the
      // grass under the near sideline, so it never covers anyone on the field.
      const wide = textWidth(bottom, 2) > 360;
      drawStrip(ctx, bottom, 320, wide ? 318 : screenY(T.field.width) + 10, '#fff', 2);
    }
    const f = this.frame;
    // The last frame can still be a kick once a banner is up, so the meter only shows while a kick is being taken.
    this.meterShown = this.hasFrame && (f.phase === 'kickPower' || f.phase === 'kickAim') && (m.phase === 'presnap' || m.phase === 'live');
    if (this.meterShown) drawKickMeter(ctx, f);
    if (now < this.turnBannerEnd) drawStrip(ctx, this.turnBanner, 320, 140, '#ffd23f', 3);
  }

  /** What the playbook shows on this screen: a call to make, a call made, or the other side calling. */
  private viewHuddle(m: MatchState, now: number): PlaybookView | null {
    const h = m.huddle;
    const play = m.play;
    if (m.phase !== 'huddle' || !h || !play || this.paused || this.waiting) return null;
    const deadline = this.playClockEnd ?? now;
    const total = T.timers.huddle;
    const off = play.offense;
    const seatOf = (side: CallSide): Seat => (side === 'off' ? off : (1 - off) as Seat);
    const base = `${play.id}:${m.timeouts[0]}:${m.timeouts[1]}`;
    let side: CallSide | null = null;
    // One screen calls both sides in turn, offense first. Online, each screen calls its own.
    if (this.opts.local) side = h.calls[0] === -1 ? 'off' : h.calls[1] === -1 && !h.computer ? 'def' : null;
    else if (this.seat !== null) side = callerOf(m, 'off') === this.seat ? 'off' : callerOf(m, 'def') === this.seat ? 'def' : null;
    if (side) {
      const i = side === 'off' ? 0 : 1;
      const team = m.teams[seatOf(side)];
      const situation = play.type === 'twoPoint' ? 'TWO-POINT TRY' : `${downText(m)}  ${spotText(m)}`;
      const c = m.last?.call;
      const last = c ? `LAST: ${PLAYBOOK[c[0]]?.name ?? ''} VS ${DEF_CALLS[c[1]]?.name ?? ''}` : '';
      if (h.calls[i] === -1 && h.suggest[i] >= 0) return { mode: 'call', key: `${base}:${side}:call`, side, team, suggest: h.suggest[i], situation, last, deadline, total, keys: this.keys };
      if (h.calls[i] >= 0) return { mode: 'locked', key: `${base}:${side}:locked`, side, team, id: h.calls[i], situation, last, deadline, total, waitingFor: side === 'off' ? 'THE DEFENSE IS CALLING' : 'THE OFFENSE IS CALLING' };
    }
    const calling = TEAM_BY_ID[m.teams[off]].id;
    return { mode: 'watch', key: `${base}:watch`, text: `${calling} IN THE HUDDLE`, deadline, total };
  }

  private statusText(m: MatchState): string {
    if (this.paused) return `PAUSED${this.pausedBy === this.seat ? '. Tap > to resume' : ''}`;
    if (this.waiting || (this.waitingInfo && this.waitingInfo.missing.some(Boolean) && m.phase !== 'final')) {
      const w = this.waitingInfo;
      if (w?.canClaim === this.seat) return 'Your rival has not come back. Keep waiting, or claim the win.';
      if (w && !this.opts.local) {
        const rival = this.seat === null ? 0 : (1 - this.seat) as Seat;
        const left = w.left[rival];
        return left === null ? 'Waiting for your rival...' : 'Waiting for your rival to reconnect...';
      }
    }
    return '';
  }

  phaseForTests(): SimPhase | null { return this.sim?.phase ?? null; }
}
