// The ?dev=1 tools: live tuning, the bot switch, forced events and a download of the last play.
import { T } from '../../shared/sim/tuning';
import { h } from './dom';

export type ForceKind = 'int' | 'fumble' | 'sack';

export interface DevActions {
  bot?: { get(): boolean; set(on: boolean): void };
  force?(what: ForceKind): void;
  lowClock?(): void;
  download?(): void;
}

interface Field { path: string; owner: Record<string, unknown>; key: string; base: number }

/** Every number in the tuning object, by its dotted path. */
export function tuningFields(root: object = T, prefix = ''): Field[] {
  const out: Field[] = [];
  for (const [key, v] of Object.entries(root)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof v === 'number') out.push({ path, owner: root as Record<string, unknown>, key, base: v });
    else if (v && typeof v === 'object') out.push(...tuningFields(v, path));
  }
  return out;
}

export function tuningChanges(fields: Field[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) if (f.owner[f.key] !== f.base) out[f.path] = f.owner[f.key] as number;
  return out;
}

let changesNow: () => Record<string, number> = () => ({});
/** The values edited so far, for bug reports. */
export const devTuningChanges = (): Record<string, number> => changesNow();

export interface DevPanel { note(text: string): void; destroy(): void }

export function mountDevPanel(parent: HTMLElement, a: DevActions): DevPanel {
  const fields = tuningFields();
  changesNow = () => tuningChanges(fields);
  (window as unknown as { __T: typeof T }).__T = T;

  const noteEl = h('div', { class: 'dim', testid: 'dev-note' }, '');
  const note = (text: string) => { noteEl.textContent = text; };
  const list = h('div', { class: 'dev-list', testid: 'dev-tuning' });
  const inputs = new Map<Field, HTMLInputElement>();
  for (const f of fields) {
    const input = h('input', { type: 'number', step: 'any', value: f.base, testid: `tune-${f.path}` }) as HTMLInputElement;
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (input.value === '' || !Number.isFinite(n)) { input.value = String(f.owner[f.key]); return; }
      f.owner[f.key] = n;
      input.classList.toggle('changed', n !== f.base);
    });
    inputs.set(f, input);
    list.append(h('label', { class: 'dev-line', 'data-path': f.path }, h('span', {}, f.path), input));
  }
  const filter = h('input', { type: 'search', placeholder: 'Filter', testid: 'dev-filter' }) as HTMLInputElement;
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const row of list.children) (row as HTMLElement).style.display = (row as HTMLElement).dataset.path!.toLowerCase().includes(q) ? '' : 'none';
  });
  const resetAll = () => {
    for (const [f, input] of inputs) { f.owner[f.key] = f.base; input.value = String(f.base); input.classList.remove('changed'); }
    note('Back to the saved values.');
  };
  const copyChanges = () => {
    const text = JSON.stringify(tuningChanges(fields), null, 2);
    void navigator.clipboard?.writeText(text).catch(() => {});
    note(text === '{}' ? 'No changes yet.' : `Copied: ${text.replace(/\s+/g, ' ')}`);
  };

  const buttons = h('div', { class: 'dev-buttons' });
  if (a.bot) {
    const bot = a.bot;
    const btn = h('button', { class: 'small', testid: 'dev-bot', onclick: () => { bot.set(!bot.get()); paint(); } }, '');
    const paint = () => { btn.textContent = `Bot: ${bot.get() ? 'on' : 'off'}`; btn.classList.toggle('on', bot.get()); };
    paint();
    buttons.append(btn);
  }
  const force = a.force;
  if (force) {
    for (const [what, label] of [['int', 'Interception'], ['fumble', 'Fumble'], ['sack', 'Sack']] as const) {
      buttons.append(h('button', { class: 'small', testid: `dev-force-${what}`, onclick: () => { force(what); note(`${label} armed. It stays on until it happens on one of your plays.`); } }, label));
    }
  }
  if (a.lowClock) {
    const low = a.lowClock;
    buttons.append(h('button', { class: 'small', testid: 'dev-low-clock', onclick: () => { low(); note(`Clock set to 0:${String(T.dev.lowClock).padStart(2, '0')}.`); } }, 'Low clock'));
  }
  if (a.download) buttons.append(h('button', { class: 'small', testid: 'dev-download', onclick: a.download }, 'Download last play'));

  const panel = h('div', { class: 'dev-panel', testid: 'dev-panel' },
    buttons, noteEl,
    h('div', { class: 'dev-buttons' }, filter, h('button', { class: 'small', testid: 'dev-reset', onclick: resetAll }, 'Reset'), h('button', { class: 'small', testid: 'dev-copy', onclick: copyChanges }, 'Copy changes')),
    list,
  );
  const toggle = h('button', { class: 'dev-toggle', testid: 'dev-toggle', onclick: () => panel.classList.toggle('open') }, 'DEV');
  parent.append(toggle, panel);
  return { note, destroy: () => { toggle.remove(); panel.remove(); } };
}
