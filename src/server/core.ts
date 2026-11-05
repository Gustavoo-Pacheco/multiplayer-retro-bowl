// Room logic with no Cloudflare imports. The Durable Object in room.ts is a thin
// adapter around it, so the same code can run in tests and in one-device games.
import { DEFAULT_CONFIG, isValidConfigPatch, type MatchConfig } from '../shared/data/config';
import { TEAM_BY_ID } from '../shared/data/teams';
import type { ClientMsg, ErrorCode, RoomView, Seat, ServerMsg } from '../shared/protocol';
import {
  advanceBanner, afterCoinToss, applyAudible, applyChoice, applyResult, applySnap, applyTimeout, autoKickResult, canAudible, canTimeout, concede, createMatch, currentController,
  defaultChoice, isChoiceLegal, isResultValid, voidPlay, type MatchState,
} from '../shared/rules/match';
import { emptyStats, isKickType, type PlayEnd, type PlayResult } from '../shared/sim/state';
import { T } from '../shared/sim/tuning';

export interface Conn {
  seat: Seat | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  /** Rate-limit counters. In memory only. */
  win?: number;
  count?: number;
}

export interface RoomHost {
  conns(): Conn[];
  now(): number;
  save(json: string): void;
  load(): string | null;
  wipe(): void;
  setAlarm(at: number | null): void;
  random(): number;
  token(): string;
  /** Debug tools are only available when this is set. */
  devTools: boolean;
  restart?(): void;
}

interface SeatRec { token: string; nick: string; online: boolean; visible: boolean; team: string | null; ready: boolean }

interface Live { playId: number; controller: Seat; handoff: { spotX: number; to: Seat; reason: string } | null }

interface Deadlines {
  playClock: number | null; banner: number | null; pause: number | null;
  reconnect: [number | null, number | null]; watchdog: number | null;
}

export interface RoomData {
  code: string;
  seats: [SeatRec | null, SeatRec | null];
  config: MatchConfig;
  screen: 'lobby' | 'match';
  match: MatchState | null;
  snapshot: MatchState | null;
  live: Live | null;
  dl: Deadlines;
  pausedBy: Seat | null;
  waiting: boolean;
  canClaim: Seat | null;
  lastActivity: number;
}

const SEATS: Seat[] = [0, 1];
const other = (s: Seat): Seat => (1 - s) as Seat;
const CHOICE_PHASES = new Set(['presnap', 'choice4th', 'conversion', 'kickChoice']);

export class RoomCore {
  data: RoomData | null = null;
  private lastFrameAt = 0;

  constructor(private host: RoomHost, private code: string) {
    const raw = host.load();
    if (raw) this.data = JSON.parse(raw) as RoomData;
    if (this.data) {
      this.syncOnline();
      // Memory was lost. Any play in progress can no longer be trusted, so it's voided.
      if (this.data.live) this.voidOrSettle();
      else this.persist();
    }
  }

  private syncOnline(): void {
    const d = this.data!;
    const live: [boolean, boolean] = [false, false];
    for (const c of this.host.conns()) if (c.seat !== null) live[c.seat] = true;
    const now = this.host.now();
    for (const s of SEATS) {
      const r = d.seats[s];
      if (!r) continue;
      r.online = live[s];
      if (!live[s]) r.visible = true;
      if (!live[s] && d.screen === 'match' && d.match?.phase !== 'final' && d.dl.reconnect[s] === null) d.dl.reconnect[s] = now + d.config.reconnect * 60000;
    }
    this.lastFrameAt = now;
  }

  // --- Saving and timers -----------------------------------------------------

  private persist(): void {
    const d = this.data;
    if (!d) return;
    d.lastActivity = this.host.now();
    this.host.save(JSON.stringify(d));
    this.updateAlarm();
  }

  private updateAlarm(): void {
    const d = this.data;
    if (!d) return;
    const times = [d.dl.playClock, d.dl.banner, d.dl.pause, d.dl.reconnect[0], d.dl.reconnect[1], d.dl.watchdog, d.lastActivity + T.timers.cleanup]
      .filter((x): x is number => x !== null);
    this.host.setAlarm(Math.min(...times));
  }

