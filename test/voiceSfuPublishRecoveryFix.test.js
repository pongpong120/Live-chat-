// test/voiceSfuPublishRecoveryFix.test.js
// ==================================================
// ROOT-CAUSE REGRESSION (2026-09-26) — "audience can't hear seated user"
// ==================================================
// The bug: public/voice-sfu.js's isConnected() only ever reported whether a
// LiveKit Room object existed — true for a subscribe-only audience
// connection AND for a seated user whose mic publish failed (the documented
// PHASE3_STEP36_REPORT.md seat-publish-permission race, or a connect()/
// publishTrack() failure during the very first join). app.js's self-heal
// loop (scheduleSfuRecovery) used isConnected() alone to decide "this seat
// is already fine, nothing to retry" — so a seated user stuck in that race
// stayed connected-but-silent forever: talking into a socket nobody
// subscribed to, no toast, no retry, no fix short of leaving and re-taking
// the seat.
//
// Fix: voice-sfu.js now (a) fully unwinds currentRoom/currentMicPublication
// on any connect()/publishTrack() failure so isConnected() tells the truth,
// and (b) exposes isMicPublished() so a caller can tell "room connected" apart
// from "room connected AND actually publishing". app.js's recovery loop uses
// both via a single sfuIsHealthy() helper.
//
// This suite behaviorally exercises voice-sfu.js's state machine against a
// fake LiveKit SDK (no real network/LiveKit server needed — same sandboxed
// approach as voiceSfuLiveKitIntegration.test.js) and statically confirms
// app.js wires the fix in (same pattern as voiceRecoveryStatic.test.js,
// which already does this for the surrounding recovery loop — app.js is a
// 12k-line browser file with DOM dependencies throughout, so it is not
// require()'d directly, only inspected for the source-level invariant that
// matters here).

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let passed = 0;
function check(label, fn) {
  fn();
  passed++;
  console.log(`  \u2713 ${label}`);
}

// ---------- minimal browser shim so voice-sfu.js's IIFE can load ----------
const listeners = {}; // per-test-run scratch, reset before each fresh Room
function makeFakeRoom(behavior) {
  const handlers = {};
  const room = {
    on(event, cb) { handlers[event] = cb; return room; },
    localParticipant: {
      _pub: null,
      async publishTrack(track, opts) {
        if (behavior.publishShouldFail) {
          const e = new Error("insufficient permissions to publish (canPublish=false)");
          throw e;
        }
        const pub = { track, isMuted: false };
        room.localParticipant._pub = pub;
        return pub;
      },
      getTrackPublication(source) { return room.localParticipant._pub || undefined; },
      async unpublishTrack(track) { room.localParticipant._pub = null; }
    },
    async connect(url, token) {
      if (behavior.connectShouldFail) throw new Error("connection rejected");
    },
    async disconnect() { if (handlers["disconnected"]) {} },
    canPlaybackAudio: true,
    remoteParticipants: new Map(),
    _fire(event, ...args) { if (handlers[event]) handlers[event](...args); }
  };
  return room;
}

