// HTML buttons and dialogs layered over the canvas during a match.
import type { Choice, MatchState } from '../../shared/rules/match';
import { canAudible, canTimeout, fieldGoalInRange } from '../../shared/rules/match';
import type { Seat } from '../../shared/sim/state';
import { clear, h } from './dom';

export interface HudActions {
  audible(): void; timeout(): void; pause(): void; choice(c: Choice): void; concede(): void; claim(): void; skip(): void;
}

export class HudOverlay {
  root: HTMLDivElement;
  private dialog: HTMLDivElement;
  private buttons: HTMLDivElement;
  private status: HTMLDivElement;
  private lastDialog = '';
  private audibleBtn: HTMLButtonElement;
  private timeoutBtn: HTMLButtonElement;
  private pauseBtn: HTMLButtonElement;
  private menuBtn: HTMLButtonElement;
  private menu: HTMLDivElement;

  constructor(parent: HTMLElement, private a: HudActions) {
    this.root = h('div', { class: 'hud' });
    this.audibleBtn = h('button', { class: 'hud-btn', testid: 'btn-audible', onclick: () => a.audible() }, 'AUDIBLE');
    this.timeoutBtn = h('button', { class: 'hud-btn', testid: 'btn-timeout', onclick: () => a.timeout() }, 'TIMEOUT');
    this.pauseBtn = h('button', { class: 'hud-btn hud-pause', testid: 'btn-pause', onclick: () => a.pause() }, '||');
    this.menuBtn = h('button', { class: 'hud-btn hud-menu', testid: 'btn-menu', onclick: () => this.menu.classList.toggle('open') }, '...');
    this.menu = h('div', { class: 'hud-popup' },
      h('button', { testid: 'btn-concede', onclick: () => { this.menu.classList.remove('open'); a.concede(); } }, 'Concede the match'),
    );
    this.buttons = h('div', { class: 'hud-buttons' }, this.audibleBtn, this.timeoutBtn);
    this.dialog = h('div', { class: 'hud-dialog', testid: 'dialog' });
    this.status = h('div', { class: 'hud-status', testid: 'hud-status' });
    this.root.append(this.buttons, this.pauseBtn, this.menuBtn, this.menu, this.dialog, this.status);
    parent.append(this.root);
  }

  update(m: MatchState | null, me: Seat | null, controlling: boolean, paused: boolean, waiting: boolean): void {
    if (!m || me === null) {
      this.audibleBtn.style.display = 'none';
      this.timeoutBtn.style.display = 'none';
      return;
    }
    const can = controlling && !paused && !waiting;
    this.audibleBtn.style.display = can && m.phase === 'presnap' && m.play && (m.play.type === 'scrimmage' || m.play.type === 'twoPoint') ? '' : 'none';
    this.audibleBtn.disabled = !canAudible(m, me);
    this.audibleBtn.textContent = `AUDIBLE ${m.audibles[me]}`;
    this.timeoutBtn.style.display = can && (m.phase === 'presnap' || m.phase === 'choice4th') && m.play?.type !== 'kickoff' && m.play?.type !== 'freeKick' && m.play?.type !== 'onside' && m.play?.type !== 'extraPoint' && m.play?.type !== 'twoPoint' ? '' : 'none';
    this.timeoutBtn.disabled = !canTimeout(m, me);
    this.timeoutBtn.textContent = `TIMEOUT ${m.timeouts[me]}`;
    this.pauseBtn.disabled = !paused && (m.pauses[me] <= 0 || !['presnap', 'choice4th', 'conversion', 'kickChoice'].includes(m.phase));
    this.pauseBtn.textContent = paused ? '>' : '||';
    this.renderDialog(m, controlling && !paused && !waiting);
  }

  private renderDialog(m: MatchState, can: boolean): void {
    const key = can ? `${m.phase}:${m.down}:${m.possession}` : '';
    const show = can && (m.phase === 'choice4th' || m.phase === 'conversion' || m.phase === 'kickChoice');
    if (!show) { if (this.lastDialog) { clear(this.dialog); this.lastDialog = ''; this.dialog.classList.remove('open'); } return; }
    if (key === this.lastDialog) return;
    this.lastDialog = key;
    clear(this.dialog);
    this.dialog.classList.add('open');
    const pick = (c: Choice, label: string, key2: string, disabled = false) =>
      h('button', { testid: `choice-${c}`, disabled, onclick: () => this.a.choice(c) }, `${key2}  ${label}`);
    if (m.phase === 'choice4th') {
      this.dialog.append(h('div', { class: 'hud-q' }, `4TH & ${Math.round(m.toGo)}`),
        pick('go', 'Go for it', '1'), pick('punt', 'Punt', '2'), pick('fg', fieldGoalInRange(m) ? 'Field goal' : 'Field goal (long)', '3'));
    } else if (m.phase === 'conversion') {
      this.dialog.append(h('div', { class: 'hud-q' }, 'CONVERSION'), pick('kick', 'Kick the extra point', '1'), pick('two', 'Go for two', '2'));
    } else {
      this.dialog.append(h('div', { class: 'hud-q' }, m.kickKind === 'freeKick' ? 'FREE KICK' : 'KICKOFF'), pick('deep', 'Deep kick', '1'), pick('onside', 'Onside kick', '2'));
    }
  }

  /** Keyboard shortcut for the dialog's Nth button. */
  pressChoice(n: number): void {
    const b = this.dialog.querySelectorAll('button')[n - 1] as HTMLButtonElement | undefined;
    if (b && !b.disabled) b.click();
  }

  setStatus(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.style.display = text ? '' : 'none';
  }

  destroy(): void { this.root.remove(); }
}
