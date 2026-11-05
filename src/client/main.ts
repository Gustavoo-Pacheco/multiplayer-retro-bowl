import { CODE_RE, makeRoomCode } from '../shared/protocol';
import { RoomClient } from './game/room-client';
import { clear, h } from './ui/dom';

const app = document.getElementById('app')!;
const query = new URLSearchParams(location.search);

function nickname(): string {
  try { return localStorage.getItem('borg.nick') ?? ''; } catch { return ''; }
}
function saveNick(n: string): void {
  try { localStorage.setItem('borg.nick', n); } catch { /* optional */ }
}

function go(code: string, create: boolean): void {
  history.pushState(null, '', `/r/${code}${location.search}`);
  clear(app);
  new RoomClient(app, { code, create, nick: nickname(), params: query, leave: (error) => { history.pushState(null, '', '/'); showTitle(error); } });
}

function showTitle(error?: string): void {
  const nick = h('input', { placeholder: 'Nickname', maxlength: 16, value: nickname(), testid: 'nick' });
  const code = h('input', { placeholder: 'CODE', maxlength: 6, testid: 'code', class: 'code-input', autocapitalize: 'characters' });
  const take = () => saveNick(nick.value.trim());
  clear(app);
  app.append(h('div', { class: 'center title-screen', testid: 'title' },
    h('h1', { class: 'title' }, 'BORG BOWL'),
    nick,
    h('button', { class: 'big', testid: 'create', onclick: () => { take(); go(makeRoomCode(), true); } }, 'Create game'),
    h('div', { class: 'row' }, code, h('button', { testid: 'join', onclick: () => {
      const c = code.value.trim().toUpperCase();
      if (CODE_RE.test(c)) { take(); go(c, false); } else showTitle('Enter the 6-character room code');
    } }, 'Join with code')),
    error ? h('div', { class: 'err', testid: 'error' }, error) : null,
  ));
}

/** Opening an invite link asks for a nickname first, unless one is already saved. */
function askNick(code: string): void {
  const nick = h('input', { placeholder: 'Nickname', maxlength: 16, testid: 'nick' });
  const submit = () => { saveNick(nick.value.trim()); go(code, false); };
  clear(app);
  app.append(h('div', { class: 'center', testid: 'nick-prompt' },
    h('h1', { class: 'title' }, 'BORG BOWL'),
    h('div', {}, `You're invited to room ${code}`),
    nick,
    h('button', { class: 'big', testid: 'nick-go', onclick: submit }, 'Join game'),
  ));
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

const route = location.pathname.match(/^\/r\/([^/]+)$/);
if (query.has('practice')) void import('./game/practice').then((x) => x.startPractice(app));
else if (query.has('local')) void import('./game/start-local').then((x) => x.startLocal(app));
else if (route && CODE_RE.test(route[1].toUpperCase())) {
  const code = route[1].toUpperCase();
  if (nickname()) go(code, false); else askNick(code);
} else showTitle();
