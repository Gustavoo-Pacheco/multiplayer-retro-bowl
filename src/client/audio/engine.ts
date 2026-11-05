// The one audio context: unlocks on the first tap, as mobile browsers require, and holds the volume controls.
import { noise, playStep, SONGS, SOUND_NAMES, SOUNDS, type Song, type SoundName } from './sounds';

type SongName = keyof typeof SONGS;

export class AudioEngine {
  ctx: AudioContext | null = null;
  private sfx: GainNode | null = null;
  private crowd: GainNode | null = null;
  private music: GainNode | null = null;
  private soundVol = 0.8;
  private musicVol = 0.5;
  private crowdOn = false;
  private crowdNodes: { stop(): void } | null = null;
  private song: SongName | null = null;
  private timer = 0;
  private step = 0;
  private nextAt = 0;
  /** Everything asked to play, whether or not the context is unlocked, so tests can check the triggers. */
  log: string[] = [];

  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const c = new Ctor();
    this.ctx = c;
    this.sfx = c.createGain();
    this.crowd = c.createGain();
    this.music = c.createGain();
    // A limiter keeps a pile of sounds from clipping.
    const limit = c.createDynamicsCompressor();
    this.sfx.connect(limit);
    this.crowd.connect(limit);
    this.music.connect(limit);
    limit.connect(c.destination);
    this.applyVolumes();
    void c.resume();
    if (this.crowdOn) this.startCrowd();
    if (this.song) this.startSong();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.sfx!.gain.value = this.soundVol;
    this.crowd!.gain.value = this.soundVol;
    this.music!.gain.value = this.musicVol;
  }

  setVolumes(sound: number, music: number): void {
    this.soundVol = sound;
    this.musicVol = music;
    this.applyVolumes();
  }

  play(name: SoundName): void {
    this.log.push(name);
    if (this.log.length > 600) this.log.shift();
    if (!this.ctx || this.ctx.state !== 'running' || this.soundVol <= 0) return;
    SOUNDS[name](this.ctx, this.sfx!, this.ctx.currentTime + 0.001);
  }

  // --- Crowd: filtered noise, always there during a match ----------------------

  setCrowd(on: boolean): void {
    if (this.crowdOn === on) return;
    this.crowdOn = on;
    this.log.push(on ? 'crowd:on' : 'crowd:off');
    if (on) this.startCrowd(); else this.stopCrowd();
  }

  private startCrowd(): void {
    const c = this.ctx;
    if (!c || this.crowdNodes) return;
    const out = c.createGain();
    out.gain.value = 0.16;
    out.connect(this.crowd!);
    // Long, gently overlapping bursts of noise make the murmur without needing a recording.
    let stopped = false;
    let next = c.currentTime;
    const tick = () => {
      if (stopped) return;
      while (next < c.currentTime + 1) {
        noise(c, out, next, { dur: 3, gain: 0.3, f: 500 + Math.random() * 500, q: 0.6, attack: 1 });
        next += 1.3;
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    this.crowdNodes = { stop: () => { stopped = true; clearInterval(id); out.disconnect(); } };
  }

  private stopCrowd(): void { this.crowdNodes?.stop(); this.crowdNodes = null; }

  // --- Music: never during plays ---------------------------------------------

  setSong(name: SongName | null): void {
    if (this.song === name) return;
    this.song = name;
    this.log.push(`music:${name ?? 'off'}`);
    this.stopSong();
    if (name) this.startSong();
  }

  private stopSong(): void { clearInterval(this.timer); this.timer = 0; }

  private startSong(): void {
    const c = this.ctx;
    if (!c || !this.song) return;
    this.stopSong();
    this.step = 0;
    this.nextAt = c.currentTime + 0.05;
    const song: Song = SONGS[this.song];
    const sixteenth = 60 / song.bpm / 4;
    this.timer = window.setInterval(() => {
      if (c.state !== 'running' || this.musicVol <= 0) return;
      while (this.nextAt < c.currentTime + 0.2) {
        playStep(c, this.music!, song, this.step, this.nextAt);
        this.step += 1;
        this.nextAt += sixteenth;
      }
      // A page in the background falls behind. Skip ahead rather than rushing to catch up.
      if (this.nextAt < c.currentTime - 0.3) this.nextAt = c.currentTime + 0.05;
    }, 60);
  }
}

export const audio = new AudioEngine();

const unlock = () => audio.unlock();
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  (window as unknown as { __audio: AudioEngine }).__audio = audio;
  (window as unknown as { __audioCheck: unknown }).__audioCheck = { measureSound: (n: SoundName) => measureSound(n), measureSong: (n: SongName) => measureSong(n), names: SOUND_NAMES };
}

/** Renders a sound without playing it, and reports how loud it is. Tests use this. */
export async function measureSound(name: SoundName): Promise<{ peak: number; rms: number }> {
  const c = new OfflineAudioContext(1, 44100 * 4, 44100);
  SOUNDS[name](c, c.destination, 0.01);
  return summarize(await c.startRendering());
}

export async function measureSong(name: SongName): Promise<{ peak: number; rms: number }> {
  const c = new OfflineAudioContext(1, 44100 * 4, 44100);
  const song = SONGS[name];
  const sixteenth = 60 / song.bpm / 4;
  for (let i = 0; i < song.lead.length && i * sixteenth < 3.9; i++) playStep(c, c.destination, song, i, 0.01 + i * sixteenth);
  return summarize(await c.startRendering());
}

function summarize(b: AudioBuffer): { peak: number; rms: number } {
  const d = b.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (const v of d) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return { peak, rms: Math.sqrt(sum / d.length) };
}
