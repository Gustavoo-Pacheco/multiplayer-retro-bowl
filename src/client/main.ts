import { CODE_RE, makeRoomCode, type RoomView, type Seat, type ServerMsg } from '../shared/protocol';
import { Net } from './net/socket';
import { clear, h } from './ui/dom';

const app = document.getElementById('app')!;

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
function nickname(): string {
  try { return localStorage.getItem('borg.nick') ?? ''; } catch { return ''; }
}

function showTitle(error?: string): void {
  const nick = h('input', { placeholder: 'Nickname', maxlength: 16, value: nickname(), testid: 'nick' });
  const code = h('input', { placeholder: 'CODE', maxlength: 6, testid: 'code', style: 'text-transform:uppercase;width:9em' });
  const go = (c: string, create: boolean) => {
    try { localStorage.setItem('borg.nick', nick.value.trim()); } catch { /* ignore */ }
    history.pushState(null, '', `/r/${c}`);
    enterRoom(c, create);
  };
  clear(app);
  app.append(h('div', { class: 'center' },
    h('h1', { class: 'title' }, 'BORG BOWL'),
    nick,
    h('button', { testid: 'create', onclick: () => go(makeRoomCode(), true) }, 'Create game'),
    h('div', {}, code, ' ', h('button', { testid: 'join', onclick: () => { const c = code.value.trim().toUpperCase(); if (CODE_RE.test(c)) go(c, false); } }, 'Join with code')),
    error ? h('div', { class: 'err', testid: 'error' }, error) : null,
  ));
}

function enterRoom(code: string, create: boolean): void {
  let room: RoomView | null = null;
  let seat: Seat | null = null;
  const dots: HTMLElement[] = [];
  const status = h('div', { testid: 'status' }, 'connecting');
  const seats = h('div', { testid: 'seats' });
  const pad = h('div', { testid: 'pad', style: 'position:relative;width:min(90vw,520px);height:40vh;border:2px solid var(--line);touch-action:none' });
  const rival = h('div', { testid: 'rival-ptr', style: 'position:absolute;width:12px;height:12px;background:var(--accent);display:none' });
  pad.append(rival);
  dots.push(rival);
  const render = () => {
    clear(seats);
    if (!room) return;
    room.seats.forEach((s, i) => seats.append(h('div', { testid: `seat-${i}` }, `${i === seat ? 'YOU' : 'RIVAL'}: ${s ? `${s.nick} ${s.online ? 'online' : 'offline'}` : 'empty'}`)));
  };
  const net = new Net(code, {
    onOpen: () => net.send({ t: 'join', ...loadToken(code), nick: nickname() || 'Player', create: create && !loadToken(code).token }),
    onMsg: (m: ServerMsg) => {
      if (m.t === 'welcome') { seat = m.seat; saveToken(code, m.token); render(); }
      else if (m.t === 'room') { room = m.room; render(); }
      else if (m.t === 'ptr') { rival.style.display = 'block'; rival.style.left = `${m.x * 100}%`; rival.style.top = `${m.y * 100}%`; }
      else if (m.t === 'error' && (m.code === 'full' || m.code === 'notfound')) { /* close handler reports it */ }
    },
    onFrame: () => {},
    onStatus: (s) => { status.textContent = s; },
    onFatal: (c) => { history.pushState(null, '', '/'); showTitle(c === 4001 ? 'Room full' : c === 4004 ? 'Room not found' : 'Room closed'); },
  });
  pad.addEventListener('pointermove', (e) => {
    const r = pad.getBoundingClientRect();
    net.send({ t: 'ptr', x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  });
  clear(app);
  app.append(h('div', { class: 'center' },
    h('h1', { class: 'title' }, 'BORG BOWL'),
    h('div', {}, 'ROOM ', h('span', { testid: 'room-code' }, code)),
    status, seats, pad,
  ));
  net.connect();
}

const m = location.pathname.match(/^\/r\/([^/]+)$/);
const query = new URLSearchParams(location.search);
if (query.has('practice')) void import('./game/practice').then((x) => x.startPractice(app));
else if (m && CODE_RE.test(m[1].toUpperCase())) enterRoom(m[1].toUpperCase(), false);
else showTitle();
