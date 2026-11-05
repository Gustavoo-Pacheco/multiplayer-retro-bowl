import { DurableObject } from 'cloudflare:workers';
import { RoomCore, type Conn, type RoomHost } from './core';
import type { Seat } from '../shared/protocol';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS?: Fetcher;
  DEV_TOOLS?: string;
}

/** Thin adapter: sockets, SQLite and alarms around RoomCore. */
export class Room extends DurableObject<Env> implements RoomHost {
  private core: RoomCore | null = null;
  private wrapped = new WeakMap<WebSocket, Conn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room(id INTEGER PRIMARY KEY CHECK(id = 1), code TEXT, state TEXT)');
  }

  private conn(ws: WebSocket): Conn {
    let c = this.wrapped.get(ws);
    if (c) return c;
    const att = ws.deserializeAttachment() as { seat: Seat | null } | null;
    let seat: Seat | null = att?.seat ?? null;
    c = {
      get seat() { return seat; },
      set seat(v: Seat | null) { seat = v; ws.serializeAttachment({ seat: v }); },
      send: (d) => { try { ws.send(d); } catch { /* socket already closed */ } },
      close: (code, reason) => { try { ws.close(code, reason); } catch { /* already closed */ } },
    };
    this.wrapped.set(ws, c);
    return c;
  }

  private getCore(code?: string): RoomCore {
    if (!this.core) {
      const row = this.ctx.storage.sql.exec<{ code: string }>('SELECT code FROM room WHERE id = 1').toArray()[0];
      this.core = new RoomCore(this, row?.code ?? code ?? '');
    }
    return this.core;
  }

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const code = url.searchParams.get('code') ?? '';
    this.pendingCode = code;
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ seat: null });
    this.getCore(code);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  private pendingCode = '';

  override async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    this.getCore(this.pendingCode).onMessage(this.conn(ws), msg);
  }
  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.getCore(this.pendingCode).onClose(this.conn(ws));
  }
  override async webSocketError(ws: WebSocket): Promise<void> {
    this.getCore(this.pendingCode).onClose(this.conn(ws));
  }
  override async alarm(): Promise<void> {
    this.getCore(this.pendingCode).onAlarm();
  }

  // RoomHost
  conns(): Conn[] { return this.ctx.getWebSockets().map((w) => this.conn(w)); }
  now(): number { return Date.now(); }
  random(): number { return Math.random(); }
  token(): string { return crypto.randomUUID(); }
  save(json: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO room(id, code, state) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET code = excluded.code, state = excluded.state',
      this.core?.data?.code ?? this.pendingCode, json);
  }
  load(): string | null {
    return this.ctx.storage.sql.exec<{ state: string }>('SELECT state FROM room WHERE id = 1').toArray()[0]?.state ?? null;
  }
  wipe(): void {
    this.core = null;
    void this.ctx.storage.deleteAlarm();
    void this.ctx.storage.deleteAll();
  }
  setAlarm(at: number | null): void {
    if (at === null) void this.ctx.storage.deleteAlarm();
    else void this.ctx.storage.setAlarm(at);
  }
}
