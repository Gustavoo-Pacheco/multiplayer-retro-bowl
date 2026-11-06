// The player settings and help panels, opened from the lobby or the match menu.
import { audio } from '../audio/engine';
import { clear, h } from './dom';
import { prefs, setPref } from './prefs';

function modal(testid: string, title: string, ...body: (Node | null)[]): void {
  document.querySelector('.modal')?.remove();
  const close = () => { audio.play('cancel'); root.remove(); };
  const root = h('div', { class: 'modal', testid },
    h('div', { class: 'modal-box menu-panel' },
      h('h2', {}, title),
      ...body,
      h('button', { testid: 'modal-close', onclick: close }, 'Close'),
    ),
  );
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  document.body.append(root);
}

function slider(key: 'sound' | 'music', label: string): HTMLElement {
  const input = h('input', { type: 'range', min: 0, max: 10, step: 1, value: Math.round(prefs[key] * 10), testid: `pref-${key}` });
  const value = h('span', { class: 'pref-value' }, String(Math.round(prefs[key] * 10)));
  input.addEventListener('input', () => {
    setPref(key, Number(input.value) / 10);
    value.textContent = input.value;
  });
  input.addEventListener('change', () => { if (key === 'sound') audio.play('confirm'); });
  return h('label', { class: 'pref-line' }, h('span', {}, label), input, value);
}

function toggle(key: 'nameTags' | 'starMarkers' | 'fullscreen', label: string): HTMLElement {
  const b = h('button', { class: 'opt', testid: `pref-${key}`, onclick: () => { setPref(key, !prefs[key]); paint(); } });
  const paint = () => { b.textContent = prefs[key] ? 'On' : 'Off'; b.classList.toggle('on', prefs[key]); };
  paint();
  return h('div', { class: 'pref-line' }, h('span', {}, label), b);
}

export function openPrefs(): void {
  modal('prefs', 'Settings', slider('sound', 'Sound'), slider('music', 'Music'),
    toggle('nameTags', 'Name tags'), toggle('starMarkers', 'Star markers'),
    'requestFullscreen' in document.documentElement ? toggle('fullscreen', 'Fullscreen') : null);
}

const CONTROLS: [string, string, string][] = [
  ["Call the coach's pick", 'Tap the big card', 'Space'],
  ['Call another play', 'Tap a tab, then a card', 'Q, E, then 1 to 6'],
  ['Snap', 'Tap the field', 'Space'],
  ['Timeout', 'Button', 'T'],
  ['Aim', 'Press, drag away from the target, hold', ''],
  ['Throw', 'Release', ''],
  ['Bullet pass', 'Second finger, or right button', 'Space while aiming'],
  ['Keep it on a run', 'Tap the QB before the handoff', 'Arrow'],
  ['QB run', 'Tap the QB', 'Arrow'],
  ['Juke', 'Swipe up or down', 'Up, Down, W, S'],
  ['Stiff arm', 'Swipe toward a nearby defender', 'Arrow toward them'],
  ['Dive', 'Swipe the way you are running', 'Arrow'],
  ['Slow down', 'Swipe back', 'Arrow back'],
  ['Truck', 'Press and hold still', 'Shift'],
  ['Kick', 'Tap, then tap', 'Space, Space'],
  ['Choices', 'Buttons', '1, 2, 3'],
];

export function openHelp(): void {
  const rows = h('tbody', {});
  clear(rows);
  for (const [a, b, c] of CONTROLS) rows.append(h('tr', {}, h('th', {}, a), h('td', {}, b), h('td', {}, c)));
  modal('help-panel', 'How to play',
    h('p', {}, 'Two players. Before each play both sides have seven seconds in the huddle to call a play, or the coach calls it for you. Whoever has the ball plays it, and the other one watches. The computer plays the defenders. If you intercept or recover a fumble, the ball is yours and your runner keeps going.'),
    h('div', { class: 'help-scroll' }, h('table', { class: 'help-table' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Mouse or touch'), h('th', {}, 'Keys'))), rows)),
  );
}
