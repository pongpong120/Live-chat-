# PingPong Clean Source Release

This archive is a source-clean release prepared from the supplied project.

## Cleanup performed
- Removed the unused `integration_update/` legacy tree.
- Removed the unreferenced legacy `public/images/maza-gifts/` asset bundle.
- Removed historical root-level audit/release report clutter; active documentation under `docs/` and `README.md` is retained.
- Removed stale production Railway URLs from the environment template.
- Corrected the voice environment template to use the runtime variable `TURN_URL`.
- Added `livekit-server-sdk` as an explicit production dependency because the existing SFU implementation uses it.
- Preserved application data, uploads, database migrations, tests, Android project, admin panel, and active runtime modules.

## Voice reliability
The project retains its existing mesh fallback, TURN support, reconnect handling, and LiveKit SFU path. For production multi-user voice, configure LiveKit + TURN and set `VOICE_MODE=sfu` only after a real deployment smoke test.

## Verification performed
- JavaScript syntax check across the source tree: passed.
- Static asset-reference audit: no unresolved literal runtime asset references found after excluding intentionally dynamic paths and test fixtures.
- Legacy integration tree was not referenced by the active runtime graph.

## Bug-fix + cleanup pass (2026-09-25)
Root-caused via a full require-graph trace, a client↔server socket-event
cross-check, and a DOM-id cross-check between `public/app.js` and
`public/index.html` (every `$("id")`/`$('id')` matched against actual
`id="..."` markup). Two confirmed, reproducible crashes fixed; several
confirmed-dead code paths removed. No feature, route, socket event, or
design/markup was changed beyond what's listed here.

**Fixed:**
- `hideCallOverlay()` (private inbox voice/video call cleanup, `public/app.js`)
  unconditionally wrote to `#call-video-local` / `#call-video-local-wrap`,
  neither of which exist in `index.html`'s private call markup. This threw a
  TypeError on every call hangup, aborting the rest of that cleanup function.
  Now guarded the same way the existing video-track-recovery handler in the
  same file already guards the identical lookup.
- The chest-opening reward animation (`socket.on("chest-opened", ...)` →
  the function that builds the 3‑2‑1 countdown) wrote to
  `$('chest-open-kicker')`, but that element in `index.html` had a class,
  not an `id`. This threw immediately for every user in the room the moment
  anyone opened a treasure chest, aborting the whole reveal sequence before
  the countdown/video ever ran. Added the missing `id="chest-open-kicker"`.

**Removed (confirmed unreachable — zero references anywhere in the
runtime require-graph, sockets, routes, or DOM, beyond a function's own
dead test file):**
- `db/repository.js`, `db/CALL_SITE_PATTERN_EXAMPLE.js` (an explicitly
  not-yet-applied migration-stage reference doc, per its own header),
  `middleware/idempotency.js`, `jobs/queue.js` (with the now-empty
  `middleware/` and `jobs/` folders), `club.service.js` +
  `test/clubService.test.js`.
- Ten dead functions in `public/app.js` that were defined but never called
  from anywhere (`countryFlagPrefix`, `loadPopularEvents`,
  `vipLevelFromDiamondsClient`, `createRoomLevelBadge`, `refreshSvipCenter`,
  `openCpCenter`, `chestRewardFrameHtml`, `animateCountUp`,
  `loadRechargeHistory`, `loadDiamondSellerList`) — the last two, and an
  adjoining dead "Instant Exchange" input/button listener block, were
  superseded when the wallet UI moved into the `public/wallet-ui.html`
  React iframe, which already implements recharge history, the diamond
  seller list, and instant exchange independently.

**Investigated and confirmed NOT bugs** (so left untouched, despite
looking suspicious on first read): the `mobile`/`found.mobile` session
lines in the password and ID+password login routes; the room-lock check
inside `POST /api/gifts/send`. All variables involved are correctly in
scope; re-verified with a clean TypeScript `checkJs` pass plus manual
read of the enclosing function.

**Known incomplete feature, not touched (not a regression):** the
client emits a `game-toggle` socket event when the in-room TV
game panel opens/closes, but no `socket.on("game-toggle", ...)` exists
on the server to relay it, and the client has no listener to apply a
remote `game-toggle` to other room members either. Today only the room
owner's own screen reflects the TV panel state; nothing broadcasts it to
other people in the room. Wiring this up is new behavior (a broadcast
handler + a remote-apply listener), not a bug fix, so it was left as-is
pending a product decision on the intended payload/behavior.
