// The lobby: both players' rows, the team menu and the match settings tab.
import { CONFIG_OPTIONS, PRESETS, REAL_MINUTES, type MatchConfig } from '../../shared/data/config';
import { adjustScore } from '../../shared/data/roster';
import { DIVISIONS, TEAMS, TEAM_BY_ID, teamName, type Team } from '../../shared/data/teams';
import type { RoomView, Seat, SeatView } from '../../shared/protocol';
import { clear, h } from './dom';

export interface LobbyActions {
  setConfig(p: Partial<MatchConfig>): void;
  pickTeam(id: string): void;
  ready(on: boolean): void;
  ptr(x: number, y: number): void;
  sound(): void;
  help(): void;
}

type Sort = 'division' | 'off' | 'def';
type Tab = 'teams' | 'settings';

interface Group { title: string; items: { key: keyof MatchConfig; label: string; names?: Record<string, string> }[] }

const ON_OFF = { true: 'On', false: 'Off' };
const GROUPS: Group[] = [
  { title: 'TIME', items: [
    { key: 'quarter', label: 'Quarter length', names: { 1: '1', 2: '2', 3: '3', 5: '5 min' } },
    { key: 'playClock', label: 'Play clock', names: { 10: '10', 15: '15', 25: '25 s' } },
    { key: 'twoMinute', label: 'Two-minute warning', names: ON_OFF },
    { key: 'timeouts', label: 'Timeouts per half', names: { auto: 'Auto' } },
    { key: 'audibles', label: 'Audibles per half' },
    { key: 'pauses', label: 'Pauses per player' },
    { key: 'reconnect', label: 'Reconnect wait', names: { 1: '1', 2: '2', 5: '5 min' } },
  ] },
  { title: 'RULES', items: [
    { key: 'difficulty', label: 'Difficulty', names: { easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' } },
    { key: 'overtime', label: 'Overtime', names: { standard: 'Standard', sudden: 'Sudden', off: 'Off' } },
    { key: 'returns', label: 'Kick returns', names: { live: 'Live', touchback: 'Touchback only' } },
    { key: 'onside', label: 'Onside kicks', names: ON_OFF },
    { key: 'twoPoint', label: 'Two-point tries', names: ON_OFF },
    { key: 'penalties', label: 'Penalties', names: ON_OFF },
    { key: 'fumbles', label: 'Fumbles', names: { off: 'Off', normal: 'Normal', high: 'High' } },
    { key: 'bullet', label: 'Bullet passes', names: ON_OFF },
    { key: 'trucking', label: 'Trucking', names: ON_OFF },
    { key: 'fatigue', label: 'Fatigue', names: ON_OFF },
    { key: 'injuries', label: 'Injuries', names: ON_OFF },
  ] },
  { title: 'TEAMS AND CONDITIONS', items: [
    { key: 'ratings', label: 'Team ratings', names: { real: 'Real', compressed: 'Compressed', equal: 'Equal' } },
    { key: 'weather', label: 'Weather', names: { clear: 'Clear', rain: 'Rain', snow: 'Snow', wind: 'Wind', random: 'Random' } },
    { key: 'aimCursor', label: 'Aim cursor', names: { fades: 'Fades', full: 'Always full' } },
    { key: 'replays', label: 'Replays', names: { off: 'Off', big: 'Big plays', all: 'All scores' } },
  ] },
];

const BAR_CELLS = 10;

function bar(score: number): HTMLElement {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(((score - 60) / 39) * BAR_CELLS)));
  const el = h('span', { class: 'bar' });
  for (let i = 0; i < BAR_CELLS; i++) el.append(h('i', { class: i < filled ? 'on' : '' }));
  return el;
}

export class Lobby {
  root: HTMLElement;
  private players = h('div', { class: 'players' });
  private tabs = h('div', { class: 'tabs' });
  private body = h('div', { class: 'lobby-body' });
  private rivalDot = h('div', { class: 'rival-ptr', testid: 'rival-ptr' });
  private soundBtn: HTMLButtonElement;
  private tab: Tab = 'teams';
  private sort: Sort = 'division';
  private room: RoomView | null = null;
  private seat: Seat | null = null;
  private lastPtr = 0;
  private lastBody = '';

