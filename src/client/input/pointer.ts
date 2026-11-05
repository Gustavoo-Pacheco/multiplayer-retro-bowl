// Binds pointer events on the canvas to the gesture recognizer.
import type { Stage } from '../render/stage';
import type { GestureRecognizer } from './gestures';

export function bindPointer(stage: Stage, g: GestureRecognizer): () => void {
  const c = stage.canvas;
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events can't capture */ }
    const p = stage.toCanvas(e.clientX, e.clientY);
    g.down(e.pointerId, p.x, p.y, performance.now(), e.button);
  };
  const onMove = (e: PointerEvent) => {
    const p = stage.toCanvas(e.clientX, e.clientY);
    g.move(e.pointerId, p.x, p.y, performance.now());
    if (e.pointerType === 'mouse' && e.buttons & 2) g.rightClick();
  };
  const onUp = (e: PointerEvent) => {
    const p = stage.toCanvas(e.clientX, e.clientY);
    g.up(e.pointerId, p.x, p.y, performance.now());
  };
  const onCancel = (e: PointerEvent) => g.cancel(e.pointerId);
  const onMenu = (e: Event) => { e.preventDefault(); g.rightClick(); };
  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup', onUp);
  c.addEventListener('pointercancel', onCancel);
  c.addEventListener('contextmenu', onMenu);
  return () => {
    c.removeEventListener('pointerdown', onDown);
    c.removeEventListener('pointermove', onMove);
    c.removeEventListener('pointerup', onUp);
    c.removeEventListener('pointercancel', onCancel);
    c.removeEventListener('contextmenu', onMenu);
  };
}
