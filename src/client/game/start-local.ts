// Starts a one-device game: ?local=1&a=SEA&b=LAR&q=3
import type { MatchConfig } from '../../shared/data/config';
import type { MatchState } from '../../shared/rules/match';
import { LocalNet } from './local';
import { Session } from './session';
import { showFinal } from '../ui/final';

export function startLocal(parent: HTMLElement): void {
  const q = new URLSearchParams(location.search);
  const a = q.get('a') ?? 'SEA';
  const b = q.get('b') ?? 'LAR';
  const cfg: Partial<MatchConfig> = { quarter: Number(q.get('q') ?? 1) as MatchConfig['quarter'], replays: (q.get('replays') ?? 'off') as MatchConfig['replays'], weather: (q.get('weather') ?? 'clear') as MatchConfig['weather'] };
  let session: Session | null = null;
  const net = new LocalNet({
    onOpen: () => {},
    onMsg: (m) => session?.onMsg(m),
    onFrame: () => {},
    onStatus: () => {},
    onFatal: () => {},
  });
  const opts = {
    local: true, bot: q.has('bot'), speed: Number(q.get('speed') ?? 1), dev: q.has('dev'),
    onFinal: (m: MatchState) => showFinal(session!.stage.overlay, m, null, { rematch: () => location.reload(), leave: () => { location.href = '/'; } }),
  };
  session = new Session(parent, net, opts);
  session.seat = 0;
  (window as unknown as { __borg: unknown }).__borg = session;
  net.start(a, b, cfg);
}
