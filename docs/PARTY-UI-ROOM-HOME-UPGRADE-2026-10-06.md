# Party UI / Room / Home Upgrade — 2026-10-06

## Home
- Reworked outer Home chrome to match the supplied light/mint reference.
- Top navigation is Mine / Popular with compact search and home controls.
- Removed visible My Room card and Create Room CTA from Home.
- Secondary tabs are Recently / Followed Rooms / Followed Users.
- Room cards are one-by-one, large-thumbnail, clean white/glass cards.
- Bottom navigation is fixed inside the viewport with safe spacing.

## Party Room
- Physical seat #1 is now the Honor Seat and is rendered above the regular seat grid.
- Regular grid renders physical seats #2–#12.
- Honor Seat is transparent/glass and shows a microphone when empty.
- Only room owner/admins can occupy Honor Seat; server-side enforcement is included.
- The current Honor Seat occupant can tap the Honor Seat to leave it.
- Other users can view the occupant profile but cannot take the Honor Seat.
- Removed the duplicate ranking strip/star block; Ranking is now a single compact control in the upper status bar.
- Empty regular seats use the transparent microphone artwork.
- Room toolbar/header/icon sizing is normalized and safe-area aware.

## Compatibility
- Existing seat socket operation remains `take-seat` / `leave-seat`; Honor Seat uses physical seat #1.
- Existing voice publishing remains tied to the real seat state.
- No separate fake UI-only voice seat was introduced.

## Validation
- JavaScript syntax checks: PASS
- Full regression suite: 65/65 suites passed
