# Borg Bowl

A private two-player American football game for phones and desktop browsers. One player creates a room and sends the link. Whoever has the ball plays it, the other watches, and the computer plays defense for both. An interception or lost fumble hands control to the other player mid-play.

It runs on Cloudflare's free plan: a Worker, plus one Durable Object per room. There are no runtime libraries.

## Run it

You need Node 22 or later.

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
| `/?practice=1` | Repeated pass plays, with no rules or clock |
| `/dev/sprites` | Every sprite in every team's colours |

Add `?dev=1` to any match address for the tuning panel and debug buttons. Add `&bot=1` to let a bot play your side, and `&speed=4` to run the sim faster.

## Test it

```sh
npm run typecheck       # Strict TypeScript across the whole project
npm test                # Rules, simulation, balance, art and room tests
npm run test:e2e        # Real browsers, with added network delay. Saves screens into screenshots/
npm run balance         # Prints bot statistics for the balance targets
```

`npm test` starts its own local server on port 5198, and `npm run test:e2e` starts one on port 5199. Both write `.dev.vars` with `DEV_TOOLS=1` if it's missing, because tests need the server's debug operations. Production never sets that value.

To run the browser tests against a deployed copy:

```sh
E2E_BASE_URL=https://borg-bowl.<your-subdomain>.workers.dev npx playwright test tests/e2e/m4-online.spec.ts
```

Tests that use server debug operations can't run against production, because the debug operations are off there. `m4-online.spec.ts` plays a full game with a disconnect and a reload, and needs none of them.

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
src/client/ui/      Lobby, menus, player settings, final screen
tools/balance.ts    Bot statistics
tools/make-font.ts  Builds the menu font from the game's bitmap glyphs
```

- **Network model:** the player with the ball runs the sim in their browser and streams 118-byte frames at 20 Hz. The room relays them without reading them. The watcher buffers about 150 ms and smooths between frames.
- **Handoff:** on a turnover the full sim state goes to the room, which either gives control to the other player or tells the sender to carry on with an auto-runner.
- **Trust:** browsers are trusted, with basic server checks. This is a game among friends.
- **Tuning:** every number lives in `src/shared/sim/tuning.ts`, and the `?dev=1` panel edits it live.

`DECISIONS.md` records each gap in the plan and the choice made. `SETTINGS.md` lists what checks each match setting.

## If something goes wrong

- **The game won't start with "Durable Object" errors:** run `npm install` again, and check that `wrangler.jsonc` is unchanged.
- **Errors about free-plan limits after deploying:** the free plan's CPU rule for Durable Objects is unclear in Cloudflare's docs. The paid plan removes the limit.
