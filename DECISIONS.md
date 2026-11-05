# Decisions

Gaps in the plan, and the simplest choice made for each.

| # | Topic | Decision | Why |
| --- | --- | --- | --- |
| 1 | Room tests | Node WebSocket clients against the real local runtime (Vite + workerd) rather than `@cloudflare/vitest-pool-workers` | The plugin needs vitest ^4.1, while the project uses vitest 5. Real sockets also exercise hibernation handlers, alarms and restarts, which the plan's fallback allows |
| 2 | Socket tags | `serializeAttachment` holds the seat instead of `acceptWebSocket(socket, [seat])` | A seat is only known after the `join` message, and tags are fixed at accept |
| 3 | Room logic location | `src/server/core.ts` holds room logic with no Cloudflare imports, and `room.ts` is a thin adapter | The same code then runs in tests and in one-device games |
| 4 | Same-browser windows | A token in `sessionStorage` is firm. A token only found in `localStorage` is "soft": if its seat is in use and the other seat is free, the window takes the free seat | The plan wants two windows on one machine to play each other and a reload to keep the seat |
| 5 | Create vs join | `join` carries `create: true` for a new room. Joining a code with no room gets "Room not found" | Otherwise a mistyped code silently creates an empty room |