  onAlarm(): void {
    const d = this.data;
    if (!d) return;
    const now = this.host.now();
    if (d.dl.watchdog !== null && now >= d.dl.watchdog) {
      if (d.live && now - this.lastFrameAt >= T.timers.watchdog) this.voidOrSettle();
      else d.dl.watchdog = d.live ? now + T.timers.watchdogTick : null;
    }
    if (d.dl.reconnect[0] !== null && now >= d.dl.reconnect[0]) this.reconnectExpired(0);
    if (d.dl.reconnect[1] !== null && now >= d.dl.reconnect[1]) this.reconnectExpired(1);
    if (d.dl.pause !== null && now >= d.dl.pause) this.resume();
    if (d.dl.playClock !== null && now >= d.dl.playClock) this.playClockExpired();
    if (d.dl.banner !== null && now >= d.dl.banner) this.bannerDone();
    if (this.data && now - this.data.lastActivity >= T.timers.cleanup) {
      for (const c of this.host.conns()) c.close(4010, 'expired');
      this.data = null;
      this.host.wipe();
      return;
    }
    this.updateAlarm();
  }

  // --- Sending ---------------------------------------------------------------

  private view(): RoomView {
    const d = this.data!;
    const seat = (r: SeatRec | null) => (r ? { nick: r.nick, online: r.online, visible: r.visible, team: r.team, ready: r.ready } : null);
    return { code: d.code, seats: [seat(d.seats[0]), seat(d.seats[1])], config: d.config, screen: d.screen };
  }

  private sendTo(c: Conn, m: ServerMsg): void { c.send(JSON.stringify(m)); }
  private sendSeat(seat: Seat, m: ServerMsg): void {
    const s = JSON.stringify(m);
    for (const c of this.host.conns()) if (c.seat === seat) c.send(s);
  }
  private broadcast(m: ServerMsg): void {
    const s = JSON.stringify(m);
    for (const c of this.host.conns()) if (c.seat !== null) c.send(s);
  }
  private err(c: Conn, code: ErrorCode, msg?: string): void { this.sendTo(c, { t: 'error', code, msg }); }
  private sendRoom(): void { this.broadcast({ t: 'room', room: this.view() }); }

  private pcLeft(): number | null {
    const d = this.data!;
    return d.dl.playClock === null ? null : Math.max(0, d.dl.playClock - this.host.now());
  }

  private matchMsg(): ServerMsg {
    const d = this.data!;
    const bannerMs = d.dl.banner === null ? null : Math.max(0, d.dl.banner - this.host.now());
    return { t: 'matchState', match: d.match!, pc: this.pcLeft(), live: d.live ? { playId: d.live.playId, controller: d.live.controller } : null, bannerMs };
  }

  private waitingMsg(): ServerMsg {
    const d = this.data!;
    const now = this.host.now();
    const missing: [boolean, boolean] = [!this.present(0), !this.present(1)];
    const left: [number | null, number | null] = [
      d.dl.reconnect[0] === null ? null : Math.max(0, d.dl.reconnect[0] - now),
      d.dl.reconnect[1] === null ? null : Math.max(0, d.dl.reconnect[1] - now),
    ];
    return { t: 'waiting', on: d.waiting, missing, left, canClaim: d.canClaim };
  }

  // --- Presence --------------------------------------------------------------

  private present(seat: Seat): boolean {
    const r = this.data!.seats[seat];
    return !!r && r.online && r.visible;
  }

  private presenceChanged(seat: Seat): void {
    const d = this.data!;
    const here = this.present(seat);
    if (d.screen !== 'match' || !d.match || d.match.phase === 'final') {
      d.dl.reconnect[seat] = null;
      if (here && d.canClaim === other(seat)) d.canClaim = null;
      return;
    }
    if (here) {
      d.dl.reconnect[seat] = null;
      if (d.canClaim === other(seat)) d.canClaim = null;
      if (d.waiting && this.present(0) && this.present(1)) this.enterState();
      else if (d.waiting) this.broadcast(this.waitingMsg());
    } else {
      if (d.dl.reconnect[seat] === null) d.dl.reconnect[seat] = this.host.now() + d.config.reconnect * 60000;
      // A dead ball waits, with the clocks stopped.
      if (!d.live && CHOICE_PHASES.has(d.match.phase) && d.pausedBy === null) {
        d.dl.playClock = null;
        d.waiting = true;
      }
      this.broadcast(this.waitingMsg());
    }
  }

  private reconnectExpired(seat: Seat): void {
    const d = this.data!;
    d.dl.reconnect[seat] = null;
    if (this.present(seat)) return;
    d.canClaim = other(seat);
    this.broadcast(this.waitingMsg());
  }

