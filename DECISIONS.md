# Decisions

Gaps in the plan, and the simplest choice made for each.

| # | Topic | Decision | Why |
| --- | --- | --- | --- |
| 1 | Room tests | Node WebSocket clients against the real local runtime (Vite + workerd) rather than `@cloudflare/vitest-pool-workers` | The plugin needs vitest ^4.1, while the project uses vitest 5. Real sockets also exercise hibernation handlers, alarms and restarts, which the plan's fallback allows |
| 2 | Socket tags | `serializeAttachment` holds the seat instead of `acceptWebSocket(socket, [seat])` | A seat is only known after the `join` message, and tags are fixed at accept |
| 3 | Room logic location | `src/server/core.ts` holds room logic with no Cloudflare imports, and `room.ts` is a thin adapter | The same code then runs in tests and in one-device games |
| 4 | Same-browser windows | A token in `sessionStorage` is firm. A token only found in `localStorage` is "soft": if its seat is in use and the other seat is free, the window takes the free seat | The plan wants two windows on one machine to play each other and a reload to keep the seat |
| 5 | Create vs join | `join` carries `create: true` for a new room. Joining a code with no room gets "Room not found" | Otherwise a mistyped code silently creates an empty room |
| 6 | A pick in one's own end zone | The interceptor waits for a tap, as a kick returner does: tap to run, or take the touchback | The plan says it can be returned or taken as a touchback, but not how the player chooses |
| 7 | Speed curve | The plan's speed formula stays, then `speed.spread` (0.25) narrows it around 7.5 attribute points | With the plan's full curve, 99 v 60 gained 18.9 yards a play. Isolating attributes showed speed caused most of the gap |
| 8 | Other balance departures | Tackle slope .06 to .02; catch base .66 and slope .04; accuracy error 0.4 degrees a point; role speeds and carry multiplier reduced; pursuers are held to 1.5 to 1.7 yd/s faster than the carrier, and coverage to -0.4 to +0.5 yd/s of the receiver; a shed defender can't be re-blocked for 0.9 s; shed odds .32 to .85 | Needed to reach the plan's balance targets. All are in `tuning.ts` |
| 9 | Where balance is measured | Inside real games with `matchup()`, not on isolated plays | End zones and downs cap real gains. Isolated plays read about 2 yards higher. The numbers come from the bot, which throws near the sticks, so real players will differ |
| 10 | Arm fatigue cap | Capped at 25% of range | An uncapped arm could lose half its range in a long game, which ends the passing game |
| 11 | Dropped controller after a kick handoff | The ball is spotted at the landing point, or a touchback if that's in the end zone | The plan covers turnovers but not kicks |
| 12 | Rematch | Either player can press it | Simplest reading of 'Rematch keeps the room and settings' |
| 13 | Dev tools in production | `?dev=1` client tools ship, while server dev operations need `DEV_TOOLS=1`, which production never sets | The plan asks for dev tools. A friend's browser mustn't be able to force a result on a live server |
| 14 | Dropped controller with a hidden page | Voids the play, like a closed socket | Their browser may be throttled and can't be relied on to finish it |
| 15 | Pause resume | Restarts a full play clock | Fairer than resuming a nearly spent clock, and simplest |
| 16 | Kick handoff picture | The kicker's screen keeps its own copy running at 0.6 speed until the receiver's frames catch up | The plan asks for no freeze on kicks. Rewinding the picture would look wrong |
| 17 | Watcher before the first kick tap | Frames start at the snap, so a watcher doesn't see the power meter before the first tap | Frame streaming begins when the play does |
| 18 | Kick teams | Cover team: the defense's slots except slot 10. Return team: the offense's slots, with the fastest WR or RB returning. Holder: the QB. The kicker also punts | The roster has no special teams, and the plan doesn't say who plays |
| 19 | Kick aim timeout | Aim waits 6 s, then auto-kicks | The plan's play clock covers the first tap only |
| 20 | Wind on kicks | Wind pushes kicks off line by up to 3 degrees | The plan's wind pushes passes. The same should apply to kicks |
| 21 | Touchback-only punts | They stop at the landing spot | Simplest match for 'no returns' |
| 22 | Lobby pointer | The lobby keeps M0's rival pointer | It's already there, and shows the other person is live |
| 23 | Network delay in tests | The test proxy's delay applies in each direction | The plan says 'added delay' without saying which way. This is the stricter reading |
| 24 | `.dev.vars` | Created by the test setup if missing | Tests need `DEV_TOOLS=1`, and the file is gitignored |
| 25 | Reconnect during a banner | A banner plays to the end, then the match waits at the next dead ball | Banners cost nothing, and a frozen banner looks like a crash |
| 26 | Refused pauses | A pause with none left is ignored with no error, and the button is disabled | Nothing useful to tell the player that the button doesn't |
