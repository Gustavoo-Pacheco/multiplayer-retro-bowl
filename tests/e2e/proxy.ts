// A TCP proxy for one test player: adds real network delay and can cut the connection.
// It also reaches a deployed https address, so the same tests can run against the live game.
import net from 'node:net';
import tls from 'node:tls';

interface Chunk { at: number; data: Buffer }

class Pipe {
  private q: Chunk[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private out: net.Socket, private delay: () => number, private jitter: () => number) {}
  push(data: Buffer): void {
    const j = this.jitter();
    const at = Date.now() + this.delay() + (j ? Math.random() * j : 0);
    // Keeps order, as TCP does.
    const last = this.q.length ? this.q[this.q.length - 1].at : 0;
    this.q.push({ at: Math.max(at, last), data });
    this.pump();
  }
  private pump(): void {
    if (this.timer || !this.q.length) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const now = Date.now();
      while (this.q.length && this.q[0].at <= now) { const c = this.q.shift()!; if (!this.out.destroyed) this.out.write(c.data); }
      this.pump();
    }, Math.max(0, this.q[0].at - Date.now()));
  }
}

export class NetProxy {
  private server!: net.Server;
  /** Game sockets only. */
  private socks = new Set<net.Socket>();
  private oneWay = 0;
  private all = new Set<net.Socket>();
  private jitterMs = 0;
  private blocked = false;
  port = 0;

  private host: string;
  private targetPort: number;
  private secure: boolean;
  /** The target's own name, sent in place of the local proxy's, which a real server wouldn't recognise. */
  private hostHeader: string;

  constructor(target: string) {
    const u = new URL(target);
    this.host = u.hostname;
    this.secure = u.protocol === 'https:';
    this.targetPort = Number(u.port || (this.secure ? 443 : 80));
    this.hostHeader = u.host;
  }

  private dial(): net.Socket {
    return this.secure ? tls.connect({ host: this.host, port: this.targetPort, servername: net.isIP(this.host) ? undefined : this.host }) : net.connect(this.targetPort, this.host);
  }

  /** Requests start at the beginning of a chunk here, as they're short and sent whole. */
  private rewrite(b: Buffer): Buffer {
    if (!/^(GET|HEAD|POST|PUT|DELETE|OPTIONS) /.test(b.toString('latin1', 0, 8))) return b;
    const text = b.toString('latin1').replace(/\r\nHost: [^\r]*/i, `\r\nHost: ${this.hostHeader}`).replace(/\r\nOrigin: [^\r]*/i, `\r\nOrigin: ${this.secure ? 'https' : 'http'}://${this.hostHeader}`);
    return Buffer.from(text, 'latin1');
  }

  async start(): Promise<this> {
    this.server = net.createServer((client) => {
      const up = this.dial();
      const pair = [client, up];
      const toUp = new Pipe(up, () => this.oneWay, () => this.jitterMs);
      const toClient = new Pipe(client, () => this.oneWay, () => this.jitterMs);
      let first = true;
      client.on('data', (d) => {
        const b = d as Buffer;
        if (first) {
          first = false;
          // Only game sockets are cut: dropping Vite's own socket would reload the page.
          if (b.toString('latin1', 0, 8) === 'GET /ws/') {
            if (this.blocked) { end(); return; }
            for (const s of pair) this.socks.add(s);
          }
        }
        toUp.push(this.rewrite(b));
      });
      up.on('data', (d) => toClient.push(d as Buffer));
      const end = () => { client.destroy(); up.destroy(); this.socks.delete(client); this.socks.delete(up); this.all.delete(client); this.all.delete(up); };
      this.all.add(client); this.all.add(up);
      client.on('close', end); up.on('close', end); client.on('error', end); up.on('error', end);
    });
    await new Promise<void>((res) => this.server.listen(0, 'localhost', () => res()));
    this.port = (this.server.address() as net.AddressInfo).port;
    return this;
  }

  /** Adds this much delay in each direction. */
  setDelay(ms: number, jitter = 0): void { this.oneWay = ms; this.jitterMs = jitter; }

  /** Cuts open connections. New ones still work unless `block` is on. */
  disconnect(): void { for (const s of this.socks) s.destroy(); this.socks.clear(); }

  block(on: boolean): void { this.blocked = on; if (on) this.disconnect(); }

  stop(): void { for (const s of this.all) s.destroy(); this.all.clear(); this.socks.clear(); this.server.close(); }
}