  // --- Match flow ------------------------------------------------------------

  /** Runs after every change of phase: sets timers, tells both players, and saves. */
  private enterState(): void {
    const d = this.data!;
    let m = d.match!;
    d.dl.playClock = null;
    d.dl.banner = null;
    d.dl.watchdog = null;
    d.live = null;
    d.snapshot = null;
    // Temporary automatic kicks, until M5 adds real ones.
    while (m.phase === 'presnap' && m.play && isKickType(m.play.type)) {
      m = applyResult(applySnap(m), autoKickResult(m));
    }
    d.match = m;
    if (m.phase === 'final') { d.waiting = false; d.canClaim = null; d.dl.reconnect = [null, null]; }
    else if (CHOICE_PHASES.has(m.phase) && !(this.present(0) && this.present(1))) {
      d.waiting = true;
      this.broadcast(this.matchMsg());
      this.broadcast(this.waitingMsg());
      this.persist();
      return;
    }
    d.waiting = false;
    const t = T.timers;
    switch (m.phase) {
      case 'coinToss': d.dl.banner = this.host.now() + t.coinToss; break;
      case 'banner': {
        const kind = m.banner?.kind;
        d.dl.banner = this.host.now() + (kind === 'half' ? t.halftime : kind === 'quarter' ? t.quarterBreak : kind === 'twoMin' ? t.twoMinute : t.banner);
        break;
      }
      case 'replay': d.dl.banner = this.host.now() + t.replay; break;
      case 'presnap': case 'choice4th': case 'conversion': case 'kickChoice':
        d.dl.playClock = this.host.now() + m.config.playClock * 1000;
        break;
      default: break;
    }
    if (m.phase === 'presnap' && m.play) this.broadcast({ t: 'playStart', play: m.play, match: m, pc: this.pcLeft() });
    else this.broadcast(this.matchMsg());
    this.broadcast(this.waitingMsg());
    this.persist();
  }

  private beginLive(auto: boolean, sender: Seat | null): void {
    const d = this.data!;
    const pre = d.match!;
    d.snapshot = pre;
    const m = applySnap(pre);
    d.match = m;
    d.live = { playId: m.play!.id, controller: m.play!.offense, handoff: null };
    d.dl.playClock = null;
    this.lastFrameAt = this.host.now();
    d.dl.watchdog = this.lastFrameAt + T.timers.watchdogTick;
    const msg: ServerMsg = { t: 'snap', playId: m.play!.id, auto, clock: m.clock };
    for (const s of SEATS) if (auto || s !== sender) this.sendSeat(s, msg);
    if (!auto && sender !== null) this.sendSeat(sender, { t: 'clock', pc: null });
    this.persist();
  }

  private playClockExpired(): void {
    const d = this.data!;
    d.dl.playClock = null;
    const m = d.match;
    if (!m) return;
    if (m.phase === 'presnap') { this.beginLive(true, null); return; }
    if (isChoiceLegal(m, defaultChoice(m))) { d.match = applyChoice(m, defaultChoice(m)); this.enterState(); }
  }

  private bannerDone(): void {
    const d = this.data!;
    d.dl.banner = null;
    const m = d.match;
    if (!m) return;
    if (m.phase === 'coinToss') d.match = afterCoinToss(m);
    else if (m.phase === 'banner' || m.phase === 'replay') d.match = advanceBanner(m);
    else return;
    this.enterState();
  }

  /** The controller went quiet. Before a handoff the play is voided; after one, the turnover stands. */
  private voidOrSettle(): void {
    const d = this.data!;
    const live = d.live;
    const m = d.match;
    if (!live || !m) return;
    if (live.handoff) {
      const end: PlayEnd = 'tackle';
      const r: PlayResult = {
        playId: live.playId, type: m.play!.type, end, spotX: live.handoff.spotX, possessor: live.handoff.to, offense: m.play!.offense, clock: m.clock,
        ezImpetus: true, lastCarrier: live.handoff.to, sack: false, stats: [emptyStats(), emptyStats()], touches: [], armFatigue: [0, 0], injury: null, yards: 0, big: false,
        note: 'Turnover stands. The ball is spotted at the change of possession.',
      };
      d.match = applyResult(m, r);
    } else if (d.snapshot) {
      d.match = voidPlay(d.snapshot);
    }
    this.enterState();
  }

