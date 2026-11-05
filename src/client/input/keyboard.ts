// Keyboard shortcuts, feeding the same simulation inputs as gestures.
import type { SimInput, SimPhase } from '../../shared/sim/state';

export interface KeyTargets {
  phase(): SimPhase | null;
  forwardKey(): 'ArrowRight' | 'ArrowLeft';
  input(i: SimInput): void;
  audible(): void; timeout(): void; choice(n: number): void; pause(): void;
}

const ARROWS: Record<string, [number, number]> = { ArrowUp: [0, -30], ArrowDown: [0, 30], ArrowLeft: [-30, 0], ArrowRight: [30, 0], w: [0, -30], s: [0, 30], W: [0, -30], S: [0, 30] };

export function bindKeyboard(t: KeyTargets): () => void {
  const onDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const phase = t.phase();
    if (e.code === 'Space') {
      e.preventDefault();
      if (phase === 'pre') t.input({ k: 'snap' });
      else if (phase === 'pocket') t.input({ k: 'bullet' });
      else t.input({ k: 'tap' });
      return;
    }
    if (e.key === 'a' || e.key === 'A') { t.audible(); return; }
    if (e.key === 't' || e.key === 'T') { t.timeout(); return; }
    if (e.key === 'p' || e.key === 'P') { t.pause(); return; }
    if (e.key === '1' || e.key === '2' || e.key === '3') { t.choice(Number(e.key)); return; }
    if (e.key === 'Shift' && !e.repeat) { t.input({ k: 'truck', on: true }); return; }
    if ((e.key === 'h' || e.key === 'H') && phase === 'pocket') { t.input({ k: 'handoff' }); return; }
    const arrow = ARROWS[e.key];
    if (arrow && !e.repeat) {
      if (e.key.startsWith('Arrow')) e.preventDefault();
      if (phase === 'pocket' && e.key === t.forwardKey()) t.input({ k: 'qbRun' });
      else if (phase === 'run') t.input({ k: 'swipe', dx: arrow[0], dy: arrow[1] });
    }
  };
  const onUp = (e: KeyboardEvent) => { if (e.key === 'Shift') t.input({ k: 'truck', on: false }); };
  addEventListener('keydown', onDown);
  addEventListener('keyup', onUp);
  return () => { removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); };
}
