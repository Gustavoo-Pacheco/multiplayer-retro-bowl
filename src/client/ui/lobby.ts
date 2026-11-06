// The lobby: two team cards facing off, the wall of crests and the match settings tab.
import { CREST_H, CREST_W, crestURL, starRating, starsURL } from '../art/crests';
import { CONFIG_OPTIONS, PRESETS, realMinutes, type MatchConfig } from '../../shared/data/config';
import { adjustScore } from '../../shared/data/roster';
import { DIVISIONS, TEAMS, TEAM_BY_ID, type Team } from '../../shared/data/teams';
import type { RoomView, Seat } from '../../shared/protocol';
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

interface Item { key: keyof MatchConfig; label: string; unit?: string; names?: Record<string, string> }
interface Group { title: string; items: Item[] }

const ON_OFF = { true: 'On', false: 'Off' };
const TIME: Group = { title: 'TIME AND CALLS', items: [
  { key: 'quarter', label: 'Quarter length', unit: 'min' },
  { key: 'clock', label: 'Game clock', names: { stops: 'Stops', runs: 'Runs' } },
  { key: 'playClock', label: 'Play clock', unit: 'sec' },
  { key: 'twoMinute', label: 'Two-minute warning', names: ON_OFF },
  { key: 'timeouts', label: 'Timeouts per half', names: { auto: 'Auto' } },
  { key: 'defense', label: 'Defense calls', names: { players: 'Players', computer: 'Computer' } },
  { key: 'pauses', label: 'Pauses per player' },
  { key: 'reconnect', label: 'Reconnect wait', unit: 'min' },
] };
const RULES: Group = { title: 'RULES', items: [
  { key: 'difficulty', label: 'Difficulty', names: { easy: 'Easy', normal: 'Normal', hard: 'Hard', extreme: 'Extreme' } },
  { key: 'aimCursor', label: 'Aim cursor', names: { fades: 'Fades', full: 'Always full' } },
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
] };
const CONDITIONS: Group = { title: 'TEAMS AND CONDITIONS', items: [
  { key: 'ratings', label: 'Team ratings', names: { real: 'Real', compressed: 'Compressed', equal: 'Equal' } },
  { key: 'weather', label: 'Weather', names: { clear: 'Clear', rain: 'Rain', snow: 'Snow', wind: 'Wind', random: 'Random' } },
  { key: 'replays', label: 'Replays', names: { off: 'Off', big: 'Big plays', all: 'All scores' } },
] };
/** Eleven rows under two headings on the left and twelve under one on the right, so both columns end level. */
const COLUMNS: Group[][] = [[TIME, CONDITIONS], [RULES]];

const BAR_CELLS = 10;

function bar(score: number): HTMLElement {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.round(((score - 60) / 39) * BAR_CELLS)));
  const el = h('span', { class: 'bar' });
  for (let i = 0; i < BAR_CELLS; i++) el.append(h('i', { class: i < filled ? 'on' : '' }));
  return el;
}

function crest(t: Team, size: string): HTMLImageElement {
  return h('img', { class: `crest ${size}`, src: crestURL(t.id), alt: '', width: CREST_W, height: CREST_H, draggable: 'false' });
}

/** On and Off always read in the same order, like a switch. */
function optionsFor(key: keyof MatchConfig): readonly (string | number | boolean)[] {
  const opts = CONFIG_OPTIONS[key] as readonly (string | number | boolean)[];
  return typeof opts[0] === 'boolean' ? [false, true] : opts;
}

/**
 * Swaps a container for an empty copy, which repaints its whole box. The menu font's top row sits just above its
 * text box, so removing only the children can leave that row of pixels on screen.
 */
function emptied(el: HTMLDivElement): HTMLDivElement {
  const next = h('div', { class: el.className });
  el.replaceWith(next);
  return next;
}

export class Lobby {
  root: HTMLElement;
  private players = h('div', { class: 'matchup' });
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
  private lastPlayers = '';
  /** Set by the arrows, so a pick made from the card also scrolls into view on the wall. */
  private revealPick = false;