  private pause(seat: Seat): void {
    const d = this.data!;
    const m = d.match!;
    if (d.pausedBy !== null) {
      if (d.pausedBy === seat) this.resume();
      return;
    }
    if (!CHOICE_PHASES.has(m.phase) || m.pauses[seat] <= 0 || d.waiting) return;
    m.pauses[seat] -= 1;
    d.pausedBy = seat;
    d.dl.playClock = null;
    d.dl.pause = this.host.now() + T.timers.pause;
    this.broadcast({ t: 'paused', by: seat, left: T.timers.pause });
    this.broadcast(this.matchMsg());
    this.persist();
  }

  private resume(): void {
    const d = this.data!;
    d.pausedBy = null;
    d.dl.pause = null;
    this.broadcast({ t: 'paused', by: null, left: 0 });
    this.enterState();
  }

  // --- Messages --------------------------------------------------------------

  onMessage(conn: Conn, raw: string | ArrayBuffer): void {
    if (!this.withinRate(conn)) { this.err(conn, 'rate'); return; }
    if (typeof raw !== 'string') { this.relayFrame(conn, raw); return; }
    let m: ClientMsg;
    try { m = JSON.parse(raw) as ClientMsg; } catch { this.err(conn, 'badmsg'); return; }
    if (m.t === 'join') { this.join(conn, m); return; }
    if (conn.seat === null || !this.data) { this.err(conn, 'forbidden', 'join first'); return; }
    const seat = conn.seat;
    const d = this.data;
    switch (m.t) {
      case 'ptr': {
        const out = JSON.stringify({ t: 'ptr', seat, x: m.x, y: m.y } satisfies ServerMsg);
        for (const c of this.host.conns()) if (c.seat !== null && c.seat !== seat) c.send(out);
        return;
      }
      case 'setConfig': this.setConfig(conn, seat, m.patch); return;
      case 'pickTeam': this.pickTeam(conn, seat, m.team); return;
      case 'ready': this.setReady(conn, seat, m.ready); return;
      case 'rematch': this.rematch(conn); return;
      case 'visibility': {
        const r = d.seats[seat];
        if (r && r.visible !== m.visible) { r.visible = m.visible; this.presenceChanged(seat); this.sendRoom(); this.persist(); }
        return;
      }
      case 'dev': this.dev(conn, m); return;
      default: break;
    }
    if (d.screen !== 'match' || !d.match) { this.err(conn, 'phase'); return; }
    const match = d.match;
    switch (m.t) {
      case 'pause': this.pause(seat); return;
      case 'concede':
        if (match.phase === 'final') return;
        d.match = concede(match, seat);
        this.enterState();
        return;
      case 'claimWin':
        if (d.canClaim !== seat) { this.err(conn, 'forbidden'); return; }
        d.match = concede(match, other(seat));
        this.enterState();
        return;
      case 'skip':
        if (match.phase === 'replay' && this.nextController(match) === seat) this.bannerDone();
        return;
      default: break;
    }
    // Gameplay messages: offense only, in the right phase, for the current play.
    const controller = d.live ? d.live.controller : currentController(match);
    if (controller !== seat) { this.err(conn, 'forbidden', 'watching'); return; }
    if (d.pausedBy !== null || d.waiting) { this.err(conn, 'phase'); return; }
    switch (m.t) {
      case 'snap':
        if (match.phase !== 'presnap' || match.play?.id !== m.playId) { this.err(conn, 'phase'); return; }
        this.beginLive(false, seat);
        return;
      case 'audible':
        if (!canAudible(match, seat) || match.play?.id !== m.playId) { this.err(conn, 'phase'); return; }
        d.match = applyAudible(match, seat);
        {
          const pc = this.pcLeft();
          this.broadcast({ t: 'playStart', play: d.match.play!, match: d.match, pc });
          this.persist();
        }
        return;
      case 'timeout':
        if (!canTimeout(match, seat)) { this.err(conn, 'phase'); return; }
        d.match = applyTimeout(match, seat);
        this.enterState();
        return;
      case 'choice':
        if (!isChoiceLegal(match, m.c)) { this.err(conn, 'phase'); return; }
        d.match = applyChoice(match, m.c);
        this.enterState();
        return;
      case 'handoff': this.onHandoff(conn, seat, m); return;
      case 'playResult': this.onResult(conn, m.result); return;
      default: this.err(conn, 'badmsg');
    }
  }

  private nextController(m: MatchState): Seat | null {
    if (m.after.k === 'kick') return m.after.kicker;
    return m.possession;
  }

