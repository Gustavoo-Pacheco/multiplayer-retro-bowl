// The huddle: seven seconds to call a play. The coach's pick is one tap away; every other play is two at most.
import { DEF_CALLS, DEF_CATS, FORMATIONS, PLAY_CATS, PLAYBOOK, playsIn, rushers, type DefCall, type DefCat, type PlayCat } from '../../shared/data/playbook';
import { TEAM_BY_ID } from '../../shared/data/teams';
import type { CallSide } from '../../shared/rules/match';
import { audio } from '../audio/engine';
import { lum } from '../art/palette';
import { defenseArt, playArt } from '../render/playart';
import { clear, h } from './dom';

/** What the panel shows. 'call' is a side to pick for; 'locked' waits for the other side; 'watch' is someone else calling. */
export type PlaybookView =
  | { mode: 'call'; key: string; side: CallSide; team: string; suggest: number; situation: string; last: string; deadline: number; total: number; keys: boolean }
  | { mode: 'locked'; key: string; side: CallSide; team: string; id: number; situation: string; last: string; deadline: number; total: number; waitingFor: string }
  | { mode: 'watch'; key: string; text: string; deadline: number; total: number };

interface CardInfo { id: number; name: string; sub: string; tip: string; art: string }

/** How many come and how many stay back: the two numbers a defensive caller weighs. */
function shell(c: DefCall): string {
  const deep = c.jobs.filter((j) => j.k === 'deep' || (j.k === 'zone' && j.z.deep)).length;
  return `${rushers(c)} RUSH, ${deep ? `${deep} DEEP` : 'NO DEEP'}`;
}

function cardFor(side: CallSide, id: number, big: boolean): CardInfo {
  if (side === 'off') {
    const p = PLAYBOOK[id];
    const gain = p.gain[1] >= 20 ? `${p.gain[0]}-${p.gain[1]}+` : `${p.gain[0]}-${p.gain[1]}`;
    return { id, name: p.name, sub: `${FORMATIONS[p.formation].name}  ${gain} YDS`, tip: p.tip, art: big ? playArt(id, 76, 44) : playArt(id, 68, 32) };
  }
  const c = DEF_CALLS[id];
  return { id, name: c.name, sub: shell(c), tip: c.tip, art: big ? defenseArt(id, 76, 44) : defenseArt(id, 68, 70) };
}

const catOf = (side: CallSide, id: number): string => (side === 'off' ? PLAYBOOK[id].cat : DEF_CALLS[id].cat);
const idsIn = (side: CallSide, cat: string): number[] =>
  side === 'off' ? playsIn(cat as PlayCat).map((p) => p.id) : DEF_CALLS.filter((c) => c.cat === (cat as DefCat)).map((c) => c.id);
const catsFor = (side: CallSide): { id: string; label: string }[] => (side === 'off' ? PLAY_CATS : DEF_CATS);

const CHOSEN_MS = 320;

export class PlaybookPanel {
  root: HTMLDivElement;
  private shownKey = '';
  private view: PlaybookView | null = null;
  private tab = '';
  private grid: HTMLDivElement | null = null;
  private tabs: HTMLButtonElement[] = [];
  private bar: HTMLElement | null = null;
  private digits: HTMLElement | null = null;
  private lastSec = -1;
  private sent = false;
  /** When the call went in: the chosen card flashes this long before the panel moves on. */
  private sentAt = 0;
  private leaving = 0;

  constructor(parent: HTMLElement, private onCall: (side: CallSide, id: number) => void) {
    this.root = h('div', { class: 'pb-layer', testid: 'playbook-layer' });
    parent.append(this.root);
  }

  /** Called every frame. The panel rebuilds only when what it shows changes. */
  show(v: PlaybookView | null, now: number): void {
    const flashing = this.sent && now < this.sentAt + CHOSEN_MS;
    if (flashing && v?.key !== this.shownKey) { this.tick(now); return; }
    if (!v) {
      if (this.view && !this.leaving) this.leave(now);
      if (this.leaving && now >= this.leaving) { clear(this.root); this.leaving = 0; this.view = null; this.shownKey = ''; }
      return;
    }
    if (v.key !== this.shownKey) this.build(v);
    this.view = v;
    this.tick(now);
  }

