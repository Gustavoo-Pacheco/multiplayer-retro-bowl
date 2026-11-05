// Starts the real local runtime (Vite + workerd) once for all room tests.
import { spawn, type ChildProcess } from 'node:child_process';

export const ROOM_PORT = 5198;

async function up(): Promise<boolean> {
  try { return (await fetch(`http://localhost:${ROOM_PORT}/`)).ok; } catch { return false; }
}

export default async function setup(): Promise<() => void> {
  let child: ChildProcess | null = null;
  if (!(await up())) {
    child = spawn('npx', ['vite', '--port', String(ROOM_PORT), '--strictPort'], { stdio: 'ignore', detached: true });
    const until = Date.now() + 60_000;
    while (!(await up())) {
      if (Date.now() > until) throw new Error('dev server did not start');
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return () => { if (child?.pid) try { process.kill(-child.pid); } catch { /* already gone */ } };
}
