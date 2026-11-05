// The match on this device: runs the sim when this player has the ball, plays frames otherwise.
import { encodeFrame, emptyFrame, frameFromSim, type Frame, type RoomView, type ServerMsg } from '../../shared/protocol';
import { TEAM_BY_ID } from '../../shared/data/teams';
import { botChoice } from '../../shared/rules/coach';
import { applySnap, simContext, type MatchState } from '../../shared/rules/match';
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
import { buildField, type FieldArt } from '../render/field';
import { drawStrip } from '../render/font';
import { drawHud } from '../render/hud';
import { drawScene, type Kit, type SceneInfo } from '../render/scene';
import { Stage } from '../render/stage';
import { Camera, screenX, screenY } from '../render/view';
import { HudOverlay } from '../ui/hud';

export interface SessionOpts {
  local: boolean; bot: boolean; speed: number; dev: boolean;
  /** Called when the match reaches its final state. */
  onFinal(m: MatchState): void;
}

const WHITE = '#f4f4ee';

export function kitsFor(m: MatchState): [Kit, Kit] {
  const kit = (seat: Seat): Kit => {
    const t = TEAM_BY_ID[m.teams[seat]];
    if (m.away[seat]) return { helmet: t.primary, jersey: WHITE, trim: t.primary, pants: t.primary };
    return { helmet: t.secondary, jersey: t.primary, trim: t.secondary, pants: WHITE };
  };
  return [kit(0), kit(1)];
}

export class Session {
  stage: Stage;
  hud: HudOverlay;
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
  commentary = '';
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
  private wakeLock: WakeLockSentinel | null = null;

