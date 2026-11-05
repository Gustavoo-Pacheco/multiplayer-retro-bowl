import { CODE_RE } from '../shared/protocol';
import { Room, type Env } from './room';

export { Room };

const NOINDEX = { 'X-Robots-Tag': 'noindex' };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const ws = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (ws) {
      const code = ws[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('bad room code', { status: 400, headers: NOINDEX });
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      return stub.fetch(new Request(`${url.origin}/ws?code=${code}`, req));
    }
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response('not found', { status: 404, headers: NOINDEX });
  },
} satisfies ExportedHandler<Env>;
