import { afterEach, describe, expect, it } from 'vitest';
import { joined, newCode, TestClient } from './client';

const open: TestClient[] = [];
const track = (c: TestClient) => { open.push(c); return c; };
afterEach(() => { open.splice(0).forEach((c) => c.close()); });

describe('room seats', () => {
  it('assigns the host seat, then the guest seat', async () => {
    const code = newCode();
    const a = track(await joined(code, 'Ann', { create: true }));
    const b = track(await joined(code, 'Bob'));
    expect(a.seat).toBe(0);
    expect(b.seat).toBe(1);
    const room = await a.wait('room', (m) => m.room.seats[1]?.nick === 'Bob');
    expect(room.room.seats[0]?.nick).toBe('Ann');
  });

  it('refuses a join to a room that does not exist', async () => {
    const c = track(await new TestClient(newCode()).open());
    c.send({ t: 'join', nick: 'Nobody' });
    expect((await c.wait('error')).code).toBe('notfound');
    expect(await c.waitClose()).toBe(4004);
  });

  it('refuses a third visitor with "Room full"', async () => {
    const code = newCode();
    track(await joined(code, 'Ann', { create: true }));
    track(await joined(code, 'Bob'));
    const c = track(await new TestClient(code).open());
    c.send({ t: 'join', nick: 'Cy' });
    const e = await c.wait('error');
    expect(e.code).toBe('full');
    expect(e.msg).toBe('Room full');
    expect(await c.waitClose()).toBe(4001);
  });

  it('lets a player reclaim a seat with their token after a reload', async () => {
    const code = newCode();
    const a = track(await joined(code, 'Ann', { create: true }));
    const b = track(await joined(code, 'Bob'));
    const token = b.token;
    b.close();
    await a.wait('room', (m) => m.room.seats[1]?.online === false);
    const b2 = track(await joined(code, 'Bob', { token }));
    expect(b2.seat).toBe(1);
    expect(b2.token).toBe(token);
    await a.wait('room', (m) => m.room.seats[1]?.online === true);
  });

  it('gives a second window with a shared token the free seat', async () => {
    const code = newCode();
    const a = track(await joined(code, 'Ann', { create: true }));
    const second = track(await joined(code, 'Same browser', { token: a.token, soft: true }));
    expect(second.seat).toBe(1);
  });

  it('relays pointers to the other seat only', async () => {
    const code = newCode();
    const a = track(await joined(code, 'Ann', { create: true }));
    const b = track(await joined(code, 'Bob'));
    a.send({ t: 'ptr', x: 0.25, y: 0.75 });
    const p = await b.wait('ptr');
    expect([p.seat, p.x, p.y]).toEqual([0, 0.25, 0.75]);
    expect(a.inbox.some((m) => m.t === 'ptr')).toBe(false);
  });

  it('answers heartbeats without a game message', async () => {
    const code = newCode();
    const a = track(await joined(code, 'Ann', { create: true }));
    const pong = new Promise<string>((res) => { const prev = a.ws.onmessage; a.ws.onmessage = (e) => { if (e.data === 'pong') res(e.data as string); prev?.call(a.ws, e); }; });
    a.sendRaw('ping');
    expect(await pong).toBe('pong');
  });
});
