// One room on this device: the socket, then the lobby or the match, whichever the server says.
import { isValidConfigPatch, type MatchConfig } from '../../shared/data/config';
import type { MatchState } from '../../shared/rules/match';
import type { RoomView, Seat, ServerMsg } from '../../shared/protocol';
import { Net } from '../net/socket';
import { showFinal } from '../ui/final';
import { Lobby } from '../ui/lobby';
import { Session } from './session';

export interface RoomClientOpts {
  code: string; create: boolean; nick: string;
  /** Leaves for the title screen, with an optional message. */
  leave(error?: string): void;
  params: URLSearchParams;
}

function saveToken(code: string, token: string): void {
  try { localStorage.setItem(`borg.token.${code}`, token); sessionStorage.setItem(`borg.token.${code}`, token); } catch { /* storage may be blocked */ }
}
function loadToken(code: string): { token?: string; soft?: boolean } {
  try {
    const tab = sessionStorage.getItem(`borg.token.${code}`);
    if (tab) return { token: tab };
    const shared = localStorage.getItem(`borg.token.${code}`);
    if (shared) return { token: shared, soft: true };
  } catch { /* storage may be blocked */ }
  return {};
}
function savedConfig(): Partial<MatchConfig> | null {
  try {
    const raw = localStorage.getItem('borg.config');
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<MatchConfig>;
    return isValidConfigPatch(p) ? p : null;
  } catch { return null; }
}
function saveConfig(c: MatchConfig): void {
  try { localStorage.setItem('borg.config', JSON.stringify(c)); } catch { /* optional */ }
}

export class RoomClient {
  net: Net;
  seat: Seat | null = null;
  room: RoomView | null = null;
  lobby: Lobby | null = null;
  session: Session | null = null;
  private appliedSaved = false;
  private connBar: HTMLElement;
  private finalEl: HTMLElement | null = null;
  private created: boolean;

  constructor(private parent: HTMLElement, private o: RoomClientOpts) {
    this.created = o.create && !loadToken(o.code).token;
    this.connBar = document.createElement('div');
    this.connBar.className = 'conn-bar';
    this.connBar.dataset.testid = 'status';
    parent.append(this.connBar);
    this.net = new Net(o.code, {
      onOpen: () => {
        this.net.send({ t: 'join', ...loadToken(o.code), nick: o.nick || 'Player', create: this.created });
        if (document.hidden) this.net.send({ t: 'visibility', visible: false });
        this.session?.onReconnected();
      },
      onMsg: (m) => this.onMsg(m),
      onFrame: (b) => this.session?.onFrame(b),
      onStatus: (s) => { this.connBar.textContent = s === 'open' ? '' : 'Reconnecting...'; this.connBar.style.display = s === 'open' ? 'none' : ''; },
      onFatal: (c) => { this.destroy(); o.leave(c === 4001 ? 'Room full' : c === 4004 ? 'Room not found' : c === 4009 ? 'That code is taken' : 'Room closed'); },
    });
    document.addEventListener('visibilitychange', this.onVis);
    this.net.connect();
    (window as unknown as { __room: RoomClient }).__room = this;
  }

  private onVis = (): void => { this.net.send({ t: 'visibility', visible: !document.hidden }); };

  private onMsg(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.seat = m.seat;
        this.created = false;
        saveToken(this.o.code, m.token);
        if (this.session) this.session.seat = m.seat;
        break;
      case 'room':
        this.room = m.room;
        if (this.seat === 0 && !this.appliedSaved && m.room.screen === 'lobby' && this.o.create) {
          this.appliedSaved = true;
          const saved = savedConfig();
          if (saved) this.net.send({ t: 'setConfig', patch: saved });
        }
        if (this.seat === 0 && m.room.screen === 'lobby') saveConfig(m.room.config);
        this.render(m.room);
        this.session?.onMsg(m);
        break;
      case 'ptr': this.lobby?.showRivalPointer(m.x, m.y); break;
      case 'error': console.warn('room error', m.code, m.msg ?? ''); this.session?.onMsg(m); break;
      default: this.session?.onMsg(m);
    }
  }

  private render(room: RoomView): void {
    if (room.screen === 'lobby') {
      if (this.session) { this.session.destroy(); this.session = null; this.finalEl = null; }
      if (!this.lobby) {
        this.lobby = new Lobby(this.parent, this.o.code, {
          setConfig: (patch) => this.net.send({ t: 'setConfig', patch }),
          pickTeam: (team) => this.net.send({ t: 'pickTeam', team }),
          ready: (ready) => this.net.send({ t: 'ready', ready }),
          ptr: (x, y) => this.net.send({ t: 'ptr', x, y }),
          sound: () => { /* M7 */ },
          soundOn: () => true,
          help: () => { /* M7 */ },
        });
      }
      this.lobby.update(room, this.seat);
    } else {
      if (this.lobby) { this.lobby.destroy(); this.lobby = null; }
      if (!this.session) {
        const q = this.o.params;
        this.session = new Session(this.parent, this.net, {
          local: false, bot: q.has('bot'), speed: Number(q.get('speed') ?? 1), dev: q.has('dev'),
          onFinal: (ms) => this.showFinalScreen(ms),
        });
        this.session.seat = this.seat;
        (window as unknown as { __borg: unknown }).__borg = this.session;
      }
    }
  }

  private showFinalScreen(m: MatchState): void {
    if (!this.session) return;
    this.finalEl = showFinal(this.session.stage.overlay, m, this.seat, {
      rematch: () => this.net.send({ t: 'rematch' }),
      leave: () => { this.destroy(); this.o.leave(); },
    });
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.onVis);
    this.net.stop();
    this.session?.destroy();
    this.lobby?.destroy();
    this.connBar.remove();
  }
}