  constructor(parent: HTMLElement, private code: string, private a: LobbyActions, startTab?: Tab) {
    if (startTab) this.tab = startTab;
    const link = `${location.origin}/r/${code}`;
    const copy = h('button', { testid: 'copy-link', onclick: () => {
      const done = () => { copy.textContent = 'Copied!'; setTimeout(() => { copy.textContent = 'Copy invite link'; }, 1500); };
      if (navigator.clipboard) void navigator.clipboard.writeText(link).then(done, () => prompt('Invite link', link));
      else prompt('Invite link', link);
    } }, 'Copy invite link');
    this.soundBtn = h('button', { testid: 'sound', class: 'small', onclick: () => a.sound() }, 'Sound');
    this.root = h('div', { class: 'lobby', testid: 'lobby' },
      h('header', { class: 'lobby-top' },
        h('span', { class: 'brand' }, 'BORG BOWL'),
        h('span', { class: 'room-tag' }, 'ROOM ', h('b', { testid: 'room-code' }, code)),
        copy, h('span', { class: 'spacer' }), this.soundBtn,
        h('button', { class: 'small', testid: 'help', onclick: () => a.help() }, '?'),
      ),
      this.players, this.tabs, this.body, this.rivalDot,
    );
    this.root.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - this.lastPtr < 66) return;
      this.lastPtr = now;
      const r = this.root.getBoundingClientRect();
      a.ptr((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
    parent.append(this.root);
  }

  showRivalPointer(x: number, y: number): void {
    this.rivalDot.style.display = 'block';
    this.rivalDot.style.left = `${x * 100}%`;
    this.rivalDot.style.top = `${y * 100}%`;
  }

  update(room: RoomView, seat: Seat | null): void {
    this.room = room;
    this.seat = seat;
    this.renderPlayers();
    this.renderTabs();
    this.renderBody();
  }

  private renderPlayers(): void {
    const { room, seat } = this;
    if (!room) return;
    clear(this.players);
    for (const i of [0, 1] as Seat[]) {
      const s: SeatView | null = room.seats[i];
      const mine = i === seat;
      const team = s?.team ? TEAM_BY_ID[s.team] : null;
      const off = team ? adjustScore(team.off, room.config.ratings) : 0;
      const def = team ? adjustScore(team.def, room.config.ratings) : 0;
      const tag = `${mine ? 'YOU' : 'RIVAL'}${i === 0 ? ' (host)' : ''}`;
      this.players.append(h('div', { class: `player-row${mine ? ' mine' : ''}`, testid: `seat-${i}` },
        h('span', { class: 'who' }, `${tag}:`),
        h('span', { class: 'nick' }, s ? `${s.nick}${s.online ? '' : ' (offline)'}` : 'waiting for a rival...'),
        h('span', { class: 'status-word' }, s ? (s.online ? 'online' : 'offline') : ''),
        h('span', { class: 'team', testid: `seat-team-${i}` }, team ? teamName(team) : s ? 'no team yet' : ''),
        h('span', { class: 'scores' }, team ? `OFF ${off}  DEF ${def}` : ''),
        mine
          ? h('button', { class: `ready${s?.ready ? ' is-ready' : ''}`, testid: 'ready', disabled: !s?.team, onclick: () => this.a.ready(!s?.ready) }, s?.ready ? 'READY ✓' : 'READY')
          : h('span', { class: `ready-word${s?.ready ? ' is-ready' : ''}`, testid: `rival-ready` }, s?.ready ? 'ready' : 'not ready'),
      ));
    }
  }

  private renderTabs(): void {
    clear(this.tabs);
    const tab = (id: Tab, label: string) => h('button', { class: `tab${this.tab === id ? ' on' : ''}`, testid: `tab-${id}`, onclick: () => { this.tab = id; this.lastBody = ''; this.renderTabs(); this.renderBody(); } }, label);
    this.tabs.append(tab('teams', 'TEAMS'), tab('settings', 'MATCH SETTINGS'), h('span', { class: 'spacer' }));
    if (this.tab === 'teams') {
      this.tabs.append(h('span', { class: 'dim' }, 'Sort by:'));
      const sortBtn = (id: Sort, label: string) => h('button', { class: `tab small${this.sort === id ? ' on' : ''}`, testid: `sort-${id}`, onclick: () => { this.sort = id; this.lastBody = ''; this.renderTabs(); this.renderBody(); } }, label);
      this.tabs.append(sortBtn('division', 'Division'), sortBtn('off', 'OFF'), sortBtn('def', 'DEF'));
    } else {
      const c = this.room?.config;
      if (c) this.tabs.append(h('span', { class: 'dim', testid: 'estimate' }, `About ${REAL_MINUTES[c.quarter]} min a game`));
    }
  }

  private renderBody(): void {
    if (!this.room) return;
    const key = `${this.tab}:${this.sort}:${JSON.stringify(this.room.config)}:${this.room.seats.map((s) => `${s?.team}:${s?.ready}`).join()}:${this.seat}`;
    if (key === this.lastBody) return;
    this.lastBody = key;
    const scroll = this.body.scrollTop;
    clear(this.body);
    if (this.tab === 'teams') this.renderTeams();
    else this.renderSettings();
    this.body.scrollTop = scroll;
  }

  private renderTeams(): void {
    const { room, seat } = this;
    if (!room) return;
    const mine = seat === null ? null : room.seats[seat];
    const locked = !!mine?.ready;
    const rivalTeam = seat === null ? null : room.seats[(1 - seat) as Seat]?.team;
    const row = (t: Team) => {
      const off = adjustScore(t.off, room.config.ratings);
      const def = adjustScore(t.def, room.config.ratings);
      const picked = mine?.team === t.id;
      return h('button', { class: `team-row${picked ? ' picked' : ''}`, testid: `team-${t.id}`, disabled: locked, onclick: () => this.a.pickTeam(t.id) },
        h('span', { class: 'swatch', style: `background:${t.primary};border-color:${t.secondary}` }),
        h('span', { class: 'team-name' }, `${picked ? '> ' : ''}${teamName(t)}${rivalTeam === t.id ? ' (rival)' : ''}`),
        h('span', { class: 'num' }, `OFF ${off}`), bar(off),
        h('span', { class: 'num' }, `DEF ${def}`), bar(def),
      );
    };
    if (this.sort === 'division') {
      for (const d of DIVISIONS) {
        this.body.append(h('div', { class: 'division' }, d.toUpperCase()));
        for (const t of TEAMS) if (`${t.conf} ${t.division}` === d) this.body.append(row(t));
      }
    } else {
      const sorted = [...TEAMS].sort((x, y) => (this.sort === 'off' ? y.off - x.off : y.def - x.def) || x.id.localeCompare(y.id));
      for (const t of sorted) this.body.append(row(t));
    }
  }

  private renderSettings(): void {
    const { room, seat } = this;
    if (!room) return;
    const host = seat === 0;
    const c = room.config;
    const presets = h('div', { class: 'presets' }, h('span', { class: 'dim' }, 'Presets:'));
    for (const [id, label] of [['quick', 'Quick'], ['standard', 'Standard'], ['long', 'Long']] as const) {
      const p = PRESETS[id];
      const on = Object.entries(p).every(([k, v]) => c[k as keyof MatchConfig] === v);
      presets.append(h('button', { class: `opt${on ? ' on' : ''}`, testid: `preset-${id}`, disabled: !host, onclick: () => this.a.setConfig(p) }, label));
    }
    if (!host) presets.append(h('span', { class: 'dim', testid: 'readonly' }, 'The host sets these.'));
    this.body.append(presets);
    const grid = h('div', { class: 'settings' });
    for (const g of GROUPS) {
      const col = h('section', {}, h('h3', {}, g.title));
      for (const it of g.items) {
        const opts = CONFIG_OPTIONS[it.key] as readonly (string | number | boolean)[];
        const row = h('div', { class: 'opts' });
        for (const o of opts) {
          const label = it.names?.[String(o)] ?? String(o);
          row.append(h('button', {
            class: `opt${c[it.key] === o ? ' on' : ''}`, testid: `cfg-${it.key}-${String(o)}`, disabled: !host,
            onclick: () => this.a.setConfig({ [it.key]: o } as Partial<MatchConfig>),
          }, label));
        }
        col.append(h('div', { class: 'opt-line' }, h('span', { class: 'opt-label' }, it.label), row));
      }
      grid.append(col);
    }
    this.body.append(grid);
  }

  destroy(): void { this.root.remove(); }
}
