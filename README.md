# Borg Bowl

A private two-player American football game for phones and desktop browsers, drawn in an original retro pixel style. One player creates a room and sends the link. Before every snap both players get seven seconds in the huddle to call a play, or take the coach's pick. Then whoever has the ball plays it, the other watches, and the computer moves the defenders. An interception or lost fumble hands control to the other player mid-play.

It runs on Cloudflare's free plan: a Worker, plus one Durable Object per room. There are no runtime libraries.

## Run it

You need Node 22.12 or later, which is what Vite and Wrangler ask for. This was built and tested on Node 25.

```sh
npm install
npm run dev
```

Open the address it prints, then open the invite link in a second window to play yourself. Two windows in one browser get separate seats.

| Address | What it does |
| --- | --- |
| `/` | Title screen: create a game, or join with a code |
| `/r/K7P2QX` | Joins that room |
| `/?local=1&q=3&a=SEA&b=LAR` | One match on one device, taking turns. Add `&weather=snow` or `&replays=big` to change those settings |
| `/?practice=1` | Repeated pass plays against each defensive call, with no rules or clock. `&play=N&defense=N` pins the calls by their place in the playbook, such as `&play=0` for HB Dive |
| `/dev/sprites` | Every sprite in every team's colours |

Add `?dev=1` to a match or practice address for the developer panel, opened with the DEV button. Add `&bot=1` to let a bot play your side, and `&speed=4` to run the sim faster.

| In the panel | What it does |
| --- | --- |
| Number list | Edits any value in `tuning.ts` live, with a filter, Reset and Copy changes. Edits stay in that browser until a reload |
| Bot | Switches the bot on or off for your side |
| Interception, Fumble, Sack | Forces that event on your plays with the ball, and stays on until it happens |
| Low clock | Sets the game clock to 0:15. The room server does this, so a deployed copy refuses it |
| Download last play | Saves that play's frames and state as JSON, for bug reports |

In an online room, tuning edits change only your own browser. The room's timers keep their saved values, since those run on the server.

## Calling plays

The offense's playbook has 24 plays in four tabs (Run, Short, Deep, Special), and the defense has nine calls in three (Man, Zone, Pressure). Each card shows the play drawn out, its formation and the gain it is built for. The big card on the left is the coach's pick for the down, distance, clock and score. Tap it or press Space to call it. Other plays are a tab and a card away, or Q and E then 1 to 6 on a keyboard.

Each side sees only its own pick and call until the huddle breaks. If the seven seconds run out, the coach's pick goes in. The Defense calls setting decides who calls the defense: the player without the ball, or the computer. On one device the offense calls first, then the defense.

## Test it

```sh
npm run typecheck       # Strict TypeScript across the whole project
npm test                # Rules, simulation, balance, art and room tests
npm run test:e2e        # Chromium, with added network delay. Saves screens into screenshots/
npm run balance         # Prints bot statistics for the balance targets
```

`npm test` starts its own local server on port 5198, and `npm run test:e2e` starts one on port 5199. Both write `.dev.vars` with `DEV_TOOLS=1` if it's missing, because tests need the server's debug operations. Production never sets that value.

To run the browser tests against a deployed copy:

```sh
E2E_BASE_URL=https://borg-bowl.<your-subdomain>.workers.dev npx playwright test tests/e2e/m4-online.spec.ts tests/e2e/m8-dev.spec.ts
```

`m4-online.spec.ts` plays a full game with a disconnect and a reload, and `m8-dev.spec.ts` includes a check that the server refuses debug operations. Both need only the public game. Other specs can't run against production, because they use server debug operations, which are off there.

## Deploy it

Once, on your machine:

```sh
npx wrangler login
```

Then every time:

```sh
npm run deploy          # vite build && wrangler deploy
```

The game goes live at `https://borg-bowl.<your-subdomain>.workers.dev`, and invite links look like `/r/K7P2QX` on that address.

The site sends `X-Robots-Tag: noindex` and has no public room list, so only someone with the address can reach it. Don't post the address publicly. It stores only nicknames and match state, and removes them when a room is cleaned up after 2 hours of no activity.

## How it's built

```text
src/shared/sim/     The play simulation: pure, seeded, 60 Hz. No browser or server code
src/shared/rules/   Match rules as pure functions: (match, event) -> match
src/shared/data/    Teams, rosters, playbook, settings
src/server/         core.ts holds the room logic, and room.ts adapts it to a Durable Object
src/client/game/    Controller and watcher loop, replays, presentation
src/client/render/  Stadium, scene, overlays, effects, HUD
src/client/art/     Sprites: body grids, poses as joints, recolouring
src/client/audio/   Synthesized sound effects and a step sequencer for music
src/client/ui/      Lobby, menus, player settings, final screen, developer panel
tools/balance.ts    Bot statistics
tools/make-font.ts  Builds the menu font from the game's bitmap glyphs
```

- **Network model:** the player with the ball runs the sim in their browser and streams 118-byte frames at 20 Hz. The room relays them without reading them. The watcher buffers about 150 ms and smooths between frames.
- **Handoff:** on a turnover the full sim state goes to the room, which either gives control to the other player or tells the sender to carry on with an auto-runner.
- **Trust:** browsers are trusted, with basic server checks. This is a game among friends.
- **Tuning:** every tunable number lives in `src/shared/sim/tuning.ts`, and the `?dev=1` panel edits it live.
- **Art:** sprites come from a few body grids, with poses written as joints, drawn at half size and doubled for chunky pixels. All art is original to this game, and `screenshots/` shows every screen.

`DECISIONS.md` records each gap in the plan and the choice made. `SETTINGS.md` lists what checks each match setting.

## If something goes wrong

- **The game won't start with "Durable Object" errors:** run `npm install` again, and check that `wrangler.jsonc` is unchanged.
- **Errors about free-plan limits after deploying:** the free plan's CPU rule for Durable Objects is unclear in Cloudflare's docs. The paid plan removes the limit.