  private withinRate(conn: Conn): boolean {
    const now = this.host.now();
    if (conn.win === undefined || now - conn.win >= 1000) { conn.win = now; conn.count = 0; }
    conn.count = (conn.count ?? 0) + 1;
    return conn.count <= T.net.maxMsgPerSec;
  }

  private relayFrame(conn: Conn, buf: ArrayBuffer): void {
    const d = this.data;
    if (!d || conn.seat === null || !d.live || d.live.controller !== conn.seat) return;
    if (buf.byteLength > T.net.maxFrameBytes) return;
    this.lastFrameAt = this.host.now();
    for (const c of this.host.conns()) if (c.seat !== null && c.seat !== conn.seat) c.send(buf);
  }

  private onHandoff(conn: Conn, seat: Seat, m: Extract<ClientMsg, { t: 'handoff' }>): void {
    const d = this.data!;
    const live = d.live;
    if (!live || live.playId !== m.playId || live.controller !== seat) { this.err(conn, 'phase'); return; }
    if (!(m.spotX >= 0 && m.spotX <= T.field.len)) { this.err(conn, 'badmsg'); return; }
    this.lastFrameAt = this.host.now();
    // The server decides, and being single-threaded means only one decision can win.
    if (this.present(m.to)) {
      live.controller = m.to;
      live.handoff = { spotX: m.spotX, to: m.to, reason: m.reason };
      this.sendSeat(seat, { t: 'yield', playId: m.playId, to: m.to, reason: m.reason });
      this.sendSeat(m.to, { t: 'handoff', playId: m.playId, state: m.state, reason: m.reason });
    } else {
      this.sendSeat(seat, { t: 'continue', playId: m.playId });
    }
    this.persist();
  }

  private onResult(conn: Conn, r: PlayResult): void {
    const d = this.data!;
    const m = d.match!;
    if (!d.live || !isResultValid(m, r)) { this.err(conn, 'badmsg', 'bad result'); return; }
    d.match = applyResult(m, r);
    this.enterState();
  }

  private setConfig(conn: Conn, seat: Seat, patch: Partial<MatchConfig>): void {
    const d = this.data!;
    if (seat !== 0) { this.err(conn, 'forbidden', 'host only'); return; }
    if (d.screen !== 'lobby') { this.err(conn, 'phase'); return; }
    if (!isValidConfigPatch(patch)) { this.err(conn, 'badmsg'); return; }
    Object.assign(d.config, patch);
    this.clearReady();
    this.sendRoom();
    this.persist();
  }

  private clearReady(): void {
    for (const s of this.data!.seats) if (s) s.ready = false;
  }

  private pickTeam(conn: Conn, seat: Seat, team: string): void {
    const d = this.data!;
    if (d.screen !== 'lobby') { this.err(conn, 'phase'); return; }
    if (!TEAM_BY_ID[team]) { this.err(conn, 'badmsg'); return; }
    const r = d.seats[seat]!;
    if (r.ready) { this.err(conn, 'phase', 'ready locks your pick'); return; }
    r.team = team;
    this.clearReady();
    this.sendRoom();
    this.persist();
  }

  private setReady(conn: Conn, seat: Seat, ready: boolean): void {
    const d = this.data!;
    if (d.screen !== 'lobby') { this.err(conn, 'phase'); return; }
    const r = d.seats[seat]!;
    if (ready && !r.team) { this.err(conn, 'phase', 'pick a team first'); return; }
    r.ready = ready;
    const a = d.seats[0];
    const b = d.seats[1];
    if (a?.ready && b?.ready && a.team && b.team) { this.startMatch(a.team, b.team); return; }
    this.sendRoom();
    this.persist();
  }

  private startMatch(a: string, b: string): void {
    const d = this.data!;
    d.screen = 'match';
    const seed = Math.floor(this.host.random() * 0xffffffff) >>> 0;
    d.match = createMatch(d.config, [a, b], seed);
    d.pausedBy = null;
    d.canClaim = null;
    d.dl = { playClock: null, banner: null, pause: null, reconnect: [null, null], watchdog: null };
    this.sendRoom();
    this.enterState();
  }

  private rematch(conn: Conn): void {
    const d = this.data!;
    if (d.screen !== 'match' || d.match?.phase !== 'final') { this.err(conn, 'phase'); return; }
    d.screen = 'lobby';
    d.match = null;
    d.snapshot = null;
    d.live = null;
    d.pausedBy = null;
    d.waiting = false;
    d.canClaim = null;
    d.dl = { playClock: null, banner: null, pause: null, reconnect: [null, null], watchdog: null };
    this.clearReady();
    this.sendRoom();
    this.persist();
  }

