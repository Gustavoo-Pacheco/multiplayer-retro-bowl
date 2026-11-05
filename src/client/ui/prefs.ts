// Settings each player keeps for themselves, saved in this browser.
import { audio } from '../audio/engine';

export interface Prefs { sound: number; music: number; nameTags: boolean; starMarkers: boolean; fullscreen: boolean }

const DEFAULTS: Prefs = { sound: 0.8, music: 0.5, nameTags: false, starMarkers: true, fullscreen: false };
const KEY = 'borg.prefs';

function load(): Prefs {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }; } catch { return { ...DEFAULTS }; }
}

export const prefs: Prefs = load();
audio.setVolumes(prefs.sound, prefs.music);

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]): void {
  prefs[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* optional */ }
  audio.setVolumes(prefs.sound, prefs.music);
  if (k === 'fullscreen') applyFullscreen();
}

/** Asks for fullscreen where the browser allows it. Needs a tap, so it's called from one. */
export function applyFullscreen(): void {
  const el = document.documentElement;
  if (prefs.fullscreen && !document.fullscreenElement) void el.requestFullscreen?.().catch(() => {});
  else if (!prefs.fullscreen && document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
}
