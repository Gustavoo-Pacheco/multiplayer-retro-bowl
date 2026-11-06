// A bare WebSocket client that speaks the room protocol, for room tests.
import type { ClientMsg, ServerMsg } from '../../src/shared/protocol';
import type { MatchState } from '../../src/shared/rules/match';
import { makeRoomCode } from '../../src/shared/protocol';

export const BASE = 'ws://localhost:5198';

export class TestClient {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  frames: ArrayBuffer[] = [];
  closeCode: number | null = null;
  seat: 0 | 1 | null = null;
  token = '';
  /** Calls the coach's pick as soon as a huddle asks this seat for a call, so tests not about the huddle go straight to the snap. */
  autoCall = true;
  private called = '';
  private waiters: (() => void)[] = [];

  constructor(public code: string) {}

  async open(): Promise<this> {
    this.ws = new WebSocket(`${BASE}/ws/${this.code}`);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        if (e.data === 'pong') return;
        const m = JSON.parse(e.data) as ServerMsg;
        if (m.t === 'welcome') { this.seat = m.seat; this.token = m.token; }
        this.inbox.push(m);
        if (this.autoCall && (m.t === 'matchState' || m.t === 'playStart')) this.callIfAsked(m.match);
      } else this.frames.push(e.data as ArrayBuffer);
      this.waiters.splice(0).forEach((w) => w());
    };
    this.ws.onclose = (e) => { this.closeCode = e.code; this.waiters.splice(0).forEach((w) => w()); };
    await new Promise<void>((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('ws error')); });
    return this;
  }

  private callIfAsked(m: MatchState): void {
    const h = m.huddle;
    if (m.phase !== 'huddle' || !h || !m.play || this.seat === null) return;
    const side = m.play.offense === this.seat ? 'off' : h.computer ? null : 'def';
    if (!side) return;
    const i = side === 'off' ? 0 : 1;
    const key = `${m.play.id}:${m.timeouts.join(',')}:${side}`;
    if (h.calls[i] !== -1 || this.called === key) return;
    this.called = key;
    this.send({ t: 'call', playId: m.play.id, side, id: Math.max(0, h.suggest[i]) });
  }

  send(m: ClientMsg): void { this.ws.send(JSON.stringify(m)); }
  sendRaw(d: string | ArrayBuffer): void { this.ws.send(d); }

  /** Waits for a message matching `pred`, searching what already arrived first. */
  async wait<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 8000): Promise<Extract<ServerMsg, { t: T }>> {
    const until = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { t: T }>;
      const left = until - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for ${t}; inbox=${JSON.stringify(this.inbox.map((m) => m.t))}`);
      await new Promise<void>((res) => { const to = setTimeout(res, left); this.waiters.push(() => { clearTimeout(to); res(); }); });
    }
  }

  async waitClose(ms = 5000): Promise<number> {
    const until = Date.now() + ms;
    while (this.closeCode === null) {
      if (Date.now() > until) throw new Error('timeout waiting for close');
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.closeCode;
  }

  close(): void { try { this.ws.close(); } catch { /* ignore */ } }
}

export function newCode(): string { return makeRoomCode(); }

export async function joined(code: string, nick: string, opts: { token?: string; soft?: boolean; create?: boolean } = {}): Promise<TestClient> {
  const c = await new TestClient(code).open();
  c.send({ t: 'join', nick, ...opts });
  await c.wait('welcome');
  return c;
}
