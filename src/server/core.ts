// Room logic with no Cloudflare imports. The Durable Object in room.ts is a thin
// adapter around it, so the same code can run in tests and in one-device games.
import type { ClientMsg, ErrorCode, RoomView, Seat, ServerMsg } from '../shared/protocol';

export interface Conn {
  seat: Seat | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
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
}

interface SeatRec { token: string; nick: string; online: boolean }

export interface RoomData {
  code: string;
  seats: [SeatRec | null, SeatRec | null];
  lastActivity: number;
}

export const CLEANUP_MS = 2 * 60 * 60 * 1000;

export class RoomCore {
  data: RoomData | null = null;

  constructor(private host: RoomHost, private code: string) {
    const raw = host.load();
    if (raw) this.data = JSON.parse(raw) as RoomData;
    if (this.data) this.syncOnline();
  }

  private syncOnline(): void {
    const d = this.data!;
    const live: [boolean, boolean] = [false, false];
    for (const c of this.host.conns()) if (c.seat !== null) live[c.seat] = true;
    for (const s of [0, 1] as Seat[]) { const r = d.seats[s]; if (r) r.online = live[s]; }
  }

  private persist(): void {
    if (!this.data) return;
    this.data.lastActivity = this.host.now();
    this.host.save(JSON.stringify(this.data));
    this.host.setAlarm(this.data.lastActivity + CLEANUP_MS);
  }

  private view(): RoomView {
    const d = this.data!;
    const seat = (r: SeatRec | null) => (r ? { nick: r.nick, online: r.online } : null);
    return { code: d.code, seats: [seat(d.seats[0]), seat(d.seats[1])] };
  }

  private sendTo(c: Conn, m: ServerMsg): void { c.send(JSON.stringify(m)); }
  private broadcast(m: ServerMsg): void {
    const s = JSON.stringify(m);
    for (const c of this.host.conns()) if (c.seat !== null) c.send(s);
  }
  private err(c: Conn, code: ErrorCode, msg?: string): void { this.sendTo(c, { t: 'error', code, msg }); }

  onMessage(conn: Conn, raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string') return;
    let m: ClientMsg;
    try { m = JSON.parse(raw) as ClientMsg; } catch { return this.err(conn, 'badmsg'); }
    if (m.t === 'join') return this.join(conn, m);
    if (conn.seat === null) return this.err(conn, 'forbidden', 'join first');
    if (m.t === 'ptr') {
      const out = JSON.stringify({ t: 'ptr', seat: conn.seat, x: m.x, y: m.y } satisfies ServerMsg);
      for (const c of this.host.conns()) if (c.seat !== null && c.seat !== conn.seat) c.send(out);
    }
  }

  private join(conn: Conn, m: Extract<ClientMsg, { t: 'join' }>): void {
    const nick = String(m.nick ?? '').slice(0, 16) || 'Player';
    if (!this.data) {
      if (!m.create) { this.err(conn, 'notfound'); conn.close(4004, 'notfound'); return; }
      this.data = { code: this.code, seats: [null, null], lastActivity: this.host.now() };
    } else if (m.create) { this.err(conn, 'exists'); conn.close(4009, 'exists'); return; }
    const d = this.data;
    let seat: Seat | null = null;
    for (const s of [0, 1] as Seat[]) if (m.token && d.seats[s]?.token === m.token) seat = s;
    // A "soft" token comes from shared browser storage: a second window of the same
    // browser must become the second player rather than steal the first seat.
    if (seat !== null && m.soft) {
      const inUse = this.host.conns().some((c) => c !== conn && c.seat === seat);
      if (inUse && !d.seats[(1 - seat) as Seat]) seat = null;
      else if (inUse && d.seats[(1 - seat) as Seat]?.token) { /* phone came back: reclaim */ }
    }
    if (seat === null) {
      const free = ([0, 1] as Seat[]).find((s) => !d.seats[s]);
      if (free === undefined) { this.err(conn, 'full', 'Room full'); conn.close(4001, 'full'); return; }
      seat = free;
      d.seats[seat] = { token: this.host.token(), nick, online: true };
    }
    for (const c of this.host.conns()) if (c !== conn && c.seat === seat) { c.seat = null; c.close(4000, 'replaced'); }
    conn.seat = seat;
    const rec = d.seats[seat]!;
    rec.online = true;
    if (nick !== 'Player') rec.nick = nick;
    this.persist();
    this.sendTo(conn, { t: 'welcome', seat, token: rec.token });
    this.broadcast({ t: 'room', room: this.view() });
  }

  onClose(conn: Conn): void {
    if (!this.data || conn.seat === null) return;
    const seat = conn.seat;
    conn.seat = null;
    if (this.host.conns().some((c) => c !== conn && c.seat === seat)) return;
    const rec = this.data.seats[seat];
    if (rec) rec.online = false;
    this.persist();
    this.broadcast({ t: 'room', room: this.view() });
  }

  onAlarm(): void {
    if (!this.data) return;
    if (this.host.now() - this.data.lastActivity >= CLEANUP_MS) {
      for (const c of this.host.conns()) c.close(4010, 'expired');
      this.data = null;
      this.host.wipe();
    }
  }
}
