// /dev/sprites: every sprite group, frame by frame, in every team's colours.
import { TEAMS, teamName } from '../../shared/data/teams';
import { ATLAS } from '../art/atlas';
import { CELL_H, CELL_W } from '../art/compose';
import { teamKit } from '../art/palette';
import type { BuildName } from '../art/parts';
import { GROUPS, POSES } from '../art/poses';
import { h } from './dom';

const SCALE = 3;

function sheet(team: string, away: boolean, skin: number, build: BuildName, names: string[]): HTMLCanvasElement {
  const frames = names.flatMap((n) => POSES[n].map((_, i) => [n, i] as const));
  const c = h('canvas', { width: frames.length * CELL_W, height: CELL_H, style: `width:${frames.length * CELL_W * SCALE}px;height:${CELL_H * SCALE}px;image-rendering:pixelated;background:#3f8a44` });
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const atlas = ATLAS.get(teamKit(team, away), skin);
  frames.forEach(([n, i], k) => atlas.draw(g, build, n, i, k * CELL_W + CELL_W / 2, CELL_H - 1, 1));
  return c;
}

const groupBuild = (g: typeof GROUPS[number], name: string): BuildName => (!g.sideline ? g.build : name === 'photoIdle' ? 'photo' : name === 'benchIdle' ? 'std' : 'coach');

export function showDevSprites(parent: HTMLElement): void {
  document.title = 'Sprites';
  document.body.style.overflow = 'auto';
  document.documentElement.style.overflow = 'auto';
  const groups = h('div', { testid: 'sprite-groups' });
  const pick = h('select', { testid: 'sprite-team' });
  for (const t of TEAMS) pick.append(h('option', { value: t.id }, teamName(t)));
  const awayBox = h('input', { type: 'checkbox', testid: 'sprite-away' });
  const drawGroups = () => {
    groups.replaceChildren();
    const team = pick.value;
    GROUPS.forEach((g, n) => {
      const row = h('div', { class: 'sprite-row', testid: `sprite-group-${n}` }, h('h3', {}, `${n + 1}. ${g.name}`), h('div', { class: 'dim' }, g.frames.join(', ')));
      const strip = h('div', { class: 'row', style: 'justify-content:flex-start' });
      for (const name of g.frames) strip.append(sheet(team, awayBox.checked, n % 4, groupBuild(g, name), [name]));
      row.append(strip);
      groups.append(row);
    });
  };
  pick.addEventListener('change', drawGroups);
  awayBox.addEventListener('change', drawGroups);
  // One line per team: home, away, and each skin tone, so colour clashes show at a glance.
  const everyTeam = h('div', { testid: 'sprite-teams' });
  const LINE = ['stance', 'runBall', 'block', 'kneel'];
  for (const t of TEAMS) {
    const line = h('div', { class: 'row', style: 'justify-content:flex-start;align-items:center' }, h('span', { style: 'width:13em' }, teamName(t)));
    line.append(sheet(t.id, false, 0, 'std', LINE), sheet(t.id, false, 2, 'big', LINE), sheet(t.id, true, 1, 'std', LINE), sheet(t.id, true, 3, 'big', LINE));
    everyTeam.append(line);
  }
  parent.append(h('div', { class: 'dev-sprites', testid: 'dev-sprites' },
    h('h2', {}, 'Sprites'),
    h('div', { class: 'row', style: 'justify-content:flex-start' }, pick, h('label', {}, awayBox, ' Away kit')),
    groups,
    h('h2', {}, 'Every team'),
    everyTeam,
  ));
  drawGroups();
}
