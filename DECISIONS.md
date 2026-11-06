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
| 13 | Dev tools in production | `?dev=1` client tools ship, while server dev operations need `DEV_TOOLS=1`, which production never sets | The plan asks for dev tools. The live server refuses its own dev operations, such as changing the clock. The panel's tuning and force buttons still work on a live game, because the controlling browser runs the play, so this relies on players being friends |
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
| 27 | 'All scores' replays | Big plays, plus every other score, including extra points and safeties | The plan names the option but not what it includes |
| 28 | Score banners | Touchdown, field goal, safety and two-point banners show whatever the replay setting is | The setting is about replays. Removing the banner too would make scores easy to miss |
| 29 | Sprite cell | 44 by 34 pixels, with poses written as joints and limbs drawn as lines | A test caught long limbs passing the plan's smaller cell. Joints keep the art compact, as asked |
| 30 | Sprite outline | Every figure has a dark outline | Blue players disappeared against a blue end zone without one |
| 31 | Replay length and speed | The last 4.8 seconds or so of the play, at 0.8 speed | The plan asks for a short replay from saved frames, without a length |
| 32 | Bots and replays | A bot presses skip straight away | Otherwise automated games wait on every replay. People still see them |
| 33 | Menu font | `tools/make-font.ts` builds a font file from the canvas font's glyphs. Letters are proportional and digits are all one width | A fixed-width font left gaps such as 'JOI N'. One set of glyphs keeps menus and game alike, and using no outside font fits the no-library rule |
| 34 | Sound button | The lobby's Sound button opens the player settings panel | Volume, music, name tags and star markers then live in one place |
| 35 | Injured player | The player walks off with a helper, drawn over the next few seconds. The next play doesn't wait for them | The plan asks for a visible injury without a length. It only affects the picture |
| 36 | Indoor stadium | In clear weather, the seed sometimes gives a roof truss instead of sky | It adds variety without a setting, and rain or snow always shows open sky |
| 37 | Music | Only on the title, lobby and halftime screens | The plan rules out music during plays, and lobby waiting is otherwise silent |
| 38 | Crowd | Filtered noise, with swells on big plays | The plan asks for this, and it needs no audio files |
| 39 | Title field | The title screen's field leaves out the midfield team letters | The panel sits over them and left two stray letters showing |
| 40 | Look of the game | Requested look: the feel of retro 16-bit football games. All sprites, menus, fonts and score displays are original drawings for Borg Bowl, with no art, layouts or logos copied from any other game | Another game's art is its publisher's copyright, while a general retro style is free to use |
| 41 | Chunky pixels | Sprites, field lines and particles sit on a 2-pixel grid inside the 640 x 360 canvas, rather than a smaller canvas | Input, camera and layout all stay as they were, and only the drawing changes |
| 42 | Sprite cell | 48 by 42 screen pixels, made from a 24 by 21 art grid. Replaces the 44 by 34 cell in row 29 | The chunkier figures need room for raised arms and jumps |
| 43 | Forced events | A forced interception, fumble or sack stays armed until it really happens | A forced pass can still fall incomplete. If the button were used up by a play that missed, it would look broken |
| 44 | Forced sack | The tackle always lands, can't become a fumble, and a bot holds the ball until it comes | The plan names the button but not how sure it must be |
| 45 | Tuning in online rooms | Panel edits change only that browser | The room server has its own copy of the numbers, and dev operations are off in production |
| 46 | Live test path | The test proxy can also reach an https address, so the same specs run against a deployed copy with delay and drops | Otherwise the live test couldn't add delay or cut connections |
| 47 | Browsers tested | Chromium only, including its phone emulation, at the owner's request | Firefox, Safari and real phones remain manual checks |
| 48 | Catch zone | Each receiver has a hands box on the figure, from the waist (1 yd) to above the head (3 yd), 1 yd either side, measured on the ball as drawn. Inside it the miss costs nothing. Outside it he can stretch 1.3 yd, losing 0.4 a yard, so a ball at his feet is a harder catch | The owner asked for easier catches, with a hit box from the waist up. Testing the drawn ball against the drawn figure makes what the player sees touching what counts |
| 49 | Catch window | The catch is checked every tick from 3 yd before the aimed spot (ball under 3 yd high) until it lands or has carried 3 yd past. A receiver who only gets close tries at his closest point, unless someone is nearer to where the ball will arrive | A single frame at the spot missed balls that visibly went through a receiver. The second rule stops a bystander's stretch from taking a ball thrown to someone else |
| 50 | Interceptions | Still one roll at the aimed spot, and none if a receiver is nearer the ball than the defender. A bad pass, far from every receiver's hands box, adds up to 0.3 to the odds and 1 yd to the defender's reach | The defender used to roll first even when the receiver was on the ball. The owner asked for bad passes to be intercepted more |
| 51 | Aim ring height | The ring is drawn 1.2 yd above its landing spot, where the ball will be drawn on arrival | Players aim at the receiver's body, which made a built-in miss of about 1 yd with the ring on the ground |
| 52 | Hit box overlay | The `?dev=1` panel draws one receiver's hands box and stretch zone, on by default, following your aim or the ball | Lets the catch numbers be tuned by eye while playing |
