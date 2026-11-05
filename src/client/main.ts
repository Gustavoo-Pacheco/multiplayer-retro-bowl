import { CODE_RE, makeRoomCode } from '../shared/protocol';
import { RoomClient } from './game/room-client';
import { audio } from './audio/engine';
import { logoCanvas, titleArt } from './render/title-art';
import { clear, h } from './ui/dom';
import { openHelp, openPrefs } from './ui/panels';
import './ui/prefs';

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
  audio.setSong('title');
  app.append(titleArt(), h('div', { class: 'center title-screen', testid: 'title' },
    h('h1', { class: 'title' }, logoCanvas()),
    h('div', { class: 'title-form' },
    nick,
    h('button', { class: 'big', testid: 'create', onclick: () => { take(); go(makeRoomCode(), true); } }, 'Create game'),
    h('div', { class: 'row' }, code, h('button', { testid: 'join', onclick: () => {
      const c = code.value.trim().toUpperCase();
      if (CODE_RE.test(c)) { take(); go(c, false); } else showTitle('Enter the 6-character room code');
    } }, 'Join with code')),
    error ? h('div', { class: 'err', testid: 'error' }, error) : null,
    h('div', { class: 'row' },
      h('button', { class: 'small', testid: 'sound', onclick: () => openPrefs() }, 'Sound'),
      h('button', { class: 'small', testid: 'help', onclick: () => openHelp() }, 'How to play'),
    ),
    ),
  ));
}

/** Opening an invite link asks for a nickname first, unless one is already saved. */
function askNick(code: string): void {
  const nick = h('input', { placeholder: 'Nickname', maxlength: 16, testid: 'nick' });
  const submit = () => { saveNick(nick.value.trim()); go(code, false); };
  clear(app);
  audio.setSong('title');
  app.append(titleArt(), h('div', { class: 'center title-screen', testid: 'nick-prompt' },
    h('h1', { class: 'title' }, logoCanvas()),
    h('div', { class: 'title-form' },
      h('div', {}, `You're invited to room ${code}`),
      nick,
      h('button', { class: 'big', testid: 'nick-go', onclick: submit }, 'Join game'),
    ),
  ));
  nick.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

// Every button gets a click. The ones that commit to something get a brighter sound.
document.addEventListener('click', (e) => {
  const b = (e.target as Element).closest?.('button');
  if (!b || b.disabled) return;
  const id = b.dataset.testid ?? '';
  if (id === 'modal-close') return;
  if (id === 'ready' || id === 'create' || id === 'join' || id === 'nick-go' || id === 'rematch') audio.play('confirm');
  else if (id === 'leave') audio.play('cancel');
  else audio.play('click');
}, { capture: true });

const route = location.pathname.match(/^\/r\/([^/]+)$/);
if (location.pathname === '/dev/sprites') void import('./ui/dev-sprites').then((x) => x.showDevSprites(app));
else if (query.has('practice')) void import('./game/practice').then((x) => x.startPractice(app));
else if (query.has('local')) void import('./game/start-local').then((x) => x.startLocal(app));
else if (route && CODE_RE.test(route[1].toUpperCase())) {
  const code = route[1].toUpperCase();
  if (nickname()) go(code, false); else askNick(code);
} else showTitle();