global.window = global.window || {};
global.document = {
  createElement: () => ({ }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {}
};

let nextBehavior = { connectShouldFail: false, publishShouldFail: false };
window.LivekitClient = {
  Room: function Room() { return makeFakeRoom(nextBehavior); },
  RoomEvent: {
    TrackSubscribed: "trackSubscribed", TrackUnsubscribed: "trackUnsubscribed",
    Disconnected: "disconnected", Reconnecting: "reconnecting", Reconnected: "reconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged", AudioPlaybackStatusChanged: "audioPlaybackStatusChanged"
  },
  Track: { Source: { Microphone: "microphone" } }
};

const voiceSfuSrc = fs.readFileSync(path.join(__dirname, "..", "public", "voice-sfu.js"), "utf8");
// eslint-disable-next-line no-eval
eval(voiceSfuSrc); // defines window.PingPongVoiceSFU via the IIFE, same file used by the browser
const sfu = window.PingPongVoiceSFU;
assert(sfu && typeof sfu.isMicPublished === "function", "voice-sfu.js must export isMicPublished()");

(async () => {
  // 1. A connect() that fails outright (e.g. LiveKit rejects the join) must
  //    leave isConnected() false — not stuck true from the pre-connect assignment.
  nextBehavior = { connectShouldFail: true, publishShouldFail: false };
  let threw = false;
  try { await sfu.connect({ url: "wss://fake", token: "t", micTrack: {} }); } catch (e) { threw = true; }
  check("connect() rejection propagates to the caller", () => assert(threw));
  check("isConnected() is false after a failed connect() (no phantom connection)", () => assert.strictEqual(sfu.isConnected(), false));
  check("isMicPublished() is false after a failed connect()", () => assert.strictEqual(sfu.isMicPublished(), false));

  // 2. Room connects fine, but the initial mic publish is rejected (the
  //    seat-publish-permission race, hit on the very first join).
  nextBehavior = { connectShouldFail: false, publishShouldFail: true };
  threw = false;
  try { await sfu.connect({ url: "wss://fake", token: "t", micTrack: {} }); } catch (e) { threw = true; }
  check("publishTrack() rejection during connect() propagates to the caller", () => assert(threw));
  check("isConnected() is false when the initial publish failed (this is the exact bug: it used to report true)", () => assert.strictEqual(sfu.isConnected(), false));
  check("isMicPublished() is false when the initial publish failed", () => assert.strictEqual(sfu.isMicPublished(), false));

  // 3. Fully healthy seated connection: connect + publish both succeed.
  nextBehavior = { connectShouldFail: false, publishShouldFail: false };
  await sfu.connect({ url: "wss://fake", token: "t", micTrack: { readyState: "live" } });
  check("isConnected() is true after a successful connect()+publish", () => assert.strictEqual(sfu.isConnected(), true));
  check("isMicPublished() is true after a successful publish", () => assert.strictEqual(sfu.isMicPublished(), true));

  // 4. Audience downgrade: unpublish keeps the Room connected (still hearing
  //    everyone) but must no longer report as publishing.
  await sfu.unpublishMicTrack();
  check("isConnected() stays true after unpublishMicTrack() (audience still subscribed)", () => assert.strictEqual(sfu.isConnected(), true));
  check("isMicPublished() is false after unpublishMicTrack() (correctly distinguishes audience-only from seated+publishing)", () => assert.strictEqual(sfu.isMicPublished(), false));

  await sfu.disconnect();
  check("isConnected() is false after disconnect()", () => assert.strictEqual(sfu.isConnected(), false));

  // ---------------- app.js wiring (static, same convention as voiceRecoveryStatic.test.js) ----------------
  const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  check("app.js defines a combined health check (sfuIsHealthy) rather than trusting isConnected() alone", () =>
    assert(/function sfuIsHealthy\s*\(/.test(app)));
  check("sfuIsHealthy() consults isMicPublished() for the seated case", () => {
    const fn = app.slice(app.indexOf("function sfuIsHealthy"), app.indexOf("function sfuIsHealthy") + 600);
    assert(fn.includes("isMicPublished"));
  });
  check("scheduleSfuRecovery()'s early-exit guard uses sfuIsHealthy(), not a bare isConnected() check", () => {
    const fn = app.slice(app.indexOf("function scheduleSfuRecovery"), app.indexOf("function scheduleSfuRecovery") + 1600);
    assert(fn.includes("sfuIsHealthy()"));
    assert(!/if \(sfuVoiceLeaving \|\| !currentRoomId \|\| !me \|\| window\.PingPongVoiceSFU\.isConnected\(\)\) return;/.test(fn));
  });

  console.log(`\n${passed} assertions passed`);
  console.log("voiceSfuPublishRecoveryFix: PASS");
})().catch((e) => {
  console.error("voiceSfuPublishRecoveryFix: FAIL:", e && e.stack || e);
  process.exit(1);
});
