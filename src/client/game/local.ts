// One-device mode: runs the same room logic in this page, with both seats on one screen.
import { RoomCore, type Conn, type RoomHost } from '../../server/core';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import type { NetHandlers, NetLike, NetStatus } from '../net/socket';

class LocalConn implements Conn {
  seat: 0 | 1 | null = null;
  constructor(private sink: (data: string | ArrayBuffer) => void) {}
  send(d: string | ArrayBuffer): void { this.sink(d); }
  close(): void { /* nothing to close */ }
}

/** Implements the socket interface without a network. Whoever is in control speaks for the room. */
export class LocalNet implements NetLike, RoomHost {
  status: NetStatus = 'open';
  devTools = true;
  private c0: LocalConn;
  private c1: LocalConn;
  private core: RoomCore;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private h: NetHandlers) {
    this.c0 = new LocalConn((d) => this.fromRoom(0, d));
    this.c1 = new LocalConn((d) => this.fromRoom(1, d));
    this.core = new RoomCore(this, 'LOCAL0');
  }

  private fromRoom(seat: 0 | 1, d: string | ArrayBuffer): void {
    if (typeof d !== 'string') return;
    const m = JSON.parse(d) as ServerMsg;
    // One screen: forward one copy of shared messages, plus the handoff itself.
    if (m.t === 'handoff' || m.t === 'continue') { queueMicrotask(() => this.h.onMsg(m)); return; }
    if (m.t === 'yield' || m.t === 'welcome') return;
    if (seat === 0) queueMicrotask(() => this.h.onMsg(m));
  }

  start(a: string, b: string, cfg: Partial<import('../../shared/data/config').MatchConfig>): void {
    const join = (c: LocalConn, nick: string, create: boolean) => this.core.onMessage(c, JSON.stringify({ t: 'join', nick, create } satisfies ClientMsg));
    join(this.c0, 'Player 1', true);
    join(this.c1, 'Player 2', false);
    this.core.onMessage(this.c0, JSON.stringify({ t: 'setConfig', patch: cfg } satisfies ClientMsg));
    this.core.onMessage(this.c0, JSON.stringify({ t: 'pickTeam', team: a } satisfies ClientMsg));
    this.core.onMessage(this.c1, JSON.stringify({ t: 'pickTeam', team: b } satisfies ClientMsg));
    this.core.onMessage(this.c0, JSON.stringify({ t: 'ready', ready: true } satisfies ClientMsg));
    this.core.onMessage(this.c1, JSON.stringify({ t: 'ready', ready: true } satisfies ClientMsg));
  }

  private controllerConn(): LocalConn {
    const d = this.core.data;
    const m = d?.match;
    if (d?.live) return d.live.controller === 0 ? this.c0 : this.c1;
    if (m?.play && (m.phase === 'presnap' || m.phase === 'live')) return m.play.offense === 0 ? this.c0 : this.c1;
    if (m?.phase === 'kickChoice') return m.kicker === 0 ? this.c0 : this.c1;
    return m?.possession === 1 ? this.c1 : this.c0;
  }

  send(m: ClientMsg): void { this.core.onMessage(m.t === 'pause' ? this.c0 : this.controllerConn(), JSON.stringify(m)); }
  sendFrame(b: ArrayBuffer): void { this.core.onMessage(this.controllerConn(), b); }

  // RoomHost
  conns(): Conn[] { return [this.c0, this.c1]; }
  now(): number { return Date.now(); }
  save(): void { /* one-device games aren't saved */ }
  load(): string | null { return null; }
  wipe(): void { /* nothing stored */ }
  random(): number { return Math.random(); }
  token(): string { return String(Math.random()); }
  setAlarm(at: number | null): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (at !== null) this.timer = setTimeout(() => this.core.onAlarm(), Math.max(0, at - Date.now()));
  }
}
