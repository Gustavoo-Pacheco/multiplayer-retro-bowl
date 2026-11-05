// The final score screen.
import { teamName, TEAM_BY_ID } from '../../shared/data/teams';
import type { MatchState } from '../../shared/rules/match';
import type { Seat } from '../../shared/sim/state';
import { clear, h } from './dom';

export interface FinalActions { rematch(): void; leave(): void }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function showFinal(parent: HTMLElement, m: MatchState, me: Seat | null, a: FinalActions): HTMLElement {
  parent.querySelector('.final')?.remove();
  const name = (s: Seat) => teamName(TEAM_BY_ID[m.teams[s]]);
  let headline: string;
  if (m.winner === 'tie') headline = 'TIE GAME';
  else if (m.winner !== null && me !== null) headline = m.winner === me ? 'YOU WIN!' : 'YOU LOSE';
  else headline = `${name(m.winner as Seat).toUpperCase()} WIN`;
  const periods = m.scoreByPeriod[0].length;
  const headRow = h('tr', {}, h('th', {}, ''));
  for (let i = 0; i < periods; i++) headRow.append(h('th', {}, i >= 4 ? 'OT' : `Q${i + 1}`));
  headRow.append(h('th', {}, 'T'));
  const row = (s: Seat) => {
    const r = h('tr', {}, h('td', { class: 'tn' }, TEAM_BY_ID[m.teams[s]].id));
    for (let i = 0; i < periods; i++) r.append(h('td', {}, String(m.scoreByPeriod[s][i] ?? 0)));
    r.append(h('td', { class: 'tot', testid: `final-score-${s}` }, String(m.score[s])));
    return r;
  };
  const stat = (label: string, f: (s: Seat) => string) => h('tr', {}, h('td', {}, f(0)), h('th', {}, label), h('td', {}, f(1)));
  const root = h('div', { class: 'final menu-panel', testid: 'final' },
    h('h2', { testid: 'final-headline' }, headline),
    m.conceded !== null ? h('div', { class: 'dim' }, `${name(m.conceded)} conceded`) : null,
    h('table', { class: 'score-table' }, h('thead', {}, headRow), h('tbody', {}, row(0), row(1))),
    h('table', { class: 'stat-table' }, h('tbody', {},
      h('tr', {}, h('td', {}, TEAM_BY_ID[m.teams[0]].id), h('th', {}, ''), h('td', {}, TEAM_BY_ID[m.teams[1]].id)),
      stat('Passing yards', (s) => String(m.stats[s].passYds)),
      stat('Rushing yards', (s) => String(m.stats[s].rushYds)),
      stat('Turnovers', (s) => String(m.stats[s].int + m.stats[s].fumLost)),
      stat('Sacks', (s) => String(m.stats[(1 - s) as Seat].sacks)),
      stat('Time of possession', (s) => mmss(m.stats[s].top)),
    )),
    h('div', { class: 'row' },
      h('button', { testid: 'rematch', onclick: () => a.rematch() }, 'Rematch'),
      h('button', { testid: 'leave', onclick: () => a.leave() }, 'Leave'),
    ),
  );
  parent.append(root);
  void clear;
  return root;
}