  private leave(now: number): void {
    const el = this.root.firstElementChild as HTMLElement | null;
    if (!el || this.view?.mode === 'watch') { this.leaving = now; return; }
    el.classList.add('pb-break');
    this.leaving = now + 420;
    this.grid = null;
  }

  private build(v: PlaybookView): void {
    // Locking in a call swaps the panel's contents where it stands, rather than sliding a new one in.
    const prev = this.view;
    const still = v.mode === 'locked' && !!prev && prev.mode !== 'watch' && prev.side === v.side && !this.leaving;
    this.shownKey = v.key;
    this.leaving = 0;
    this.sent = false;
    this.lastSec = -1;
    clear(this.root);
    this.grid = null;
    this.tabs = [];
    if (v.mode === 'watch') {
      this.digits = h('b', { class: 'pb-digits' });
      this.bar = h('i', {});
      this.root.append(h('div', { class: 'pb-watch', testid: 'playbook-watch' }, h('span', {}, v.text), this.digits, h('div', { class: 'pb-bar' }, this.bar)));
      return;
    }
    const team = TEAM_BY_ID[v.team];
    const ink = lum(team.primary) > 0.62 ? '#14181c' : '#ffffff';
    const sideWord = v.side === 'off' ? 'OFFENSE' : 'DEFENSE';
    this.digits = h('b', { class: 'pb-digits', testid: 'playbook-timer' });
    this.bar = h('i', {});
    const head = h('div', { class: 'pb-head' },
      h('span', { class: 'pb-team', style: `background:${team.primary};color:${ink};border-color:${team.secondary}` }, `${team.id} ${sideWord}`),
      h('span', { class: 'pb-sit' }, v.situation),
      h('span', { class: 'pb-spacer' }),
      v.last ? h('span', { class: 'pb-last', testid: 'playbook-last' }, v.last) : null,
      this.digits,
    );
    const panel = h('div', { class: `pb pb-${v.side}${still ? ' pb-still' : ''}`, testid: 'playbook', 'data-side': v.side }, head, h('div', { class: 'pb-bar' }, this.bar));
    if (v.mode === 'locked') {
      const c = cardFor(v.side, v.id, true);
      panel.append(h('div', { class: 'pb-locked', testid: 'playbook-locked' },
        h('img', { class: 'pb-art', src: c.art, alt: '' }),
        h('div', { class: 'pb-locked-text' },
          h('span', { class: 'pb-chip' }, 'LOCKED IN'),
          h('b', { class: 'pb-name' }, c.name),
          h('span', { class: 'pb-sub' }, c.sub),
          h('span', { class: 'pb-wait' }, v.waitingFor),
        ),
      ));
      this.root.append(panel);
      return;
    }
    const coach = cardFor(v.side, v.suggest, true);
    const pick = h('button', { class: 'pb-coach', testid: 'playbook-coach', 'data-id': v.suggest, onclick: () => this.call(v.side, v.suggest) },
      h('span', { class: 'pb-chip' }, "COACH'S PICK"),
      h('img', { class: 'pb-art', src: coach.art, alt: '' }),
      h('b', { class: `pb-name${coach.name.length > 10 ? ' long' : ''}` }, coach.name),
      h('span', { class: 'pb-sub' }, coach.sub),
      h('span', { class: 'pb-tip' }, coach.tip),
      h('span', { class: 'pb-go' }, v.keys ? 'SPACE TO CALL' : 'TAP TO CALL'),
    );
    const tabRow = h('div', { class: 'pb-tabs', role: 'tablist' }, v.keys ? h('span', { class: 'pb-key' }, 'Q') : null);
    for (const c of catsFor(v.side)) {
      const b = h('button', { class: 'pb-tab', role: 'tab', testid: `playbook-tab-${c.id}`, 'data-cat': c.id, onclick: () => { audio.play('click'); this.setTab(c.id); } }, c.label);
      this.tabs.push(b);
      tabRow.append(b);
    }
    if (v.keys) tabRow.append(h('span', { class: 'pb-key' }, 'E'));
    this.grid = h('div', { class: `pb-grid pb-grid-${v.side}` });
    panel.append(h('div', { class: 'pb-body' }, pick, h('div', { class: 'pb-right' }, tabRow, this.grid)));
    this.root.append(panel);
    this.setTab(catOf(v.side, v.suggest));
  }

