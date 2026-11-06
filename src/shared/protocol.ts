// Message types shared by the browser and the room server.
import type { MatchConfig } from './data/config';
import type { CallSide, Choice, MatchState } from './rules/match';
import type { PlayDesc, PlayResult, Seat, SimState } from './sim/state';

export type { Seat } from './sim/state';

export interface SeatView {
  nick: string;
  online: boolean;
  visible: boolean;
  team: string | null;
  ready: boolean;
}

export interface RoomView {
  code: string;
  seats: [SeatView | null, SeatView | null];
  config: MatchConfig;
  screen: 'lobby' | 'match';
}

export type HandoffReason = 'int' | 'fumble' | 'kick' | 'onside';

export type ClientMsg =
  | { t: 'join'; token?: string; soft?: boolean; nick: string; create?: boolean }
  | { t: 'ptr'; x: number; y: number }
  | { t: 'setConfig'; patch: Partial<MatchConfig> }
  | { t: 'pickTeam'; team: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'rematch' }
  /** clock: the controller's own reading of a running clock at the snap. */
  | { t: 'snap'; playId: number; clock?: number }
  /** A play call in the huddle: the offense's play or the defense's call, as an index into its book. */
  | { t: 'call'; playId: number; side: CallSide; id: number }
  | { t: 'timeout' }
  | { t: 'choice'; c: Choice }
  | { t: 'pause' }
  | { t: 'concede' }
  | { t: 'claimWin' }
  | { t: 'visibility'; visible: boolean }
  | { t: 'skip' }
  | { t: 'handoff'; playId: number; state: SimState; to: Seat; reason: HandoffReason; spotX: number }
  | { t: 'playResult'; result: PlayResult }
  | { t: 'dev'; op: 'patch' | 'expire' | 'restart' | 'force'; patch?: Partial<MatchState>; what?: string };

export type ServerMsg =
  | { t: 'welcome'; seat: Seat; token: string }
  | { t: 'room'; room: RoomView }
  | { t: 'ptr'; seat: Seat; x: number; y: number }
  | { t: 'playStart'; play: PlayDesc; match: MatchState; pc: number | null }
  | { t: 'matchState'; match: MatchState; pc: number | null; live: { playId: number; controller: Seat } | null; bannerMs: number | null }
  | { t: 'snap'; playId: number; auto: boolean; clock: number }
  | { t: 'handoff'; playId: number; state: SimState; reason: HandoffReason }
  | { t: 'yield'; playId: number; to: Seat; reason: HandoffReason }
  | { t: 'continue'; playId: number }
  | { t: 'clock'; pc: number | null }
  | { t: 'paused'; by: Seat | null; left: number }
  | { t: 'waiting'; on: boolean; missing: [boolean, boolean]; left: [number | null, number | null]; canClaim: Seat | null }
  | { t: 'error'; code: ErrorCode; msg?: string };

export type ErrorCode = 'full' | 'notfound' | 'exists' | 'badmsg' | 'rate' | 'forbidden' | 'phase';

