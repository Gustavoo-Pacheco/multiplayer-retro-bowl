// Message types shared by the browser and the room server.

export type Seat = 0 | 1;

export interface SeatView {
  nick: string;
  online: boolean;
}

export interface RoomView {
  code: string;
  seats: [SeatView | null, SeatView | null];
}

export type ClientMsg =
  | { t: 'join'; token?: string; soft?: boolean; nick: string; create?: boolean }
  | { t: 'ptr'; x: number; y: number };

export type ServerMsg =
  | { t: 'welcome'; seat: Seat; token: string }
  | { t: 'room'; room: RoomView }
  | { t: 'ptr'; seat: Seat; x: number; y: number }
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