  private setTab(cat: string): void {
    const v = this.view && this.view.key === this.shownKey ? this.view : null;
    const side = (this.root.querySelector('.pb') as HTMLElement | null)?.dataset.side as CallSide | undefined;
    if (!this.grid || !side) return;
    this.tab = cat;
    for (const b of this.tabs) b.classList.toggle('on', b.dataset.cat === cat);
    clear(this.grid);
    const suggest = v && v.mode === 'call' ? v.suggest : Number((this.root.querySelector('.pb-coach') as HTMLElement | null)?.dataset.id ?? -1);
    idsIn(side, cat).forEach((id, n) => {
      const c = cardFor(side, id, false);
      this.grid!.append(h('button', { class: `pb-card${id === suggest ? ' pb-pick' : ''}`, testid: `play-${side}-${id}`, title: c.tip, onclick: () => this.call(side, id) },
        h('img', { class: 'pb-art', src: c.art, alt: '' }),
        h('span', { class: 'pb-row' }, h('em', {}, String(n + 1)), h('b', { class: 'pb-name' }, c.name)),
        h('span', { class: 'pb-sub' }, side === 'off' ? c.sub : c.tip),
        side === 'def' ? h('span', { class: 'pb-shell' }, c.sub) : null,
      ));
    });
  }

  private call(side: CallSide, id: number): void {
    if (this.sent || this.view?.mode !== 'call') return;
    this.sent = true;
    this.sentAt = performance.now();
    audio.play('confirm');
    this.root.querySelectorAll('button').forEach((b) => { (b as HTMLButtonElement).disabled = true; });
    const card = this.root.querySelector(`[data-testid="play-${side}-${id}"]`) ?? (id === this.view.suggest ? this.root.querySelector('.pb-coach') : null);
    card?.classList.add('pb-chosen');
    this.onCall(side, id);
  }

  private tick(now: number): void {
    const v = this.view;
    if (!v || !this.bar || !this.digits) return;
    const left = Math.max(0, v.deadline - now);
    const f = Math.max(0, Math.min(1, left / v.total));
    // In steps, like everything else on screen.
    this.bar.style.width = `${(Math.round(f * 150) / 150) * 100}%`;
    const sec = Math.ceil(left / 1000);
    if (sec !== this.lastSec) {
      this.lastSec = sec;
      this.digits.textContent = String(sec);
      const hot = sec <= 3;
      this.digits.classList.toggle('hot', hot);
      this.bar.classList.toggle('hot', hot);
      if (hot && sec > 0 && v.mode === 'call' && !this.sent) audio.play('meterTick');
    }
  }

  /** Calls a play as if it were tapped, for a bot. */
  pick(id: number): void { const v = this.view; if (v?.mode === 'call') { if (id !== v.suggest) this.setTab(catOf(v.side, id)); this.call(v.side, id); } }

  /** The keyboard, while the panel takes picks. Returns true if it used the key. */
  key(e: KeyboardEvent): boolean {
    const v = this.view;
    if (!v || v.mode !== 'call' || this.sent || this.leaving) return false;
    if (e.code === 'Space' || e.key === 'Enter') { if (!e.repeat) this.call(v.side, v.suggest); return true; }
    const cats = catsFor(v.side).map((c) => c.id);
    const at = cats.indexOf(this.tab);
    if (e.key === 'q' || e.key === 'Q' || e.key === 'ArrowLeft') { audio.play('click'); this.setTab(cats[(at + cats.length - 1) % cats.length]); return true; }
    if (e.key === 'e' || e.key === 'E' || e.key === 'ArrowRight' || e.key === 'Tab') { audio.play('click'); this.setTab(cats[(at + 1) % cats.length]); return true; }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= 6) {
      const ids = idsIn(v.side, this.tab);
      if (ids[n - 1] !== undefined) this.call(v.side, ids[n - 1]);
      return true;
    }
    return false;
  }

  /** Whether it's showing picks to make, which takes the keys and pointer away from the field. */
  get open(): boolean { return this.view?.mode === 'call' && !this.leaving; }

  /** Whether this call is on screen and still open, after any flash of the last call. */
  showing(key: string): boolean { return this.shownKey === key && !this.sent && !this.leaving; }

  destroy(): void { this.root.remove(); }
}