  private dev(conn: Conn, m: Extract<ClientMsg, { t: 'dev' }>): void {
    const d = this.data!;
    if (!this.host.devTools) { this.err(conn, 'forbidden', 'dev tools off'); return; }
    switch (m.op) {
      case 'patch':
        if (d.match && m.patch) {
          Object.assign(d.match, m.patch);
          if (!d.live) this.enterState(); else this.persist();
        }
        break;
      case 'expire': {
        if (m.what === 'playClock') { if (d.dl.playClock !== null) d.dl.playClock = 0; }
        else if (m.what === 'banner') { if (d.dl.banner !== null) d.dl.banner = 0; }
        else if (m.what === 'pause') { if (d.dl.pause !== null) d.dl.pause = 0; }
        else if (m.what === 'reconnect') { d.dl.reconnect = d.dl.reconnect.map((x) => (x === null ? null : 0)) as [number | null, number | null]; }
        else if (m.what === 'cleanup') { d.lastActivity = -T.timers.cleanup; this.onAlarm(); return; }
        this.onAlarm();
        break;
      }
      case 'restart': this.host.restart?.(); break;
      default: break;
    }
  }

  private join(conn: Conn, m: Extract<ClientMsg, { t: 'join' }>): void {
    const nick = String(m.nick ?? '').slice(0, 16) || 'Player';
    if (!this.data) {
      if (!m.create) { this.err(conn, 'notfound'); conn.close(4004, 'notfound'); return; }
      this.data = {
        code: this.code, seats: [null, null], config: { ...DEFAULT_CONFIG }, screen: 'lobby', match: null, snapshot: null, live: null,
        dl: { playClock: null, banner: null, pause: null, reconnect: [null, null], watchdog: null }, pausedBy: null, waiting: false, canClaim: null, lastActivity: this.host.now(),
      };
    } else if (m.create) { this.err(conn, 'exists'); conn.close(4009, 'exists'); return; }
    const d = this.data;
    let seat: Seat | null = null;
    for (const s of SEATS) if (m.token && d.seats[s]?.token === m.token) seat = s;
    // A "soft" token comes from shared browser storage: a second window of the same
    // browser must become the second player rather than steal the first seat.
    if (seat !== null && m.soft) {
      const inUse = this.host.conns().some((c) => c !== conn && c.seat === seat);
      if (inUse && !d.seats[other(seat)]) seat = null;
    }
    if (seat === null) {
      const free = SEATS.find((s) => !d.seats[s]);
      if (free === undefined) { this.err(conn, 'full', 'Room full'); conn.close(4001, 'full'); return; }
      seat = free;
      d.seats[seat] = { token: this.host.token(), nick, online: true, visible: true, team: null, ready: false };
    }
    for (const c of this.host.conns()) if (c !== conn && c.seat === seat) { c.seat = null; c.close(4000, 'replaced'); }
    conn.seat = seat;
    const rec = d.seats[seat]!;
    rec.online = true;
    rec.visible = true;
    if (nick !== 'Player') rec.nick = nick;
    this.sendTo(conn, { t: 'welcome', seat, token: rec.token });
    this.sendRoom();
    this.presenceChanged(seat);
    if (d.screen === 'match' && d.match) {
      // Catch up: enterState above may already have told them, but a rejoin mid-state needs a copy.
      const m2 = d.match;
      if (m2.phase === 'presnap' && m2.play && !d.waiting) this.sendTo(conn, { t: 'playStart', play: m2.play, match: m2, pc: this.pcLeft() });
      else this.sendTo(conn, this.matchMsg());
      this.sendTo(conn, this.waitingMsg());
      if (d.pausedBy !== null) this.sendTo(conn, { t: 'paused', by: d.pausedBy, left: Math.max(0, (d.dl.pause ?? 0) - this.host.now()) });
    }
    this.persist();
  }

  onClose(conn: Conn): void {
    if (!this.data || conn.seat === null) return;
    const seat = conn.seat;
    conn.seat = null;
    if (this.host.conns().some((c) => c !== conn && c.seat === seat)) return;
    const rec = this.data.seats[seat];
    if (rec) { rec.online = false; }
    this.presenceChanged(seat);
    this.sendRoom();
    this.persist();
  }
}
