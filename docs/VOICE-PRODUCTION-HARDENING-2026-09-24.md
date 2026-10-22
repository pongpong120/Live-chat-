# PingPong Voice Production Hardening — 2026-09-24

## What was hardened

- Mesh voice remains compatible as the current no-LiveKit transport.
- Seated speakers can be heard by other seated users and room audience listeners.
- Seat -> audience no longer destroys the local media stream; the local audio sender is detached/muted while the receive-side peer connections remain alive.
- Audience -> seat reuses the existing transport and restores the audio sender without tearing down the room voice graph.
- Seat moves do not intentionally renegotiate healthy peers.
- WebRTC ICE candidate messages are queued when they arrive before the remote description and flushed after the description is set. This prevents early candidates from being silently lost.
- ICE recovery is less aggressive: transient `disconnected` states get a grace window; failed paths try ICE restart before rebuilding the peer.
- Audience clients are included in failed-peer recovery; recovery is no longer limited to seated clients.
- Local audio tracks are only attached to mesh senders while the user is actually seated.
- Peer recovery timers and pending ICE candidates are cleared with the peer lifecycle.
- Room voice waits for the configured ICE/TURN server list before creating the first peer, reducing the chance that the first connection starts with a temporary STUN-only configuration.
- Socket reconnect resolves the active voice mode before rejoining a room, reducing mesh/SFU transport races during mobile reconnects.
- SFU microphone publication is guarded against duplicate publication during repeated seat-upgrade events.

## Transport architecture

### Current mesh mode

The current fallback remains WebRTC mesh. It is hardened for mobile reconnects and audience listening, but mesh still has an inherent scaling cost: every active speaker/listener relationship is peer-to-peer. It is not possible to make browser mesh have the same scalability characteristics as an SFU purely with client-side bug fixes.

### LiveKit/SFU mode

The project already contains a LiveKit SFU provider. When `VOICE_MODE=sfu` is configured with valid LiveKit credentials, the client uses one LiveKit room connection and LiveKit handles server-side media distribution and reconnect/ICE recovery. The LiveKit client exposes reconnect/reconnected lifecycle events, and LiveKit's documented reconnect flow includes signaling reconnection and ICE restart where possible.

## Validation performed

Passed:

- `test/seatChangeVoiceRenegotiation.test.js` — 7/7
- `test/voiceSfuLiveKitIntegration.test.js` — 31/31
- `test/joinRoomLifecycleFix.test.js` — 31/31
- JavaScript syntax checks for `public/app.js` and `public/voice-sfu.js`

The complete `test/run-all.js` suite was started but exceeded the available execution window in this build environment; no failure from that timeout is being represented as a test failure.

## Important production requirement

For real mobile-network production, the deployment should provide a reliable TURN service through the existing server ICE endpoint (preferably Cloudflare TURN or another dedicated TURN provider). STUN alone cannot reliably traverse carrier-grade/symmetric NAT. The bundled public TURN fallback is a compatibility fallback, not a substitute for operator-controlled production TURN.

## Manual acceptance matrix before public launch

1. Two users seated in one room: A -> B and B -> A audio.
2. Three or more seated users: every speaker audible to the others.
3. Audience joins an active room: audience hears all seated speakers.
4. Speaker leaves seat: audience continues hearing other seated speakers.
5. Audience takes seat: microphone begins publishing without losing existing received audio.
6. User moves between seats: no voice interruption or duplicate audio.
7. Wi-Fi -> mobile data and mobile data -> Wi-Fi: automatic recovery.
8. Temporary network loss: ICE restart/rebuild without manual room re-entry.
9. Socket.IO reconnect while media remains healthy: no duplicate peer graph.
10. Multiple simultaneous rooms with different users: room isolation and signaling targets remain correct.
11. LiveKit mode: same seat/audience behavior after enabling SFU.
