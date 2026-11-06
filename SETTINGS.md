# Settings checklist

Every match setting, and what checks it. `rules` is `tests/rules/settings.test.ts`, and `room` is `tests/room/settings.test.ts`.

| Setting | Options | Checked by |
| --- | --- | --- |
| Quarter length | 1, 2, 3, 5 | rules: clock, runoff, warning and timeouts per option |
| Play clock | 10, 15, 25 | room: the time the server reports. `tests/room/match.test.ts`: expiry snaps the play |
| Two-minute warning | on, off | rules |
| Timeouts per half | auto, 0-3 | rules |
| Defense calls | players, computer | rules: who calls, and the computer's call is in from the start. room: the defense player can't call when it's Computer |
| Pauses per player | 0, 2, 5 | rules: pool size. room: running out, and each player's own allowance |
| Reconnect wait | 1, 2, 5 min | room: the time on offer. `tests/room/match.test.ts`: expiry and claim win |
| Difficulty | easy to extreme | rules: table reaches the sim. `tools/balance.ts`: effect on yards, sacks and picks |
| Overtime | standard, sudden, off | rules, plus the overtime cases in `tests/rules/rules.test.ts` |
| Kick returns | live, touchback only | rules, `tests/sim/kick.test.ts`, `tests/e2e/m5-handoff.spec.ts` |
| Onside kicks | on, off | rules, `tests/sim/kick.test.ts` |
| Two-point tries | on, off | rules |
| Penalties | on, off | rules: interference is never flagged when off |
| Fumbles | off, normal, high | rules |
| Bullet passes | on, off | rules |
| Trucking | on, off | rules |
| Fatigue | on, off | rules: stamina, condition and arm |
| Injuries | on, off | rules: backup rated 2 lower, and none when off |
| Team ratings | real, compressed, equal | rules |
| Weather | clear, rain, snow, wind, random | rules: catch, fumble and wind effects, and the seeded pick |
| Aim cursor | fades, full | rules |
| Replays | off, big, all | `tests/rules/presentation.test.ts`, `tests/room/presentation.test.ts`, `tests/e2e/m7-presentation.spec.ts` |
