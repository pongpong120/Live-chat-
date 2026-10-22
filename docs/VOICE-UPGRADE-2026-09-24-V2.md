# PingPong Voice Stability Upgrade V2 — 2026-09-24

Applied on top of `PINGPONG-PRODUCTION-VOICE-STABLE-2026-09-24.zip` without removing existing features.

## Additional fixes

- Reconnect-grace signaling is now actually consumed by mesh peer recovery instead of being only informational.
- When a remote seated user reconnects with a new Socket.IO id, stale WebRTC peers tied to the old socket are closed before the fresh peer is created.
- Audience listeners use the same resumed-peer recovery path; recovery is no longer seat-only.
- During a server reconnect grace window, failed/disconnected mesh peers are held briefly instead of rebuilding against a socket that is about to disappear.
- WebRTC signaling now requires the target socket id to match the room's current authoritative socket id for both seated and audience users. Stale in-flight offers/answers/candidates are discarded.
- Cross-instance `io.to(socketId)` delivery remains supported when Redis Socket.IO adapter is enabled.

## Preserved

Firebase authentication, rooms, 12-seat behavior, audience listening, gifts/wallet, games, admin, LiveKit/SFU code, Android voice foreground service, and existing room lifecycle logic were not removed or replaced.

## Validation

- `node --check public/app.js` — PASS
- `node --check server.js` — PASS
- `seatChangeVoiceRenegotiation.test.js` — 7/7 PASS
- `voiceRecoveryStatic.test.js` — PASS
- `voiceCrossInstanceEmit.test.js` — PASS
- `voiceSfuLiveKitIntegration.test.js` — 31/31 PASS
- `joinRoomLifecycleFix.test.js` — 31/31 PASS
