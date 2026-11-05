// One WebSocket per player, with automatic reconnect (0.5 s to 5 s backoff) and heartbeats.
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export type NetStatus = 'connecting' | 'open' | 'closed';

export interface NetLike {
  send(m: ClientMsg): void;
  sendFrame(b: ArrayBuffer): void;
  status: NetStatus;
}

export interface NetHandlers {
  onOpen(): void;
  onMsg(m: ServerMsg): void;
  onFrame(b: ArrayBuffer): void;
  onStatus(s: NetStatus): void;
  /** A close code that means "do not retry" (room full, not found). */
  onFatal(code: number): void;
}

const BACKOFF_MIN = 500;
const BACKOFF_MAX = 5000;
const PING_MS = 8000;
const PONG_TIMEOUT_MS = 20000;
const FATAL = new Set([4001, 4004, 4009, 4010]);

export class Net implements NetLike {
  status: NetStatus = 'closed';
  private ws: WebSocket | null = null;
  private backoff = BACKOFF_MIN;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;
  private stopped = false;

  constructor(private code: string, private h: NetHandlers) {}

  connect(): void {
    this.stopped = false;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/${this.code}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.backoff = BACKOFF_MIN;
      this.lastPong = Date.now();
      this.setStatus('open');
      this.h.onOpen();
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - this.lastPong > PONG_TIMEOUT_MS) { ws.close(); this.handleClose(ws, 1006); return; }
        ws.send('ping');
      }, PING_MS);
    };
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      this.lastPong = Date.now();
      if (typeof ev.data === 'string') {
        if (ev.data === 'pong') return;
        this.h.onMsg(JSON.parse(ev.data) as ServerMsg);
      } else this.h.onFrame(ev.data as ArrayBuffer);
    };
    ws.onclose = (ev) => this.handleClose(ws, ev.code);
    ws.onerror = () => { /* onclose follows */ };
  }

  private handleClose(ws: WebSocket, code: number): void {
    if (ws !== this.ws) return;
    this.ws = null;
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
    this.setStatus('closed');
    if (FATAL.has(code)) { this.h.onFatal(code); return; }
    if (this.stopped || code === 4000) return;
    this.retry = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(BACKOFF_MAX, this.backoff * 2);
  }

  private setStatus(s: NetStatus): void { this.status = s; this.h.onStatus(s); }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  sendFrame(b: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(b);
  }
  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }
}
