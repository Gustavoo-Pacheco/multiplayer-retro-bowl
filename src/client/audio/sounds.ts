// Every sound effect, synthesized. Each one draws into any audio context, so tests can render them offline.
type Ctx = BaseAudioContext;

const noiseCache = new WeakMap<Ctx, AudioBuffer>();
function noiseBuffer(c: Ctx): AudioBuffer {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}

interface ToneOpts { f: number; to?: number; dur: number; gain: number; type?: OscillatorType; attack?: number; at?: number; slide?: number }
export function tone(c: Ctx, out: AudioNode, t0: number, o: ToneOpts): void {
  const t = t0 + (o.at ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'square';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + (o.slide ?? o.dur));
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

interface NoiseOpts { dur: number; gain: number; f?: number; to?: number; q?: number; type?: BiquadFilterType; attack?: number; at?: number; loop?: boolean }
export function noise(c: Ctx, out: AudioNode, t0: number, o: NoiseOpts): void {
  const t = t0 + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const flt = c.createBiquadFilter();
  flt.type = o.type ?? 'bandpass';
  flt.frequency.setValueAtTime(o.f ?? 1000, t);
  if (o.to) flt.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.dur);
  flt.Q.value = o.q ?? 1;
  const g = c.createGain();
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(flt).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + o.dur + 0.02);
}

const notes = (c: Ctx, o: AudioNode, t: number, list: number[], step: number, len: number, gain: number, type: OscillatorType = 'square'): void => {
  list.forEach((f, i) => { if (f) tone(c, o, t, { f, dur: len, gain, type, at: i * step }); });
};

type Synth = (c: Ctx, o: AudioNode, t: number) => void;

export const SOUNDS = {
  // Field
  whistle: (c, o, t) => { for (let i = 0; i < 4; i++) { tone(c, o, t, { f: 2650, dur: 0.09, gain: 0.16, type: 'sine', at: i * 0.075 }); tone(c, o, t, { f: 2870, dur: 0.09, gain: 0.1, type: 'sine', at: i * 0.075 }); } },
  snapCall: (c, o, t) => { tone(c, o, t, { f: 170, to: 105, dur: 0.14, gain: 0.3, type: 'sawtooth' }); noise(c, o, t, { dur: 0.05, gain: 0.25, f: 1400 }); },
  throw: (c, o, t) => noise(c, o, t, { dur: 0.22, gain: 0.3, f: 800, to: 2600, attack: 0.05 }),
  catch: (c, o, t) => { tone(c, o, t, { f: 210, to: 90, dur: 0.1, gain: 0.5, type: 'sine' }); noise(c, o, t, { dur: 0.04, gain: 0.25, f: 2200 }); },
  drop: (c, o, t) => { tone(c, o, t, { f: 240, to: 80, dur: 0.14, gain: 0.32, type: 'triangle' }); tone(c, o, t, { f: 180, to: 70, dur: 0.12, gain: 0.22, type: 'triangle', at: 0.14 }); },
  tackle: (c, o, t) => { noise(c, o, t, { dur: 0.18, gain: 0.55, f: 600, type: 'lowpass' }); tone(c, o, t, { f: 95, to: 40, dur: 0.2, gain: 0.6, type: 'sine' }); },
  grunt: (c, o, t) => { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.connect(o); tone(c, f, t, { f: 135, to: 82, dur: 0.17, gain: 0.45, type: 'sawtooth' }); },
  stiffArm: (c, o, t) => { noise(c, o, t, { dur: 0.08, gain: 0.45, f: 1000, type: 'lowpass' }); tone(c, o, t, { f: 210, to: 90, dur: 0.09, gain: 0.3 }); },
  dive: (c, o, t) => { noise(c, o, t, { dur: 0.28, gain: 0.26, f: 500, to: 180, attack: 0.05 }); tone(c, o, t, { f: 110, to: 45, dur: 0.14, gain: 0.5, type: 'sine', at: 0.22 }); },
  kick: (c, o, t) => { tone(c, o, t, { f: 150, to: 48, dur: 0.11, gain: 0.7, type: 'sine' }); noise(c, o, t, { dur: 0.03, gain: 0.35, f: 1500 }); },
  goalpost: (c, o, t) => { for (const [f, g] of [[1180, 0.18], [1725, 0.13], [2460, 0.08], [3320, 0.05]] as const) tone(c, o, t, { f, dur: 0.75, gain: g, type: 'triangle' }); },
  // Crowd
  swell: (c, o, t) => noise(c, o, t, { dur: 2.2, gain: 0.34, f: 1000, q: 0.7, attack: 0.5 }),
  groan: (c, o, t) => { noise(c, o, t, { dur: 0.95, gain: 0.3, f: 620, to: 240, q: 1.5, attack: 0.1 }); tone(c, o, t, { f: 240, to: 120, dur: 0.9, gain: 0.05, type: 'sawtooth', attack: 0.1 }); },
  cheer: (c, o, t) => { noise(c, o, t, { dur: 1.8, gain: 0.45, f: 1500, q: 0.6, attack: 0.08 }); for (let i = 0; i < 5; i++) noise(c, o, t, { dur: 0.3, gain: 0.16, f: 2500, q: 3, at: 0.15 + i * 0.26 }); },
  boo: (c, o, t) => { noise(c, o, t, { dur: 1.1, gain: 0.34, f: 280, q: 1.2, attack: 0.15 }); tone(c, o, t, { f: 118, to: 96, dur: 1.05, gain: 0.08, type: 'sawtooth', attack: 0.15 }); },
  // Rules
  tdSting: (c, o, t) => { notes(c, o, t, [523, 659, 784, 1047, 784, 1047], 0.1, 0.16, 0.2); notes(c, o, t, [131, 131, 196, 262], 0.15, 0.2, 0.22, 'triangle'); },
  firstDown: (c, o, t) => notes(c, o, t, [784, 1047], 0.09, 0.16, 0.18),
  fgGood: (c, o, t) => notes(c, o, t, [659, 784, 988, 1319], 0.08, 0.16, 0.18),
  fgMiss: (c, o, t) => notes(c, o, t, [440, 349, 262], 0.15, 0.22, 0.18),
  turnover: (c, o, t) => notes(c, o, t, [392, 330, 277, 220], 0.09, 0.15, 0.2, 'sawtooth'),
  penalty: (c, o, t) => notes(c, o, t, [165, 165], 0.2, 0.15, 0.25),
  quarterHorn: (c, o, t) => { for (const f of [220, 277]) tone(c, o, t, { f, dur: 0.9, gain: 0.14, type: 'sawtooth', attack: 0.03 }); },
  gameHorn: (c, o, t) => { for (const f of [196, 247, 294]) tone(c, o, t, { f, dur: 1.6, gain: 0.13, type: 'sawtooth', attack: 0.03 }); },
  // UI
  click: (c, o, t) => tone(c, o, t, { f: 1400, dur: 0.03, gain: 0.12 }),
  confirm: (c, o, t) => notes(c, o, t, [880, 1320], 0.06, 0.09, 0.14),
  cancel: (c, o, t) => notes(c, o, t, [660, 440], 0.06, 0.09, 0.14),
  meterTick: (c, o, t) => tone(c, o, t, { f: 2100, dur: 0.015, gain: 0.08 }),
  // Stings
  winSting: (c, o, t) => { notes(c, o, t, [523, 659, 784, 1047, 1047, 1319], 0.13, 0.22, 0.2); notes(c, o, t, [131, 196, 262, 196, 262, 330], 0.13, 0.22, 0.2, 'triangle'); },
  lossSting: (c, o, t) => { notes(c, o, t, [392, 349, 311, 262], 0.24, 0.34, 0.18); notes(c, o, t, [98, 98, 78, 65], 0.24, 0.34, 0.2, 'triangle'); },
} satisfies Record<string, Synth>;