  constructor(parent: HTMLElement, public net: NetLike, public opts: SessionOpts) {
    this.stage = new Stage(parent);
    this.bot = newBot(Math.floor(Math.random() * 1e9));
    this.hud = new HudOverlay(this.stage.overlay, {
      audible: () => this.sendAudible(), timeout: () => this.sendTimeout(), pause: () => this.net.send({ t: 'pause' }),
      choice: (c) => this.net.send({ t: 'choice', c }), concede: () => this.net.send({ t: 'concede' }),
      claim: () => this.net.send({ t: 'claimWin' }), skip: () => this.net.send({ t: 'skip' }),
    });
    this.unbind.push(bindPointer(this.stage, this.gestures));
    this.unbind.push(bindKeyboard({
      phase: () => (this.controlling() ? this.sim!.phase : null),
      forwardKey: () => (this.sim && dirOf(this.sim, this.sim.possessor) > 0 ? 'ArrowRight' : 'ArrowLeft'),
      input: (i) => { if (this.controlling()) this.queue.push(i); },
      audible: () => this.sendAudible(), timeout: () => this.sendTimeout(), choice: (n) => this.hud.pressChoice(n), pause: () => this.net.send({ t: 'pause' }),
    }));
    this.raf = requestAnimationFrame((t) => this.loop(t));
    void this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.onVisible);
  }

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
    for (const u of this.unbind) u();
    this.hud.destroy();
    this.stage.destroy();
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

  private sendAudible(): void { if (this.match?.play && this.isMyDecision()) this.net.send({ t: 'audible', playId: this.match.play.id }); }
  private sendTimeout(): void { if (this.isMyDecision()) this.net.send({ t: 'timeout' }); }

  // --- Messages --------------------------------------------------------------

  onMsg(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome': this.seat = m.seat; break;
      case 'room': this.room = m.room; break;
      case 'playStart': this.onPlayStart(m.play, m.match, m.pc); break;
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
    this.buffer.push(b);
    this.stats.framesRecv += 1;
  }

  private setMatch(m: MatchState): void {
    const prev = this.match;
    this.match = m;
    if (m.last && (!prev?.last || prev.playId !== m.playId)) this.commentary = this.describe(m);
    if (m.phase === 'final') { this.sim = null; this.opts.onFinal(m); }
  }

  private describe(m: MatchState): string {
    const l = m.last;
    if (!l) return '';
    if (l.note) return l.note;
    if (l.safety) return 'SAFETY!';
    if (l.end === 'td') return l.turnover ? 'RETURNED FOR A TOUCHDOWN!' : 'TOUCHDOWN!';
    if (l.end === 'fgGood') return 'THE KICK IS GOOD!';
    if (l.end === 'fgMiss') return 'NO GOOD!';
    if (l.end === 'xpGood') return 'EXTRA POINT IS GOOD';
    if (l.end === 'xpMiss') return 'EXTRA POINT NO GOOD';
    if (l.turnoverOnDowns) return 'TURNOVER ON DOWNS';
    if (l.end === 'incomplete') return 'INCOMPLETE';
    if (l.end === 'pi') return 'PASS INTERFERENCE. AUTOMATIC FIRST DOWN';
    if (l.touchback) return 'TOUCHBACK';
    if (l.sack) return `SACKED FOR ${Math.abs(l.yards)}`;
    if (l.firstDown) return `FIRST DOWN! GAIN OF ${l.yards}`;
    return l.yards >= 0 ? `GAIN OF ${l.yards}` : `LOSS OF ${-l.yards}`;
  }

  private buildInfo(desc: PlayDesc, s: SimState, m: MatchState): SceneInfo {
    const firstDown = desc.type === 'scrimmage' ? desc.los + desc.dir * desc.toGo : null;
    return {
      desc, seats: s.players.map((p) => p.seat), roles: s.players.map((p) => p.role), kits: kitsFor(m),
      routes: s.players.filter((p) => p.route && (p.job === 'route' || p.job === 'mesh')).map((p) => ({ i: p.i, pts: p.route! })),
      firstDownX: firstDown !== null && firstDown > 10 && firstDown < 110 ? firstDown : null,
      aimAlpha: aimFadeAlpha(s, m.config.aimCursor === 'full'), field: this.fieldFor(m),
    };
  }

  private fieldFor(m: MatchState): FieldArt {
    const leftSeat: Seat = m.attack[0] > 0 ? 0 : 1;
    const rightSeat: Seat = (1 - leftSeat) as Seat;
    const key = `${m.teams[leftSeat]}:${m.teams[rightSeat]}`;
    let art = this.fieldCache.get(key);
    if (!art) {
      const l = TEAM_BY_ID[m.teams[leftSeat]];
      const r = TEAM_BY_ID[m.teams[rightSeat]];
      art = buildField({ leftColor: l.primary, rightColor: r.primary, leftName: l.nick, rightName: r.nick, trimLeft: l.secondary, trimRight: r.secondary });
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
    this.sentSnap = false;
    this.handoffSent = false;
    this.resultSent = false;
    this.sendEv = 0;
    this.acc = 0;
    this.gestures.reset();
    this.sim = this.opts.local || play.offense === this.seat ? s : null;
    if (this.sim) this.sim.control = play.offense;
    this.cam.snap(play.los + play.dir * T.view.camLead);
  }

  private onMatchState(m: Extract<ServerMsg, { t: 'matchState' }>): void {
    this.setMatch(m.match);
    this.playClockEnd = m.pc === null ? null : performance.now() + m.pc;
    this.bannerEnd = m.bannerMs === null ? 0 : performance.now() + m.bannerMs;
    if (m.match.phase !== 'live') { this.sim = null; this.live = false; }
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
    if (this.sim && this.sim.desc.id === m.playId && this.sim.phase === 'pre') {
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
    this.handoffSent = false;
    this.resultSent = false;
    this.sendEv = 0;
    this.acc = 0;
    this.sentSnap = true;
    this.gestures.reset();
    frameFromSim(s, this.frame);
    this.hasFrame = true;
    if (m.reason === 'kick') return;
    // Freeze for a moment, then the runner keeps moving with no input needed.
    this.holdUntil = performance.now() + T.timers.handoffBanner / this.opts.speed;
    this.turnBanner = 'YOUR BALL!';
    this.turnBannerEnd = this.holdUntil;
    if (navigator.vibrate) { try { navigator.vibrate(120); } catch { /* optional */ } }
  }

  private onYield(m: Extract<ServerMsg, { t: 'yield' }>): void {
    this.stats.yields += 1;
    this.log.push(`yield:${m.reason}`);
    this.sim = null;
    this.handoffSent = false;
    this.buffer.reset(m.playId);
    if (m.reason !== 'kick') {
      this.turnBanner = m.reason === 'int' ? 'INTERCEPTED!' : 'FUMBLE LOST!';
      this.turnBannerEnd = performance.now() + T.timers.handoffBanner / this.opts.speed;
    }
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
    if (!s || !this.controlling()) { this.gestures.ctx = { phase: 'dead', active: false, qb: null, rb: null, handoffOpen: false }; return; }
    this.gestures.ctx = {
      phase: s.phase, active: !s.frozen && !s.autoRun && !this.opts.bot, handoffOpen: s.phase === 'pocket' && s.phaseT <= T.pocket.handoffWindow,
      qb: { x: screenX(s.players[0].x, this.cam.x), y: screenY(s.players[0].y) },
      rb: { x: screenX(s.players[1].x, this.cam.x), y: screenY(s.players[1].y) },
    };
  }

  private tick(now: number, dtMs: number): void {
    this.syncGestures();
    this.gestures.tick(now);
    this.botDecisions(now);
    const s = this.sim;
    if (s && this.controlling()) {
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
      this.stats.watcherUnderruns = this.buffer.underruns;
      this.stats.watcherFrames = this.buffer.received;
      this.stats.worstHold = this.buffer.worstHoldMs;
      if (this.match && this.live && o.playId === (this.match.playId & 0xffff)) this.match.clock = o.clock;
    }
    this.syncGestures();
  }

  private afterSteps(s: SimState, now: number): void {
    if (!this.sentSnap && s.phase !== 'pre') {
      this.sentSnap = true;
      this.live = true;
      this.playClockEnd = null;
      // Same pure step the server runs, so both agree on any clock runoff.
      if (this.match?.phase === 'presnap') { this.match = applySnap(this.match); s.clock = this.match.clock; }
      this.net.send({ t: 'snap', playId: s.desc.id });
    }
    this.sendEv |= s.ev;
    s.ev = 0;
    if (s.phase !== 'pre' && now - this.lastFrameSent >= T.net.frameMs) {
      this.lastFrameSent = now;
      frameFromSim(s, this.frame);
      this.frame.ev = this.sendEv;
      this.sendEv = 0;
      this.net.sendFrame(encodeFrame(this.frame));
      this.stats.framesSent += 1;
    }
    if (s.frozen && s.handoff && !this.handoffSent) {
      this.handoffSent = true;
      this.net.send({ t: 'handoff', playId: s.desc.id, state: s, to: s.handoff.to, reason: s.handoff.reason, spotX: s.handoff.spotX });
      if (s.handoff.reason !== 'kick') {
        this.turnBanner = s.handoff.reason === 'int' ? 'INTERCEPTED!' : 'FUMBLE LOST!';
        this.turnBannerEnd = now + T.timers.handoffBanner / this.opts.speed;
      }
    }
    if (s.finished && s.result && !this.resultSent) {
      this.resultSent = true;
      this.stats.plays += 1;
      this.net.send({ t: 'playResult', result: s.result });
    }
  }

  private botDecisions(now: number): void {
    if (!this.opts.bot || !this.match || this.paused || this.waiting) return;
    const m = this.match;
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
    const f = this.frame;
    const info = this.info ?? this.placeholderInfo(m);
    info.field = this.fieldFor(m);
    const camTarget = (this.hasFrame ? f.bx : m.ballX) + (m.attack[m.possession] ?? 1) * T.view.camLead;
    this.cam.follow(camTarget, dtMs / 1000);
    if (!this.controlling()) info.aimAlpha = 1;
    if (this.hasFrame && this.info) drawScene(ctx, f, info, this.cam.x);
    else { ctx.drawImage(info.field.canvas, Math.round(-(this.cam.x * (640 / 48) + 6 * (640 / 48) - 320)), 0); }
    const live = this.sim && this.sim.phase !== 'pre' ? this.sim.clock : m.clock;
    const pc = this.playClockEnd === null ? null : Math.max(0, (this.playClockEnd - now) / 1000);
    drawHud(ctx, m, this.hasFrame && this.frame.phase !== 'pre' && m.phase === 'live' ? this.frame.clock : live, pc, this.opts.local ? null : this.seat);
    this.drawOverlays(ctx, m, now);
    const acting = this.actingSeat();
    this.hud.update(m, acting, this.isMyDecision(), this.paused, this.waiting);
    this.hud.setStatus(this.statusText(m));
    this.hud.setClaim(!this.opts.local && m.phase !== 'final' && this.waitingInfo?.canClaim === this.seat && this.seat !== null);
  }

  private placeholderInfo(m: MatchState): SceneInfo {
    const desc: PlayDesc = { id: 0, type: 'kickoff', seed: 0, offense: 0, dir: 1, los: m.ballX, down: 1, toGo: 10, playbook: 0, clock: m.clock };
    return { desc, seats: [], roles: [], kits: kitsFor(m), routes: [], firstDownX: null, aimAlpha: 1, field: this.fieldFor(m) };
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, m: MatchState, now: number): void {
    const mine = this.isMyDecision();
    let bottom = '';
    const sim = this.sim;
    if (m.phase === 'coinToss') {
      const name = TEAM_BY_ID[m.teams[m.coinWinner]].nick.toUpperCase();
      drawStrip(ctx, 'COIN TOSS', 320, 130, '#ffd23f', 2);
      drawStrip(ctx, `${name} WIN THE TOSS AND RECEIVE`, 320, 170);
    } else if (m.phase === 'banner' && m.banner) {
      drawStrip(ctx, m.banner.text, 320, 140, '#ffd23f', 2);
    } else if (m.phase === 'final') {
      drawStrip(ctx, 'FINAL', 320, 140, '#ffd23f', 2);
    } else if (sim && this.controlling()) {
      if (sim.phase === 'pre') bottom = sim.desc.type === 'scrimmage' || sim.desc.type === 'twoPoint' ? 'TAP TO SNAP. TAP THE RB TO HAND OFF, THE QB TO RUN' : 'TAP TO KICK';
      else if (sim.phase === 'pocket') bottom = sim.aim.on ? 'RELEASE TO THROW' : 'DRAG BACK TO AIM';
      else if (sim.ezWait > 0) bottom = 'TAP TO RUN IT OUT';
    } else if (!this.opts.local && m.phase !== 'choice4th' && m.phase !== 'conversion' && m.phase !== 'kickChoice' && !mine) {
      bottom = `WATCHING: ${TEAM_BY_ID[m.teams[this.controllerOf(m)]].id} ON OFFENSE`;
    }
    if (this.commentary && m.phase !== 'live' && m.phase !== 'coinToss' && m.phase !== 'final') {
      const col = m.last ? TEAM_BY_ID[m.teams[m.last.possessor]].primary : '#000';
      drawStrip(ctx, this.commentary, 320, 26, '#fff', 1, col);
    }
    if (bottom) drawStrip(ctx, bottom, 320, 340);
    if (now < this.turnBannerEnd) drawStrip(ctx, this.turnBanner, 320, 140, '#ffd23f', 3);
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