/** Six characters from an alphabet without look-alikes. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

// ---------------------------------------------------------------------------
// Frames: the binary snapshot streamed 20 times a second while a play is live.
// ---------------------------------------------------------------------------
import { PHASES, type SimPhase } from './sim/state';

export const PLAYER_COUNT = 16;
const HEADER = 22;
const PER_PLAYER = 6;
export const FRAME_BYTES = HEADER + PLAYER_COUNT * PER_PLAYER;

export interface Frame {
  playId: number; tick: number; clock: number;
  bx: number; by: number; bz: number;
  ax: number; ay: number; aimOn: boolean;
  phase: SimPhase; carrier: number; ev: number; meter: number;
  px: Float32Array; py: Float32Array; anim: Uint8Array; face: Int8Array; stunned: Uint8Array;
}

export function emptyFrame(): Frame {
  return {
    playId: 0, tick: 0, clock: 0, bx: 0, by: 0, bz: 0, ax: 0, ay: 0, aimOn: false, phase: 'pre', carrier: -1, ev: 0, meter: 0,
    px: new Float32Array(PLAYER_COUNT), py: new Float32Array(PLAYER_COUNT), anim: new Uint8Array(PLAYER_COUNT), face: new Int8Array(PLAYER_COUNT), stunned: new Uint8Array(PLAYER_COUNT),
  };
}

/** Copies the sim state into a Frame object. Rendering uses this in both roles. */
export function frameFromSim(s: SimState, into: Frame = emptyFrame()): Frame {
  into.playId = s.desc.id;
  into.tick = s.tick;
  into.clock = s.clock;
  into.bx = s.ball.x; into.by = s.ball.y; into.bz = s.ball.z;
  const kick = s.kick;
  if (kick && (s.phase === 'kickPower' || s.phase === 'kickAim')) {
    into.ax = kick.meter;
    into.ay = kick.arrow;
    into.aimOn = true;
  } else {
    into.ax = s.aim.dx; into.ay = s.aim.dy; into.aimOn = s.aim.on;
  }
  into.phase = s.phase;
  into.carrier = s.ball.holder;
  into.ev = s.ev;
  into.meter = s.g.truck ? s.g.truckMeter : s.kick?.ezPending ? 1 : 0;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    const p = s.players[i];
    into.px[i] = p.x; into.py[i] = p.y; into.anim[i] = p.anim; into.face[i] = p.face; into.stunned[i] = p.stun > 0 ? 1 : 0;
  }
  return into;
}

const clampI16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
const clampU16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));

export function encodeFrame(f: Frame): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_BYTES);
  const v = new DataView(buf);
  v.setUint16(0, f.playId & 0xffff, true);
  v.setUint16(2, f.tick & 0xffff, true);
  v.setUint16(4, clampU16(f.clock * 10), true);
  v.setInt16(6, clampI16(f.bx * 100), true);
  v.setInt16(8, clampI16(f.by * 100), true);
  v.setInt16(10, clampI16(f.bz * 100), true);
  v.setInt16(12, clampI16(f.ax * 100), true);
  v.setInt16(14, clampI16(f.ay * 100), true);
  v.setUint8(16, PHASES.indexOf(f.phase) | (f.aimOn ? 0x80 : 0));
  v.setUint8(17, f.carrier < 0 ? 255 : f.carrier);
  v.setUint16(18, f.ev & 0xffff, true);
  v.setUint16(20, clampU16(f.meter * 100), true);
  let o = HEADER;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    v.setInt16(o, clampI16(f.px[i] * 100), true);
    v.setInt16(o + 2, clampI16(f.py[i] * 100), true);
    v.setUint8(o + 4, f.anim[i]);
    v.setUint8(o + 5, (f.face[i] < 0 ? 1 : 0) | (f.stunned[i] ? 2 : 0));
    o += PER_PLAYER;
  }
  return buf;
}

export function decodeFrame(buf: ArrayBuffer, into: Frame = emptyFrame()): Frame {
  const v = new DataView(buf);
  into.playId = v.getUint16(0, true);
  into.tick = v.getUint16(2, true);
  into.clock = v.getUint16(4, true) / 10;
  into.bx = v.getInt16(6, true) / 100;
  into.by = v.getInt16(8, true) / 100;
  into.bz = v.getInt16(10, true) / 100;
  into.ax = v.getInt16(12, true) / 100;
  into.ay = v.getInt16(14, true) / 100;
  const ph = v.getUint8(16);
  into.aimOn = (ph & 0x80) !== 0;
  into.phase = PHASES[ph & 0x7f];
  const c = v.getUint8(17);
  into.carrier = c === 255 ? -1 : c;
  into.ev = v.getUint16(18, true);
  into.meter = v.getUint16(20, true) / 100;
  let o = HEADER;
  for (let i = 0; i < PLAYER_COUNT; i++) {
    into.px[i] = v.getInt16(o, true) / 100;
    into.py[i] = v.getInt16(o + 2, true) / 100;
    into.anim[i] = v.getUint8(o + 4);
    const fl = v.getUint8(o + 5);
    into.face[i] = fl & 1 ? -1 : 1;
    into.stunned[i] = fl & 2 ? 1 : 0;
    o += PER_PLAYER;
  }
  return into;
}
