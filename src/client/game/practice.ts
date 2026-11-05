// Repeated plays on one screen, with no rules: the M1 and M2 playground, kept as a dev tool.
import { emptyFrame, frameFromSim } from '../../shared/protocol';
import { DIFFICULTY } from '../../shared/data/config';
import { pickPlay } from '../../shared/data/playbook';
import { adjustScore, buildRoster, type RosterPlayer } from '../../shared/data/roster';
import { TEAM_BY_ID } from '../../shared/data/teams';
import { mixSeed } from '../../shared/sim/rng';
import { createPlay } from '../../shared/sim/setup';
import { step } from '../../shared/sim/step';
import type { PlayDesc, Seat, SimCfg, SimInput, SimState } from '../../shared/sim/state';
import { T } from '../../shared/sim/tuning';
import { aimFadeAlpha } from '../../shared/sim/pass';
import { GestureRecognizer } from '../input/gestures';
import { bindPointer } from '../input/pointer';
import { teamKit } from '../art/palette';
import { buildField } from '../render/field';
import { drawScene, type SceneInfo } from '../render/scene';
import { Stage } from '../render/stage';
import { Camera, screenX, screenY } from '../render/view';
import { mountDevPanel } from '../ui/dev-panel';
import { h } from '../ui/dom';

export function startPractice(parent: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const stage = new Stage(parent);
  const offense = TEAM_BY_ID[params.get('off') ?? 'SEA'];
  const defense = TEAM_BY_ID[params.get('def') ?? 'LAR'];
  const rosters: [RosterPlayer[], RosterPlayer[]] = [
    buildRoster(offense.id, adjustScore(offense.off, 'real'), adjustScore(offense.def, 'real')),
    buildRoster(defense.id, adjustScore(defense.off, 'real'), adjustScore(defense.def, 'real')),
  ];
  const d = DIFFICULTY.normal;
  const cfg: SimCfg = { difficulty: 'normal', sackTime: d.sackTime, coverLag: d.coverLag, intRadius: d.intRadius, weather: 'clear', fumbleMult: 1, bullet: true, trucking: true, fatigue: true, injuries: false, penalties: true, liveReturns: true };
  const teams = { rosters, cond: [rosters[0].map(() => 1), rosters[1].map(() => 1)] as [number[], number[]], armFatigue: [0, 0] as [number, number] };
  const kits: SceneInfo['kits'] = [teamKit(offense, false), teamKit(defense, false)];
  const field = buildField({ left: defense, right: offense, home: offense, visitor: defense, weather: 'clear', seed: 1 });
  const banner = h('div', { class: 'hud-banner', testid: 'practice-banner' }, 'Tap to snap');
  stage.overlay.append(banner);
  const g = new GestureRecognizer();
  bindPointer(stage, g);
  const cam = new Camera();
  const frame = emptyFrame();
  let playNo = 0;
  const stats = { plays: 0, att: 0, comp: 0, ends: [] as string[] };
  let sim!: SimState;
  let info!: SceneInfo;
  const queue: SimInput[] = [];

  const newPlay = () => {
    playNo += 1;
    const seed = mixSeed(12345, playNo);
    const play = pickPlay((seed % 1000) / 1000, 1, 10);
    const dir: 1 | -1 = 1;
    const desc: PlayDesc = { id: playNo, type: 'scrimmage', seed, offense: 0 as Seat, dir, los: 40, down: 1, toGo: 10, playbook: play.id, clock: 180 };
    sim = createPlay(desc, teams, cfg);
    info = {
      desc, seats: sim.players.map((p) => p.seat), roles: sim.players.map((p) => p.role), kits,
      routes: sim.players.filter((p) => p.route).map((p) => ({ i: p.i, pts: p.route! })),
      slots: sim.players.map((p) => p.slot), skins: sim.players.map((p) => p.slot % 4), stars: sim.players.map(() => false), names: sim.players.map(() => ''),
      firstDownX: desc.los + dir * desc.toGo, aimAlpha: aimFadeAlpha(sim, false), field,
    };
    cam.snap(desc.los + dir * T.view.camLead);
    g.reset();
    banner.textContent = 'Tap to snap';
  };
  newPlay();
  if (params.has('dev')) mountDevPanel(stage.overlay, { force: (what) => { sim.force = what; } });

  const inputLog: string[] = [];
  const dbg = { get sim() { return sim; }, stats, queue, stage, inputLog,
    screenOf: (i: number) => {
      const r = stage.canvas.getBoundingClientRect();
      const p = sim.players[i];
      return { x: r.left + (screenX(p.x, cam.x) / 640) * r.width, y: r.top + ((screenY(p.y) - 12) / 360) * r.height };
    } };
  (window as unknown as { __practice: typeof dbg }).__practice = dbg;

  const syncGestures = () => {
    g.ctx = {
      phase: sim.phase, active: true, handoffOpen: sim.phaseT <= T.pocket.handoffWindow,
      qb: { x: screenX(sim.players[0].x, cam.x), y: screenY(sim.players[0].y) },
      rb: { x: screenX(sim.players[1].x, cam.x), y: screenY(sim.players[1].y) },
    };
  };
  let last = performance.now();
  let acc = 0;
  const loop = (now: number) => {
    const dtMs = Math.min(100, now - last);
    last = now;
    acc += dtMs / 1000;
    syncGestures();
    g.tick(now);
    while (acc >= 1 / T.hz) {
      acc -= 1 / T.hz;
      const inputs = [...g.drain(), ...queue.splice(0)];
      for (const i of inputs) inputLog.push(i.k);
      step(sim, inputs);
      if (sim.result && !stats.ends[playNo - 1]) {
        stats.plays += 1;
        stats.ends[playNo - 1] = sim.result.end;
        stats.att += sim.stats[0].att;
        stats.comp += sim.stats[0].comp;
        banner.textContent = `${sim.result.end.toUpperCase()} ${sim.result.yards} yds`;
      }
      if (sim.finished) { newPlay(); break; }
    }
    syncGestures();
    frameFromSim(sim, frame);
    const camTarget = sim.ball.x + sim.desc.dir * T.view.camLead;
    cam.follow(camTarget, dtMs / 1000);
    drawScene(stage.ctx, frame, info, cam.x);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