export type SoundName = keyof typeof SOUNDS;
export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[];

// --- Music: a small step sequencer ------------------------------------------

export interface Song { bpm: number; lead: number[]; bass: number[]; hat: string }
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

export const SONGS: Record<'title' | 'menu', Song> = {
  title: {
    bpm: 138,
    lead: [
      72, 0, 76, 79, 0, 76, 79, 84, 83, 0, 79, 76, 0, 74, 72, 0,
      69, 0, 72, 76, 0, 72, 76, 81, 79, 0, 76, 74, 0, 72, 74, 0,
      72, 0, 76, 79, 0, 76, 79, 84, 86, 0, 84, 83, 0, 81, 79, 0,
      77, 0, 81, 84, 0, 83, 81, 79, 76, 0, 74, 72, 0, 74, 72, 0,
    ],
    bass: [
      48, 0, 48, 0, 55, 0, 55, 0, 48, 0, 48, 0, 55, 0, 52, 0,
      45, 0, 45, 0, 52, 0, 52, 0, 43, 0, 43, 0, 50, 0, 47, 0,
      48, 0, 48, 0, 55, 0, 55, 0, 43, 0, 43, 0, 50, 0, 47, 0,
      41, 0, 41, 0, 48, 0, 48, 0, 43, 0, 43, 0, 48, 0, 48, 0,
    ],
    hat: 'x.x.X.x.',
  },
  menu: {
    bpm: 96,
    lead: [
      67, 0, 0, 71, 0, 0, 74, 0, 72, 0, 0, 69, 0, 0, 67, 0,
      64, 0, 0, 67, 0, 0, 71, 0, 69, 0, 67, 0, 66, 0, 0, 0,
      67, 0, 0, 71, 0, 0, 74, 0, 76, 0, 0, 74, 0, 72, 71, 0,
      69, 0, 0, 72, 0, 71, 69, 0, 67, 0, 0, 0, 0, 0, 0, 0,
    ],
    bass: [
      43, 0, 0, 0, 50, 0, 0, 0, 45, 0, 0, 0, 52, 0, 0, 0,
      40, 0, 0, 0, 47, 0, 0, 0, 38, 0, 0, 0, 45, 0, 0, 0,
      43, 0, 0, 0, 50, 0, 0, 0, 36, 0, 0, 0, 43, 0, 0, 0,
      38, 0, 0, 0, 45, 0, 0, 0, 43, 0, 0, 0, 50, 0, 0, 0,
    ],
    hat: '..x...x.',
  },
};

/** Schedules one sixteenth note of a song. */
export function playStep(c: Ctx, out: AudioNode, song: Song, step: number, t: number): void {
  const sixteenth = 60 / song.bpm / 4;
  const lead = song.lead[step % song.lead.length];
  const bass = song.bass[step % song.bass.length];
  if (lead) tone(c, out, t, { f: midi(lead), dur: sixteenth * 1.7, gain: 0.09, type: 'square' });
  if (bass) tone(c, out, t, { f: midi(bass), dur: sixteenth * 1.9, gain: 0.16, type: 'triangle' });
  const hat = song.hat[step % song.hat.length];
  if (hat !== '.') noise(c, out, t, { dur: hat === 'X' ? 0.09 : 0.03, gain: hat === 'X' ? 0.13 : 0.05, f: 7000, type: 'highpass' });
}
