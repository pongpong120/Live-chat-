# PingPong Room Premium Upgrade — 2026-10-08

Updated from `PINGPONG-PARTY-PREMIUM-2026-10-08-ROOM-CREATE-SETTINGS-FIX.zip`.

## Room layout
- Honor/Host seat remains at the top.
- Seat No.2 is centered directly below the Host seat.
- Seats No.3–No.7 form the next five-seat row.
- Seats No.8–No.12 form the final five-seat row.
- Existing 12-seat state, socket events, seat joining/leaving and voice publishing logic are unchanged.
- Empty seats keep the supplied transparent microphone artwork.

## Visual upgrade
- Transparent glass room layers with stronger backdrop blur and subtle highlights.
- Premium compact header and ranking/status control.
- Glass seat circles with stable dimensions and subtle speaking animation.
- Transparent floating chat and bottom room controls.
- Safe-area and small-screen adjustments.
- Existing Create Room, Settings, CP Center, Level Management and Admin Management code is preserved.

## Validation
- `node --check public/app.js` passed.
- Existing regression suite: 65/65 suites passed.

This patch is presentation/interaction-layer focused and does not replace the existing project structure.
