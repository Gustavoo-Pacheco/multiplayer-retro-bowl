// Every tunable number lives here. The ?dev=1 panel edits this object live.
export const T = {
  hz: 60,
  chance: { min: 0.02, max: 0.98 },

  field: { len: 120, ez: 10, width: 17.2, center: 8.6, oobMargin: 0.1 },
  view: {
    w: 640, h: 360, yards: 48,
    standsH: 61, walkH: 9, stripH: 13, fieldH: 230, grassH: 47,
    camEase: 5, camLead: 6, spriteH: 26,
  },

  attr: { min: 1, max: 10, baseLo: 3, baseHi: 8, scoreLo: 60, scoreHi: 99, positionJitter: 1, starBonus: 2, backupPenalty: 2 },
  kit: { closeColor: 110 },
  ratings: { compressedCenter: 80, compressedFactor: 0.5, equalScore: 80 },

  speed: {
    min: 6, max: 9, accel: 20,
    /** Narrows the gap between fast and slow teams. 1 keeps the raw 6-9 range. */
    spread: 0.25, spreadCenter: 7.5,
    role: { QB: 0.9, RB: 1, WR: 1, TE: 0.92, OL: 0.7, DL: 0.85, LB: 1.0, DB: 1.06, K: 0.78 } as Record<string, number>,
    staminaLoss: 0.15, staminaYards: 70, conditionWeight: 0.12, dropBackSpeed: 4.5,
  },

  pocket: { dropDepth: 2.5, handoffWindow: 1.2, aimMinHold: 0.12, aimDeadZone: 2.0 },

  pass: {
    speed: 25, bulletMult: 1.6, arcPerYard: 0.16, bulletArcPerYard: 0.05, minPeak: 0.8, throwHeight: 1.8, catchHeight: 1.2,
    rangeLo: 20, rangeHi: 65,
    errorPerAccuracyDeg: 0.4, fatigueErrorDeg: 2.5,
    armFatigueLo: 0.005, armFatigueHi: 0.02, armFatigueMax: 0.25,
    catchRadius: 2.5, catchBase: 0.66, catchPerAttr: 0.04, catchPerMiss: 0.25, catchDefenderNear: 0.15, defenderNearRadius: 1.5, catchBullet: 0.15,
    weatherPenalty: { clear: 0, rain: 0.1, snow: 0.15, wind: 0.05 } as Record<string, number>,
    pickBase: 0.1, pickPerAttr: 0.03, pickPerDist: 0.1,
    windDriftDeg: 2.0,
    piRadius: 1.0, piChance: 0.035, piWindow: 0.35,
  },

  contact: {
    radius: 0.85, retryCd: 0.9, missStun: 0.45, hitSlowTime: 0.3, hitSlowMult: 0.75, knockback: 0.6, fallForward: 0.5,
    tackleBase: 0.5, tacklePerAttr: 0.02, behind: 0.2, headOn: -0.1,
    stiff: -0.35, truckFront: -0.25, truckBehind: 0.2,
    fumbleBase: 0.01, fumblePerAttr: 0.004, fumbleLowCond: 0.01, fumbleWet: 0.005, fumbleDive: 0.02, fumbleHighMult: 2,
  },

  run: {
    carryMult: 0.84,
    jukeTime: 0.3, jukeSpeed: 9, jukeForward: 0.8, jukeRepeatWindow: 1.5, jukeRepeatLoss: 0.1, jukeRecover: 1.5,
    stiffRange: 2, stiffAngleCos: 0.5, stiffTime: 0.45, stiffPerStrength: 0.3,
    diveLo: 1, diveHi: 2, diveTime: 0.35, diveSpeed: 7,
    slowMult: 0.55, slowTime: 0.7,
    truckMult: 0.82, truckFill: 1,
    autoIdle: 1.5, autoLookAhead: 7, autoLanes: 5, autoSideMargin: 1.2, autoLateral: 5, sideMargin: 0.4,
    condPerTouchLo: 0.01, condPerTouchHi: 0.03,
    injuryChance: 0.005,
  },

  ai: {
    coverCushion: 1.1, coverCushionShort: 0.4, coverSoftExtra: 2.5, coverDepth: 6.5, coverDepthShort: 3.5, softDepthExtra: 2,
    backpedalUntil: 4, ballReact: 9, ballReactDelay: 0.3, coverSpeed: 1,
    blitzChance: 0.2, softChance: 0.25,
    rushSpeed: 1, rushShedLo: 0.32, rushShedHi: 0.85, blockStrFactor: 0.03, pushBase: 0.45, pushPerStr: 0.1,
    freeRushSpeedCap: 7.2,
    pursuitLead: 1.0, pursuitLag: 0.15, pursuitSpeed: 1.02,
    blockEngage: 1.1, blockHold: 0.85, blockHoldPerStr: 0.06, blockShedStun: 0.5, blockKeepOff: 0.9, blockFieldRange: 10,
    teSlowBlock: 0.9, separate: 0.55, reblockCd: 0.9, pursuitFloor: 1.5, pursuitCeiling: 1.7, coverFloor: -0.4, coverCeiling: 0.5,
    defenderMissAfterJuke: 0.2,
  },

  play: { bigGain: 20, bigReturn: 30, deadHold: 1.1, celebrateHold: 1.6, routeArriveRadius: 0.5, hitchSpeed: 0.5 },

  fumble: { bounceLo: 0.5, bounceHi: 1.1, speedLo: 2, speedHi: 7, recoverRadius: 1.0, recoverMinTime: 0.25, recoverChance: 0.25, friction: 2.2, popZ: 4, maxLoose: 7 },

  kick: {
    meterHz: 0.9, greenLo: 0.74, greenHi: 0.9, missLoss: 1.1, minPower: 0.25,
    arrowHzBase: 0.55, arrowHzPerAcc: -0.035, arrowHzMin: 0.18, arrowMaxDeg: 13, postLuck: 0.5,
    aimTimeout: 6, autoAimDelay: 0.35, windDeg: 3, kickoffAimFactor: 0.35, puntAimFactor: 0.5, kickoffApproach: 5, holderAhead: 2,
    onsideReturnDepth: 22, onsideFrontDepth: 11, onsidePowerBase: 0.8, onsidePeak: 0.8, onsideRoll: 2.5,
    blockerDepth: 14, blockerStagger: 6, blockerScreen: 6, fgRushSpeed: 0.25, catchFrom: 0.85,
    /** On the kicker's screen, how fast the ball's flight runs until the receiver's frames catch up. */
    shadowRate: 0.6,
    rangeLo: 30, rangeHi: 60, xpDistance: 33, xpMinRange: 40,
    kickerBehindLos: 7, puntBehindLos: 10,
    uprightHalf: 2.0, crossbarZ: 3.0, postHitBand: 0.3, peakPerYard: 0.32, minHang: 0.9, hangPerYard: 0.038,
    kickoffYard: 35, freeKickYard: 20, kickoffBonus: 18, puntBonus: 8, returnerDepth: 44, puntReturnDepth: 40, onsideDistance: 12,
    onsideBase: 0.12, onsidePerAcc: 0.025, onsideHang: 0.9, onsideSpread: 2, catchRadius: 3,
    returnerSpeedAssist: 1.25, ezWindow: 1.1, ezRunOutSpeedMult: 0.9, coverDelay: 0.25, flightClockStopped: true,
    bounceDist: 5, bounceTime: 0.6,
    autoReturnMaxDepth: 3,
  },

  clock: {
    runoff: { 1: 4, 2: 8, 3: 12, 5: 20 } as Record<number, number>,
    twoMinute: { 1: 30, 2: 60, 3: 120, 5: 120 } as Record<number, number>,
    autoTimeouts: { 1: 2, 2: 2, 3: 3, 5: 3 } as Record<number, number>,
    otTimeouts: 2,
  },

  rules: { touchback: 25, xpLosYards: 16, twoPointSpot: 2, firstDownYards: 10 },

  /** Server and client timers, in milliseconds. */
  timers: {
    coinToss: 2800, banner: 2200, scoreBanner: 2600, quarterBreak: 3000, halftime: 7000, twoMinute: 2200, replay: 6000, replayBig: 20,
    pause: 60000, watchdog: 5000, watchdogTick: 1000, cleanup: 2 * 3600 * 1000, handoffBanner: 600,
    choiceDefaultGrace: 300,
  },
  dev: { lowClock: 15, forceHoldInt: 0.6, forceHoldSack: 99 },
  replay: { rate: 0.8, bufferFrames: 1200 },
  fx: { trail: 14, exciteBigPlay: 2500, exciteTouchdown: 4500, exciteFieldGoal: 3000, fireworkScore: 800, fireworkWin: 500, confettiWin: 160, helpedFor: 4000, helpedWalk: 450, particleCap: 400 },
  net: {
    frameMs: 50, bufferMs: 150, bufferMaxMs: 600, maxFrameBytes: 256, maxMsgPerSec: 60, backoffMin: 500, backoffMax: 5000, pingMs: 8000, pongTimeoutMs: 20000,
  },
  input: {
    tapMaxMove: 8, tapMaxMs: 200, swipePx: 24, swipeMs: 250, truckHoldMs: 180,
    aimScale: 0.26, touchTargetMult: 2, touchRadius: 26,
  },
  bot: {
    holdLo: 0.9, holdHi: 3.4, runChance: 0.3, qbRunChance: 0.03, aimErrorYards: 0.6, leadSteps: 8,
    swipeChance: 0.03, jukeRange: 4, goForItToGo: 2, punchChance: 0.5, needCap: 7, valueShort: 0.3, valueDeep: 0.2, valueOpen: 1.2, panicRange: 2.5, panicChance: 0.05, kickMeterSlop: 0.09, kickAimSlop: 0.3,
  },
};

export type Tuning = typeof T;