  constructor(parent: HTMLElement, private code: string, private a: LobbyActions, startTab?: Tab) {
    if (startTab) this.tab = startTab;
    const link = `${location.origin}/r/${code}`;
    const copy = h('button', { testid: 'copy-link', class: 'small', onclick: () => {
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

  private score(raw: number): number {
    return Math.round(adjustScore(raw, this.room?.config.ratings ?? 'real'));
  }

  private renderPlayers(): void {
    const { room, seat } = this;
    if (!room) return;
    const key = JSON.stringify([room.seats, room.config.ratings, seat]);
    if (key === this.lastPlayers) return;
    this.lastPlayers = key;
    clear(this.players);
    this.players.append(this.seatCard(0), h('div', { class: 'vs' }, 'VS'), this.seatCard(1));
  }

  private seatCard(i: Seat): HTMLElement {
    const s = this.room?.seats[i] ?? null;
    const mine = i === this.seat;
    const team = s?.team ? TEAM_BY_ID[s.team] ?? null : null;
    const tag = `${mine ? 'YOU' : 'RIVAL'}${i === 0 ? ' (host)' : ''}`;
    const arrow = (delta: 1 | -1, label: string, glyph: string) => (mine
      ? h('button', { class: 'cycle', testid: delta < 0 ? 'team-prev' : 'team-next', 'aria-label': label, disabled: !!s?.ready, onclick: () => this.cycle(delta) }, glyph)
      : null);
    const stat = (name: string, raw: number) => {
      const v = this.score(raw);
      return h('span', { class: 'stat' }, h('span', { class: 'stat-num' }, `${name} ${v}`), bar(v));
    };
    const rating = team ? starRating(this.score(team.off), this.score(team.def)) : 0;
    return h('section', {
      class: `seat-card ${i === 0 ? 'home' : 'away'}${mine ? ' mine' : ''}${team ? '' : ' no-team'}`,
      testid: `seat-${i}`,
      style: team ? `--t1:${team.primary};--t2:${team.secondary}` : undefined,
    },
      h('div', { class: 'seat-stage' },
        arrow(-1, 'Previous team', '<'),
        team ? crest(team, 'crest-big') : h('span', { class: 'crest-big crest-empty' }, '?'),
        arrow(1, 'Next team', '>'),
      ),
      h('div', { class: 'seat-info' },
        h('div', { class: 'seat-who' },
          h('span', { class: 'who' }, tag),
          h('span', { class: 'nick' }, s ? s.nick : 'Waiting...'),
          s ? h('span', { class: `status-word${s.online ? '' : ' is-off'}` }, s.online ? 'online' : 'offline') : null,
        ),
        h('div', { class: 'seat-team', testid: `seat-team-${i}` },
          ...(team
            ? [h('span', { class: 'seat-city' }, team.city), ' ', h('span', { class: 'seat-nick' }, team.nick)]
            : [h('span', { class: 'seat-city' }, s ? 'No team yet' : 'Send them the invite link')]),
        ),
        team ? h('div', { class: 'seat-meta' },
          h('img', { class: 'stars', src: starsURL(rating), alt: `${rating} of 5 stars` }),
          h('span', { class: 'seat-league' }, `${team.conf} ${team.division}`),
          h('span', { class: 'seat-record' }, team.record),
        ) : null,
        h('div', { class: 'seat-foot' },
          h('div', { class: 'scores' }, ...(team ? [stat('OFF', team.off), stat('DEF', team.def)] : [])),
          mine
            ? h('button', { class: `ready${s?.ready ? ' is-ready' : ''}`, testid: 'ready', 'aria-pressed': String(!!s?.ready), disabled: !s?.team, onclick: () => this.a.ready(!s?.ready) }, s?.ready ? 'READY!' : 'READY')
            : s ? h('span', { class: `ready-word${s.ready ? ' is-ready' : ''}`, testid: 'rival-ready' }, s.ready ? 'ready' : 'not ready') : null,
        ),
      ),
    );
  }

  /** Teams in the order the wall shows them, which is also the order the arrows step through. */
  private ordered(): Team[] {
    if (this.sort === 'division') return TEAMS;
    return [...TEAMS].sort((x, y) => (this.sort === 'off' ? y.off - x.off : y.def - x.def) || x.id.localeCompare(y.id));
  }

  private cycle(delta: 1 | -1): void {
    const { room, seat } = this;
    if (!room || seat === null) return;
    const list = this.ordered();
    const at = list.findIndex((t) => t.id === room.seats[seat]?.team);
    const next = at < 0 ? (delta > 0 ? 0 : list.length - 1) : (at + delta + list.length) % list.length;
    this.revealPick = true;
    this.a.pickTeam(list[next]!.id);
  }

  private renderTabs(): void {
    this.tabs = emptied(this.tabs);
    const tab = (id: Tab, label: string) => h('button', { class: `tab${this.tab === id ? ' on' : ''}`, testid: `tab-${id}`, onclick: () => { this.tab = id; this.lastBody = ''; this.renderTabs(); this.renderBody(); this.body.scrollTop = 0; } }, label);
    this.tabs.append(tab('teams', 'TEAMS'), tab('settings', 'MATCH SETTINGS'), h('span', { class: 'spacer' }));
    if (this.tab === 'teams') {
      const sortBtn = (id: Sort, label: string) => h('button', { class: `opt${this.sort === id ? ' on' : ''}`, testid: `sort-${id}`, 'aria-pressed': String(this.sort === id), onclick: () => { this.sort = id; this.lastBody = ''; this.renderTabs(); this.renderBody(); } }, label);
      this.tabs.append(h('span', { class: 'dim' }, 'Sort by'), h('div', { class: 'seg' }, sortBtn('division', 'Division'), sortBtn('off', 'OFF'), sortBtn('def', 'DEF')));
    } else {
      const c = this.room?.config;
      if (c) this.tabs.append(h('span', { class: 'dim', testid: 'estimate' }, `About ${realMinutes(c)} min a game`));
    }
  }

  private renderBody(): void {
    if (!this.room) return;
    const key = `${this.tab}:${this.sort}:${JSON.stringify(this.room.config)}:${this.room.seats.map((s) => `${s?.team}:${s?.ready}`).join()}:${this.seat}`;
    if (key === this.lastBody) return;
    this.lastBody = key;
    const scroll = this.body.scrollTop;
    this.body = emptied(this.body);
    if (this.tab === 'teams') this.renderTeams();
    else this.renderSettings();
    this.body.scrollTop = scroll;
    if (this.revealPick) {
      this.revealPick = false;
      this.body.querySelector('.team-card.picked')?.scrollIntoView({ block: 'nearest' });
    }
  }

  private renderTeams(): void {
    const { room, seat } = this;
    if (!room) return;
    const mine = seat === null ? null : room.seats[seat];
    const locked = !!mine?.ready;
    const rivalTeam = seat === null ? null : room.seats[(1 - seat) as Seat]?.team;
    const card = (t: Team) => {
      const picked = mine?.team === t.id;
      const rival = rivalTeam === t.id;
      return h('button', {
        class: `team-card${picked ? ' picked' : ''}${rival ? ' rival' : ''}`,
        testid: `team-${t.id}`, 'aria-pressed': String(picked), disabled: locked, onclick: () => this.a.pickTeam(t.id),
      },
        picked || rival ? h('span', { class: 'flags' },
          picked ? h('span', { class: 'flag flag-you' }, 'YOU') : null,
          rival ? h('span', { class: 'flag flag-rival' }, 'RIVAL') : null,
        ) : null,
        crest(t, 'crest-tile'),
        h('span', { class: 'team-stats' },
          h('span', {}, h('span', { class: 'stat-label' }, 'OFF '), String(this.score(t.off))),
          h('span', {}, h('span', { class: 'stat-label' }, 'DEF '), String(this.score(t.def))),
        ),
        // The city only shows on the card above, but stays here for screen readers.
        h('span', { class: `team-nick${t.nick.length > 8 ? ' tight' : ''}` }, h('span', { class: 'visually-hidden' }, `${t.city} `), t.nick),
      );
    };
    if (this.sort === 'division') {
      const wall = h('div', { class: 'team-wall' });
      for (const d of DIVISIONS) {
        const tiles = h('div', { class: 'team-tiles' });
        for (const t of TEAMS) if (`${t.conf} ${t.division}` === d) tiles.append(card(t));
        wall.append(h('section', { class: 'team-division' }, h('h3', { class: 'division' }, d.toUpperCase()), tiles));
      }
      this.body.append(wall);
    } else {
      const grid = h('div', { class: 'team-grid' });
      for (const t of this.ordered()) grid.append(card(t));
      this.body.append(grid);
    }
  }

  private renderSettings(): void {
    const { room, seat } = this;
    if (!room) return;
    const host = seat === 0;
    const c = room.config;
    const presets = h('div', { class: 'seg' });
    for (const [id, label] of [['sprint', 'Sprint'], ['quick', 'Quick'], ['standard', 'Standard'], ['long', 'Long']] as const) {
      const p = PRESETS[id];
      const on = Object.entries(p).every(([k, v]) => c[k as keyof MatchConfig] === v);
      presets.append(h('button', { class: `opt${on ? ' on' : ''}`, testid: `preset-${id}`, 'aria-pressed': String(on), disabled: !host, onclick: () => this.a.setConfig(p) }, label));
    }
    this.body.append(h('div', { class: 'cfg-top' },
      h('span', { class: 'cfg-label' }, 'Preset'), presets,
      host ? null : h('span', { class: 'dim', testid: 'readonly' }, 'The host sets these.'),
    ));
    const grid = h('div', { class: 'cfg-grid' });
    for (const groups of COLUMNS) {
      const col = h('div', { class: 'cfg-col' });
      for (const g of groups) {
        const section = h('section', { class: 'cfg-group' }, h('h3', {}, g.title));
        for (const it of g.items) {
          const seg = h('div', { class: 'seg', role: 'group', 'aria-label': it.label });
          for (const o of optionsFor(it.key)) {
            seg.append(h('button', {
              class: `opt${c[it.key] === o ? ' on' : ''}`, testid: `cfg-${it.key}-${String(o)}`, 'aria-pressed': String(c[it.key] === o), disabled: !host,
              onclick: () => this.a.setConfig({ [it.key]: o } as Partial<MatchConfig>),
            }, it.names?.[String(o)] ?? String(o)));
          }
          section.append(h('div', { class: 'cfg-row' },
            h('span', { class: 'cfg-label' }, it.label, it.unit ? h('span', { class: 'cfg-unit' }, it.unit) : null),
            seg,
          ));
        }
        col.append(section);
      }
      grid.append(col);
    }
    this.body.append(grid);
  }

  destroy(): void { this.root.remove(); }
}
