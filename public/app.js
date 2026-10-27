/* ==========================================================================
   PingPong frontend — talks to server.js exactly as written.
   ========================================================================== */

// ---------------------------------------------------------------------------
// Global crash safety net (audit fix, 2026-07-29).
// This file has a documented history of a single uncaught exception ANYWHERE
// in top-level script execution silently aborting everything below it,
// including the bootstrap()/login-restore call at the very bottom (see the
// "fatal crash on every page load" and "settings-icon-does-nothing" fix
// notes further down for two real past incidents of exactly this). Per-call
// try/catch has been added at every known past failure point, but that only
// protects against failures we've already seen once. This block is placed
// as the very first executable code in the file, before anything else that
// could throw, so it is guaranteed to register regardless of what happens
// later in the script:
//   1. Logs every uncaught error/rejection clearly to the console instead of
//      failing silently, so a future issue is diagnosable from one refresh
//      instead of a multi-round guessing process.
//   2. A watchdog: if no view has become visible within 6s of the page
//      loading (the one observable symptom every past "silent crash" case
//      shared), force the login screen instead of leaving the user on a
//      frozen/blank page that looks like nothing happened.
// This changes no normal-path behavior — enterApp()/bootstrap() already
// show a view almost immediately, so the watchdog never fires in the
// working case.
(function () {
  window.addEventListener("error", (e) => {
    console.error("[GLOBAL ERROR]", e.message, "at", e.filename + ":" + e.lineno);
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[GLOBAL ERROR] unhandled promise rejection:", e.reason);
  });
  setTimeout(() => {
    const anyViewVisible = document.querySelector(".view.active");
    if (!anyViewVisible) {
      console.error("[WATCHDOG] no view became visible within 6s of page load — a top-level script error likely aborted bootstrap(); forcing login screen instead of leaving a blank page.");
      const loginView = document.getElementById("view-login");
      if (loginView) loginView.classList.add("active");
    }
  }, 6000);
})();

const API = ""; // same-origin
const GIFT_CATALOG_CACHE = { gifts: [] };
const DEFAULT_ROOM_THEME_URL = "/images/premium-haco/themes/royal-gold.webp";
const DEFAULT_ROOM_LOGO_URL = "/images/room-default-logo.png";
const DEFAULT_ROOM_UI_CONFIG = { seatSize: 56, frameScale: 1.4 };
const DEFAULT_ROOM_EFFECT_PREFS = Object.freeze({ giftEffect: true, giftSound: true, entryAnimation: true });
let roomEffectPrefs = { ...DEFAULT_ROOM_EFFECT_PREFS };
function loadRoomEffectPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem("pp-room-effect-prefs") || "{}");
    roomEffectPrefs = {
      giftEffect: raw.giftEffect !== false,
      giftSound: raw.giftSound !== false,
      entryAnimation: raw.entryAnimation !== false
    };
  } catch (_) { roomEffectPrefs = { ...DEFAULT_ROOM_EFFECT_PREFS }; }
  applyRoomEffectPrefs();
}
function saveRoomEffectPrefs() {
  try { localStorage.setItem("pp-room-effect-prefs", JSON.stringify(roomEffectPrefs)); } catch (_) {}
}
function applyRoomEffectPrefs() {
  const root = document.documentElement;
  root.classList.toggle("pp-gift-effects-off", !roomEffectPrefs.giftEffect);
  root.classList.toggle("pp-gift-sound-off", !roomEffectPrefs.giftSound);
  root.classList.toggle("pp-entry-animation-off", !roomEffectPrefs.entryAnimation);
  [
    ["btn-toggle-gift-effect", roomEffectPrefs.giftEffect],
    ["btn-toggle-gift-sound", roomEffectPrefs.giftSound],
    ["btn-toggle-entry-animation", roomEffectPrefs.entryAnimation]
  ].forEach(([id, on]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
    const state = btn.querySelector(".effect-toggle-state");
    if (state) state.textContent = on ? "ON" : "OFF";
  });
}
function toggleRoomEffectPref(key) {
  if (!(key in roomEffectPrefs)) return;
  roomEffectPrefs[key] = !roomEffectPrefs[key];
  saveRoomEffectPrefs();
  applyRoomEffectPrefs();
  if (key === "giftEffect" && !roomEffectPrefs.giftEffect) {
    try { document.querySelectorAll(".legend-gift-overlay.show").forEach(el => el.classList.add("hidden")); } catch (_) {}
    try { document.querySelectorAll(".video-gift-overlay:not(.hidden)").forEach(el => el.classList.add("hidden")); } catch (_) {}
  }
  if (key === "entryAnimation" && !roomEffectPrefs.entryAnimation) {
    try { stopPremiumRoomEntryEffect(); } catch (_) {}
    try { document.querySelectorAll("#vehicle-entry-overlay:not(.hidden)").forEach(el => el.classList.add("hidden")); } catch (_) {}
  }
  toast(`${key === "giftEffect" ? "Gift Effect" : key === "giftSound" ? "Gift Sound" : "Entry Animation"} ${roomEffectPrefs[key] ? "ON" : "OFF"}`);
}
loadRoomEffectPrefs();
let roomUiConfig = { ...DEFAULT_ROOM_UI_CONFIG };
function applyRoomUiConfig(config) {
  const c = config || DEFAULT_ROOM_UI_CONFIG;
  const rawSeat = Number(c.seatSize);
  const rawFrame = Number(c.frameScale);
  const seatSize = Math.max(0, Math.min(200, Number.isFinite(rawSeat) ? Math.round(rawSeat) : DEFAULT_ROOM_UI_CONFIG.seatSize));
  const frameScale = Math.max(0, Math.min(3, Number.isFinite(rawFrame) ? rawFrame : DEFAULT_ROOM_UI_CONFIG.frameScale));
  roomUiConfig = { seatSize, frameScale };
  document.documentElement.style.setProperty("--pp-seat-size", seatSize + "px");
  document.documentElement.style.setProperty("--pp-frame-scale", String(frameScale));
}
async function primeRoomUiConfig() {
  try { const r = await api("/api/room-ui/config"); if (r.success && r.config) applyRoomUiConfig(r.config); }
  catch (_) { applyRoomUiConfig(DEFAULT_ROOM_UI_CONFIG); }
}
applyRoomUiConfig(DEFAULT_ROOM_UI_CONFIG);

function applyRoomBackground(url) {
  const view = $("view-room");
  if (!view) return;
  const background = url || DEFAULT_ROOM_THEME_URL;
  // Use important inline declarations so room-theme CSS cannot override a saved image.
  const safeUrl = String(background).replace(/["\\\\\n\r]/g, "");
  view.style.setProperty("background-image", `url("${safeUrl}")`, "important");
  view.style.setProperty("background-size", "cover", "important");
  view.style.setProperty("background-position", "center center", "important");
  view.style.setProperty("background-repeat", "no-repeat", "important");
  view.classList.toggle("room-default-theme", !url);
}

function showPremiumRoomEntryEffect(svipLevel, mode) {
  if (!roomEffectPrefs.entryAnimation) return;
  const overlay = $("vip-entry-overlay");
  const mount = $("vip-entry-vap");
  const fallback = $("vip-entry-fallback");
  const title = $("vip-entry-title");
  const kicker = $("vip-entry-kicker");
  if (!overlay || !mount || !fallback) return;
  const level = Math.max(1, Math.min(6, Number(svipLevel) || 0));
  if (mode === "entry" && level < 5) return;
  if (vipEntryEffectTimer) { clearTimeout(vipEntryEffectTimer); vipEntryEffectTimer = null; }
  try { window.PingPongVap.stop(); } catch (_) {}
  overlay.classList.remove("hidden", "vip-entry-levelup");
  overlay.classList.toggle("vip-entry-levelup", mode === "levelup");
  overlay.classList.remove("vip-entry-show");
  void overlay.offsetWidth;
  overlay.classList.add("vip-entry-show");
  mount.innerHTML = "";
  fallback.classList.add("hidden");
  fallback.removeAttribute("src");
  kicker.textContent = mode === "levelup" ? "LEVEL UP" : "VIP ENTRY";
  title.textContent = "SVIP " + level;
  // Room entry uses the matching SVIP medal for every SVIP level.
  // LV5/LV6 upgrade notices remain available as the dedicated upgrade effect.
  const key = mode === "entry" ? ("svip" + level) : ("svip" + level);
  const cfg = window.PingPongVap?.effects?.[key];
  if (!cfg) { overlay.classList.add("hidden"); return; }
  if (!window.PingPongVap?.play) {
    fallback.src = cfg.poster;
    fallback.classList.remove("hidden");
    vipEntryEffectTimer = window.setTimeout(() => { overlay.classList.add("hidden"); }, 1500);
    return;
  }
  window.PingPongVap.play(key, {
    container: mount,
    fallbackPoster: (poster) => { fallback.src = poster; fallback.classList.remove("hidden"); },
    onDone: () => {
      overlay.classList.remove("vip-entry-show");
      vipEntryEffectTimer = window.setTimeout(() => { overlay.classList.add("hidden"); }, 260);
    }
  });
  vipEntryEffectTimer = window.setTimeout(() => {
    overlay.classList.remove("vip-entry-show");
    overlay.classList.add("hidden");
    try { window.PingPongVap.stop(); } catch (_) {}
  }, Math.max(3300, Number(cfg.duration || 3000) + 420));
}

function stopPremiumRoomEntryEffect() {
  const overlay = $("vip-entry-overlay");
  if (vipEntryEffectTimer) { clearTimeout(vipEntryEffectTimer); vipEntryEffectTimer = null; }
  try { window.PingPongVap?.stop(); } catch (_) {}
  if (overlay) { overlay.classList.remove("vip-entry-show", "vip-entry-levelup"); overlay.classList.add("hidden"); }
}

const VIDEO_GIFT_CATALOG_CACHE = { gifts: [] };
// Full-screen video gift playback queue — if several arrive at once, they
// play one after another instead of overlapping.
const videoGiftQueue = [];
let videoGiftPlaying = false;
// Vehicle Entry System (add-on) — same one-at-a-time full-screen queue
// pattern as Video Gifts above, kept completely separate so a burst of
// room joins never fights with a Video Gift for the overlay.
const vehicleEntryQueue = [];
let vehicleEntryPlaying = false;

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------
let me = null;
let socket = null;
let currentRoom = null;
let currentRoomId = null;
let roomEntryEffectPending = false;
let lastPremiumEntryRoomId = null;
let vipEntryEffectTimer = null;
// ROOT-CAUSE FIX (2026-08-14, reconnect / duplicate join-room / room-switch
// audit): three pieces of join-lifecycle state that did not exist before.
// - joinedRoomId: the room this socket has actually completed a join for
//   (server has ack'd via "room-state" for THIS join). currentRoomId, by
//   contrast, is set optimistically the instant the user taps a room and is
//   also used for other bookkeeping (saveActiveRoom, etc.) — it is not safe
//   to reuse as an idempotency key.
// - joinInProgress: true while a join-room request is in flight (covers
//   both the synchronous local-room ack and any brief round trip), so a
//   double-tap or a rapid-fire reconnect cannot emit a second "join-room"
//   on top of one that hasn't been acknowledged yet.
// - pendingJoinRequest: if the user taps ANOTHER room while a join is still
//   in flight, only the LAST tap is remembered and is dispatched once the
//   in-flight one resolves — earlier taps are dropped so rapid room-switch
//   tapping (A -> B -> A) never races and only the final destination wins.
let joinedRoomId = null;
let joinInProgress = false;
let pendingJoinRequest = null;
// Deterministic room lifecycle guards from the working V14 room-entry fix.
let roomLifecycleSeq = 0;
let roomJoinAckId = null;
let pendingLeaveRoomId = null;
let leaveInProgress = false;
let leaveSafetyTimer = null;
let mySeatNumber = null;
let seatMap = {};
let localStream = null;
let micEnabled = false;
let privateUnreadByUser = Object.create(null);
let privateUnreadTotal = 0;
let privateReturnToRoom = false;
// KEEP mode: the user remains a member of the current room (and keeps voice/seat state)
// while the full room UI is minimized to Home. EXIT is the only action that leaves.
let roomKept = false;

// Mic switch artwork: one button, two supplied states. The unmuted state
// always uses the supplied white microphone; the muted state always uses the
// supplied muted microphone. This is visual state only — transport logic and
// server-side voice permissions remain unchanged.
function updateMicButtonUi() {
  const btn = $("btn-mic-toggle");
  if (!btn) return;
  const icon = btn.querySelector("img");
  const enabled = !!micEnabled;
  btn.classList.toggle("active", enabled);
  btn.setAttribute("aria-label", enabled ? "Mute microphone" : "Unmute microphone");
  btn.title = enabled ? "Mute microphone" : "Unmute microphone";
  if (icon) {
    icon.src = enabled ? "/images/icons/icon-mic.png" : "/images/icons/icon-mic-muted-pdf.png";
    icon.alt = enabled ? "Microphone on" : "Microphone muted";
  }
}
updateMicButtonUi();

// Bug fix (Robin/Vapi voice conflict, 2026-08-12): Robin's own call
// (public/vapi-support.js, via Daily.co) needs the physical microphone for
// the duration of the support call. If the user is also seated with an
// active PingPong room-voice mic (mesh mode: localStream; SFU mode:
// window.PingPongVoiceSFU), two independent subsystems opening the same
// hardware mic at once can fail on some devices. This pauses (mutes, does
// NOT stop/unpublish) whichever subsystem currently owns the mic, and
// restores it after Robin's call ends — room voice connection/seat state
// is never touched, only the hardware track's enabled flag.
function pingpongPauseRoomMicForRobin() {
  try {
    if (window.PingPongVoiceSFU?.isConnected?.()) {
      window.PingPongVoiceSFU.pauseMicForRobin?.();
    }
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
    }
  } catch (_) { /* best-effort only, never block Robin's own call */ }
}
function pingpongResumeRoomMicAfterRobin() {
  try {
    if (window.PingPongVoiceSFU?.isConnected?.()) {
      window.PingPongVoiceSFU.resumeMicAfterRobin?.();
    }
    // Only restore the mesh mic if the user is still actually seated with
    // mic enabled — don't turn a mic back on the user had already muted.
    if (localStream && micEnabled) {
      localStream.getAudioTracks().forEach((t) => { t.enabled = true; });
    }
  } catch (_) { /* best-effort only */ }
}
window.PingPongRoomVoice = {
  pauseMicForRobin: pingpongPauseRoomMicForRobin,
  resumeMicAfterRobin: pingpongResumeRoomMicAfterRobin
};
const peerConnections = {};
// Official AI Customer Service Room 101 state. Kept isolated from normal
// room voice state so the existing room WebRTC topology is untouched.
let cs101History = [];
let cs101Recognition = null;
let cs101Listening = false;
// Phase 1 / Tier A: userIds the server says are inside their reconnect
// grace period (see voice-peer-reconnecting/voice-peer-resumed above) —
// consulted by getOrCreatePeer()'s ICE-failure handling so a brief drop
// doesn't get torn down and rebuilt from scratch mid-recovery.
const reconnectingPeerUserIds = new Set();
const remoteAudioEls = {};
let roomSpeakerOn = true;
function applyRoomSpeakerState() {
  Object.values(remoteAudioEls).forEach((audio) => {
    try { audio.muted = !roomSpeakerOn; audio.volume = roomSpeakerOn ? 1 : 0; } catch (_) {}
  });
  // Room 101 AI voice uses browser speech synthesis rather than a media element.
  if (!roomSpeakerOn && typeof window.speechSynthesis !== "undefined") {
    try { window.speechSynthesis.cancel(); } catch (_) {}
  }
  const btn = $("btn-room-speaker");
  const icon = btn?.querySelector("img");
  if (btn) {
    btn.classList.toggle("active", roomSpeakerOn);
    btn.setAttribute("aria-label", roomSpeakerOn ? "Voice On" : "Voice Off");
    btn.title = roomSpeakerOn ? "Voice On" : "Voice Off";
  }
  if (icon) icon.alt = roomSpeakerOn ? "Voice On" : "Voice Off";
}
const speakingUsers = new Set(); // userIds currently detected as speaking (real-time)
const musicUsers = new Set(); // userIds currently driving room music activity
// Live voice intensity (0..1) for premium speaking visuals. Kept separate from
// speakingUsers so the seat/avatar DOM is never rebuilt per audio sample.
const voiceLevels = new Map();
let lastVoiceLevelEmitAt = 0;
// Shared read-only bridge for transport modules (Agora) to report speaking state
// without duplicating auth/session/room state.
window.PingPongVoiceContext = { get me() { return me; }, get roomId() { return currentRoomId; }, get socket() { return socket; }, get micEnabled() { return micEnabled; } };

// Phase 3 / Step 3.3: which voice transport this client should use for the
// CURRENT room. "mesh" is the safe default (matches the server's own
// currentVoiceMode() fail-safe in voice_sfu/provider.js) until
// refreshVoiceMode() actually resolves, and stays "mesh" forever on any
// deployment that never sets VOICE_MODE=sfu server-side — the mesh code
// below (peerConnections, connectToPeer(), getOrCreatePeer(), etc.) is
// completely unmodified and remains the only thing that ever runs in that
// case. sfuConnected only tracks THIS client's own LiveKit Room lifecycle
// (see public/voice-sfu.js); it is not room/seat authority.
let voiceMode = "mesh"; // mesh | sfu | agora
let sfuConnected = false;

// Fruit Wheel: server-authoritative round/result/winner packets, kept at
// module scope (not just inside connectSocket()) so a later re-open of the
// game TV panel (openRoomGame(), outside connectSocket()) can still replay
// the latest packet instead of throwing a ReferenceError.
let fruitWheelLiveState = null;
let fruitWheelLiveWinners = null;
let fruitWheelLiveMyResult = null;

let followListMode = "followers";
let threadPeerId = null;
let threadPeerName = null;
let threadPeerPhoto = "";

// ---------------------------------------------------------------------------
// First Time Profile Setup — country/language catalogue cache (fetched once
// from GET /api/meta/countries, the same list the server validates against)
// ---------------------------------------------------------------------------
let COUNTRIES_CACHE = [];
async function loadCountriesCache() {
  if (COUNTRIES_CACHE.length) return COUNTRIES_CACHE;
  const r = await api("/api/meta/countries", "GET");
  if (r.success) COUNTRIES_CACHE = r.countries;
  return COUNTRIES_CACHE;
}
// Regional-indicator flag emoji from an ISO country code — same computation
// as countries.js server-side, kept in sync manually since it's one line.
function flagEmoji(code) {
  if (!code || code.length !== 2) return "";
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// ---------------------------------------------------------------------------
// YouTube Room Player — state
// ---------------------------------------------------------------------------
let ytPlayer = null;             // YT.Player instance, created lazily on first use
let ytApiReady = false;          // set true by window.onYouTubeIframeAPIReady
let ytPlayerRetryTimer = null;
let ytPlayerRequestSeq = 0;
let ytLoadedVideoId = null;
let ytPlayerRetryCount = 0;
let ytPlayerLastRequest = null;
let ytPendingLoad = null;        // { videoId, position, isPlaying } queued if player not ready yet
let ytCurrentPlaylist = [];
let ytPlayerState = { mode: false, currentIndex: -1, isPlaying: false, position: 0, updatedAt: Date.now() };
let canControlYt = false;        // owner/admin of the current room
let ytDriftTimer = null;         // owner-side periodic position broadcast while playing
let ytSuppressEvents = false;    // true while we're programmatically seeking/loading, so onStateChange doesn't re-broadcast our own remote update
let ytLastEndedVideoId = null;

// ---------------------------------------------------------------------------
// Fix (pinch/double-tap zoom bug): some mobile browsers/WebViews still let
// people zoom the page even with user-scalable=no and touch-action set —
// which breaks every fixed-position overlay (room TV screen, modals, the
// bottom toolbar). This is a hard JS-level safety net on top of those:
// block any multi-finger touch move, any native pinch gesture, and any
// double-tap that's fast enough to be a zoom tap rather than two real taps.
document.addEventListener("touchmove", (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener("gesturestart", (e) => e.preventDefault());
let __lastTouchEndTs = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - __lastTouchEndTs <= 300) e.preventDefault();
  __lastTouchEndTs = now;
}, { passive: false });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function $(id) { return document.getElementById(id); }

// ---------------- Panel exclusivity (UI-only, no feature/backend change) ----------------
// Every full-screen panel (Gift / Music / YouTube playlist / Chest info /
// Room Game) is mutually exclusive: opening one always closes any other
// that happens to be open first, so the room never shows two overlays
// stacked on top of each other. This only toggles the existing "hidden"
// class / calls the existing close functions for each panel — it does not
// change what any panel does once open.
const EXCLUSIVE_PANEL_IDS = ["modal-gift", "modal-music", "modal-yt-playlist", "modal-chest-info", "modal-chest-live", "modal-chest-reward", "modal-room-ranking", "modal-level-info", "room-more-menu", "gift-calculator-modal"];
function closeAllPanels(exceptId) {
  EXCLUSIVE_PANEL_IDS.forEach((id) => {
    if (id === exceptId) return;
    const el = $(id);
    if (el && !el.classList.contains("hidden")) el.classList.add("hidden");
  });
  if (exceptId !== "room-tv-screen") {
    const tv = $("room-tv-screen");
    if (tv && tv.classList.contains("tv-open")) closeRoomGame();
  }
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

function showView(id) {
  if (id !== "view-room" && typeof closeRoomPrivateMessages === "function") closeRoomPrivateMessages();
  if (id !== "view-room" && typeof closeCpShowcase === "function") closeCpShowcase();
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $(id).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(`.nav-btn[data-nav="${navKeyFor(id)}"]`).forEach((b) => b.classList.add("active"));
  // 3D Animated Room Header: play the one-shot "drop-in" entrance every
  // time the room view becomes active (fresh join, rejoin, or coming back
  // from a sub-screen). Re-triggering an already-applied CSS animation
  // needs a reflow in between remove/add, otherwise the browser just
  // no-ops the second time.
  if (id === "view-room") {
    const topbar = document.querySelector(".room-topbar");
    if (topbar) {
      topbar.classList.remove("header-enter-3d");
      void topbar.offsetWidth;
      topbar.classList.add("header-enter-3d");
    }
    try { updatePrivateUnreadUi(); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Rocket Crash bridge. The game page runs in a same-origin iframe, but its
// wallet actions must travel over THIS already-authenticated socket (the one
// that sent "identify" with the session token). A second socket created
// inside the iframe is never identified, so the server rejects it — that was
// why the game could not be played from inside a room.
// ---------------------------------------------------------------------------
const ROCKET_EVENTS_IN = ["rocket:state", "rocket:round", "rocket:tick", "rocket:action", "rocket:result", "rocket:balance", "rocket:player-cashout", "rocket:bettors", "rocket:unavailable"];
const ROCKET_EVENTS_OUT = new Set(["rocket:join", "rocket:bet", "rocket:cashout", "rocket:balance", "rocket:leave"]);
function rocketFrameWindow() {
  const f = document.getElementById("rocket-crash-frame");
  return f && f.contentWindow ? f.contentWindow : null;
}
function rocketPost(event, payload) {
  const w = rocketFrameWindow();
  if (w) { try { w.postMessage({ type: "pp-rocket-event", event, payload }, window.location.origin); } catch (_) {} }
}
function attachRocketBridge(sock) {
  ROCKET_EVENTS_IN.forEach((ev) => sock.on(ev, (payload) => rocketPost(ev, payload)));
  // After (re)connect the server needs a moment to verify "identify" before
  // wallet events are accepted, so tell the game to re-join slightly later.
  sock.on("connect", () => setTimeout(() => rocketPost("pp:connected", {}), 1200));
  sock.on("disconnect", () => rocketPost("pp:disconnected", {}));
}
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const d = event.data;
  if (!d || d.type !== "pp-rocket-emit" || !ROCKET_EVENTS_OUT.has(d.event)) return;
  if (socket && socket.connected) socket.emit(d.event, d.payload);
  else rocketPost("rocket:action", { ok: false, code: "OFFLINE", message: "Reconnecting to server… try again in a moment." });
});

// Wallet iframe back bridge: wallet-ui.html runs in the same origin but inside
// an iframe, so its back button asks the parent app to return to Home.
window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data && event.data.type === "PINGPONG_CLOSE_WALLET") {
    showView("view-home");
  }
});
function navKeyFor(viewId) {
  return { "view-home": "home", "view-inbox": "inbox", "view-profile": "profile" }[viewId] || "";
}

// Phase 14 (client): session token issued at login, resolved server-side to
// the real logged-in mobile. Attached automatically to every api()/
// apiUpload() call below so identity-sensitive endpoints (migrated one
// group at a time — see server.js Phase 14/15 comments) can trust it
// instead of a client-supplied mobile/userId. Old server builds that don't
// look for this header simply ignore it — fully backward compatible.
let authToken = null;
let productionRefreshToken = null;
// AUDIT FIX (2026-09-25, "Expired" session bug — root cause): the production
// access token is short-lived (ACCESS_TOKEN_TTL_MS, 15 min by default —
// security/refreshTokens.js). The refresh token that renews it is SINGLE-USE:
// the server rotates AND revokes the old one on every successful refresh
// (see refreshTokens.rotate()). Two things about the OLD client code
// combined to make that dangerous:
//   1. Refresh only ever happened reactively, after some request had
//      already failed with 401 — never proactively ahead of expiry.
//   2. enterApp() and page-load validation fire several authenticated
//      calls in parallel. If the access token had already expired, EACH of
//      those calls independently called tryRefreshProductionSession() with
//      the SAME refresh token. Only the first to reach the server could
//      ever succeed; every other concurrent caller's refresh attempt was
//      rejected (its refresh token was already revoked by the winner), and
//      those callers had only a single 500ms wait-and-retry to recover —
//      easy to lose on a slow connection, at which point the user was
//      force-logged-out with a perfectly valid session.
// Fixed below with: (a) a shared in-flight refresh promise so concurrent
// 401s coalesce into ONE /api/auth/refresh call instead of racing the
// single-use refresh token, and (b) a proactive refresh timer scheduled
// ahead of the access token's real expiry, so most requests never see a
// 401 in the first place.
let accessTokenExpiresAt = null; // epoch ms, from the server's accessExpiresAt
let refreshTimer = null;
let refreshInFlight = null;

function applySessionTokens(session) {
  if (!session) return;
  if (session.accessToken) authToken = session.accessToken;
  if (session.refreshToken) productionRefreshToken = session.refreshToken;
  accessTokenExpiresAt = session.accessExpiresAt ? new Date(session.accessExpiresAt).getTime() : null;
  saveSession();
  scheduleProactiveRefresh();
}

function scheduleProactiveRefresh() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  if (!accessTokenExpiresAt || !productionRefreshToken) return;
  const LEAD_MS = 60 * 1000; // refresh a minute before the access token actually dies
  const delay = Math.max(2000, accessTokenExpiresAt - Date.now() - LEAD_MS);
  refreshTimer = setTimeout(() => { tryRefreshProductionSession(); }, delay);
}

async function tryRefreshProductionSession() {
  if (!productionRefreshToken) return false;
  // Coalesce concurrent callers onto the one HTTP call in flight — this is
  // the fix for the refresh-token race described above.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(API + "/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: productionRefreshToken, deviceId: localStorage.getItem("pp_device_id") || null }) });
      const data = await res.json().catch(() => null);
      if (!data || !data.success || !data.accessToken) return false;
      applySessionTokens(data);
      return true;
    } catch (_) {
      // Network failure, not a server-confirmed dead token — the refresh
      // token itself is still fine. Never clear it here; just report
      // failure so the caller backs off and tries again.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function api(path, method = "GET", body = null, headers = {}, _attempt = 0) {
  try {
    const authHeaders = authToken ? { "Authorization": "Bearer " + authToken } : {};
    const res = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders, ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    // Keep HTTP status available to bootstrap so transient server errors can
    // never be mistaken for a deleted account during refresh.
    if (data && typeof data === "object") data.httpStatus = res.status;
    // Server-side token expiry/invalidations respond 401 + forceLogout so a
    // stale client doesn't keep silently failing every subsequent action.
    //
    // FIX (2026-09-25, "Expired" bug): up to MAX_ATTEMPTS refresh-and-retry
    // cycles, sharing the same coalesced tryRefreshProductionSession() call
    // across every concurrent 401'd request (see above). A refresh that
    // fails is retried with a short backoff BEFORE assuming the session is
    // really dead — this is what protects someone on a flaky mobile
    // connection from being logged out over one dropped packet, per the
    // "recover automatically from temporary network failure" requirement.
    // Only after all attempts are exhausted (or there's no refresh token to
    // retry with at all) do we honor Logout Lock and finally clear the
    // session. This is always a stale/expired-token case, never a real ban
    // — bans are pushed live via the separate "kicked" socket event and are
    // correctly unaffected by Logout Lock.
    if (res.status === 401 && data && data.forceLogout) {
      const MAX_ATTEMPTS = 3;
      if (_attempt < MAX_ATTEMPTS) {
        if (await tryRefreshProductionSession()) {
          return api(path, method, body, headers, _attempt + 1);
        }
        if (productionRefreshToken) {
          await new Promise((r) => setTimeout(r, 400 * (_attempt + 1)));
          return api(path, method, body, headers, _attempt + 1);
        }
      }
      if (isLogoutLockOn()) {
        console.log("[SESSION] 401 forceLogout ignored — Logout Lock is ON:", path);
        return data;
      }
      // BUG FIX (refresh-logout / settings-not-opening root cause, 2026-07-29):
      // clearSession() used to run here with no navigation change at all.
      // That leaves `me` as null while the user visually stays on whatever
      // screen they were on (Home, a room, etc.) — every other handler in
      // this file that reads me.xxx (e.g. the Room Settings gear at
      // btn-room-mod, which reads me.userId) then throws silently and does
      // nothing when tapped, which is exactly what "touching Settings shows
      // no features" looks like from the outside. And because localStorage
      // was already wiped, the NEXT refresh finds no cached session and
      // bootstrap() shows the login screen — which is what "refresh keeps
      // sending me back to login" actually was: the session was silently
      // killed by an earlier background call, not by the refresh itself.
      // Now this mirrors the "kicked" socket handler above: clearing the
      // session always immediately shows the login view too, so the app
      // state and the screen never disagree with each other.
      showDebugBadge("SESSION CLEARED BY A BACKGROUND CALL (401 forceLogout) at path=" + path + " after " + _attempt + " refresh attempt(s). THIS IS A DIFFERENT CODE PATH FROM BOOTSTRAP — it means an already-logged-in session was killed by some OTHER api() call (not the initial page-load check). message=" + (data.message || "(none)"));
      clearSession("auth-token-invalid");
      if (socket) { try { socket.disconnect(); } catch (e) {} socket = null; }
      showView("view-login");
      toast(data.message || "Session expired — please log in again");
    }
    return data;
  } catch (err) {
    toast("Network problem occurred");
    return { success: false, message: "network error", networkError: true };
  }
}

async function apiUpload(path, formData, headers = {}, _attempt = 0) {
  try {
    const authHeaders = authToken ? { "Authorization": "Bearer " + authToken } : {};
    const res = await fetch(API + path, { method: "POST", body: formData, headers: { ...authHeaders, ...headers } });
    if (res.status === 401 && _attempt < 3) {
      if (await tryRefreshProductionSession()) return apiUpload(path, formData, headers, _attempt + 1);
      if (productionRefreshToken) {
        await new Promise((r) => setTimeout(r, 400 * (_attempt + 1)));
        return apiUpload(path, formData, headers, _attempt + 1);
      }
    }
    return await res.json();
  } catch (err) {
    toast("Upload problem occurred");
    return { success: false, message: "network error", networkError: true };
  }
}

function vipClass(level) { return "vip-" + Math.max(0, Math.min(5, Number(level) || 0)); }
function applyVipBadge(el, level) {
  el.className = "vip-badge " + vipClass(level);
  el.textContent = "VIP " + (Number(level) || 0);
}
// Custom ID Number (Admin-assigned, "Golden Light" style) — shown instead of
// the permanent userId wherever a user's ID is displayed. The real userId
// keeps working everywhere else internally (copy-ID, follow, gifts, etc.);
// this only swaps what's rendered in the ID text itself.
// Country flag shown right next to the ID — computed from the user's own
// selected country (First Time Profile Setup), so it's the actual flag of
// wherever that account is from rather than any one hardcoded flag.
function applyIdDisplay(el, user) {
  if (!el) return;
  const idText = user && user.customId ? user.customId : (user ? user.userId : "");
  el.textContent = idText;
  // IDs are always premium gold; a custom/admin ID simply changes the value.
  el.classList.add("custom-id-golden");
}
function applyCountryFlag(el, user) {
  if (!el) return;
  const flag = user && user.country ? flagEmoji(user.country) : "";
  el.textContent = flag || "🌐";
  el.title = user?.country || "Country";
  el.classList.remove("hidden");
}
// Admin-uploaded SVIP PNG tag, shown right next to the VIP badge — exactly
// like the VIP logo, in the same spot, using whatever PNG Admin uploaded
// for the user's current SVIP level (no separate demo image).
function applySvipTag(el, resources) {
  if (!el) return;
  const url = resources && resources.tag;
  if (url) {
    const v = resources.tagVersion ? ("?v=" + resources.tagVersion) : "";
    el.src = url + v;
    el.classList.remove("hidden");
  } else {
    el.removeAttribute("src");
    el.classList.add("hidden");
  }
}
async function refreshSvipTagFor(userId, el) {
  if (!userId || !el) return;
  const r = await api("/api/svip/status/" + userId);
  if (r.success) applySvipTag(el, r.resources);
}
// "Me" specifically also updates `me.svipLevel` + is what the real-time
// svip_level_changed/svip_resource_update socket handlers call to refresh
// both places my own tag shows (home chip + profile) at once.
async function refreshMySvipTag() {
  if (!me) return;
  const r = await api("/api/svip/status/" + me.userId);
  if (r.success) {
    me.svipLevel = r.svipLevel;
    applySvipTag($("home-svip-tag"), r.resources);
    applySvipTag($("profile-svip-tag"), r.resources);
    const sv = $("menu-svip-progress");
    if (sv) {
      const next = r.nextTarget || Number(r.thresholds?.SVIP1 || 1500000);
      sv.innerHTML = next ? `${Number(r.rechargeTotal || 0).toLocaleString()} / ${Number(next).toLocaleString()} <img src="/images/icons/icon-diamond-premium.png" class="svip-inline-diamond" alt="">` : `SVIP${r.svipLevel}`;
    }
  }
}
// "Seller" pill — shown ONLY on profile screens (own profile / other
// profile / room seat-touch sheet), exactly like the SVIP tag above.
// Deliberately NOT part of seatMap/seat data anywhere, so it never
// renders on the seat itself — only after someone taps into the profile.
// Driven live off the Diamond Seller registry (diamondSeller.js): the
// tag appears/disappears automatically the moment Admin approves/
// suspends/restores that userId as a seller — no separate toggle needed.
function applySellerTag(el, isSeller) {
  if (!el) return;
  el.classList.toggle("hidden", !isSeller);
}
async function refreshSellerTagFor(userId, el) {
  if (!userId || !el) return;
  const r = await api("/api/diamond-seller/status/" + userId);
  if (r.success) applySellerTag(el, r.isSeller);
}
// Admin-assigned coloured tag (e.g. "VIP") shown next to a username.
// `small` renders the compact inline variant used in chat/seats instead of
// the full pill used on profile screens.
function tagTextColor(hex) {
  const h = (hex || "").replace("#", "");
  if (h.length !== 6) return "#1c1424";
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1c1424" : "#fbf6ea";
}
function applyCustomTag(el, tag, small) {
  if (!el) return;
  el.className = "tag-badge" + (small ? " tag-badge-sm" : "");
  if (tag && tag.text) {
    el.textContent = tag.text;
    el.style.background = tag.color || "#F7CE7E";
    el.style.color = tagTextColor(tag.color);
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

function renderAgencyBadge(el, badge, small=false) {
  if (!el) return;
  el.className = "agency-badge-image" + (small ? " agency-badge-image-sm" : "");
  el.innerHTML = "";
  if (!badge) { el.classList.add("hidden"); return; }
  const img = document.createElement("img");
  img.src = badge.imageUrl || "/images/badges/active-agency.png";
  img.alt = badge.text || "Active Agency";
  img.draggable = false;
  el.appendChild(img);
  el.classList.remove("hidden");
}
// "Seller" / "Official" profile tags (admin-send/remove, 2026-08-22 request)
// — driven entirely off the same activeBadges array/real-time events as
// the Blue Diamond V badge above (badges.js), just rendered as a small
// inline image next to the VIP badge instead of an avatar overlay. Shown
// on profile screens only (own profile / other profile / seat-tap sheet),
// exactly like the SVIP tag right next to it — same class, same 18px
// height, so it always sits at the same size as the VIP badge no matter
// what size the source image is.
function applyExtraBadgeTag(el, activeBadges, badgeId) {
  if (!el) return;
  const has = Array.isArray(activeBadges) && activeBadges.includes(badgeId);
  if (has) {
    const cfg = badgeCatalogCache[badgeId];
    el.src = (cfg && cfg.imageUrl) || "";
    el.classList.remove("hidden");
  } else {
    el.removeAttribute("src");
    el.classList.add("hidden");
  }
}
function applySellerOfficialTags(sellerEl, officialEl, activeBadges, agencyEl) {
  applyExtraBadgeTag(agencyEl, activeBadges, "agency_tag");
  applyExtraBadgeTag(sellerEl, activeBadges, "seller_tag");
  applyExtraBadgeTag(officialEl, activeBadges, "official_tag");
}
function applyMerchantTag(el, activeBadges) {
  if (!el) return;
  const has = Array.isArray(activeBadges) && activeBadges.includes("merchant_tag");
  if (has) {
    // Final Merchant artwork is intentionally independent of the old badge
    // catalog image so replacing the visual cannot break badge permissions.
    el.src = "/images/badges/merchant_tag.png";
    el.classList.remove("hidden");
  } else {
    el.removeAttribute("src");
    el.classList.add("hidden");
  }
}
function applyFrameRing(wrapEl, level) {
  wrapEl.className = wrapEl.className.replace(/\bvip-\d\b/g, "").trim();
  wrapEl.classList.add(vipClass(level));
}
// Admin-issued custom PNG/GIF frame overlay — decorates the avatar without
// ever resizing it. GIFs retain native animation; static PNGs get a subtle
// independent glow/breathe animation from CSS. The frame is always a
// transparent overlay and never becomes the avatar background.
function applyCustomFrame(wrapEl, activeFrame) {
  if (!wrapEl) return;
  const existing = wrapEl.querySelector(".custom-frame-img");
  const isSvipAutoFrame = !!(activeFrame && activeFrame.imageUrl && activeFrame.svip);
  wrapEl.classList.toggle("svip-auto-frame", isSvipAutoFrame);
  if (activeFrame && activeFrame.imageUrl) {
    wrapEl.classList.add("has-custom-frame");
    if (existing) existing.src = activeFrame.imageUrl;
    else {
      const img = document.createElement("img");
      img.className = "custom-frame-img";
      img.src = activeFrame.imageUrl;
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      wrapEl.appendChild(img);
    }
    if (existing) { existing.draggable = false; existing.decoding = "async"; }
  } else {
    wrapEl.classList.remove("has-custom-frame", "svip-auto-frame");
    if (existing) existing.remove();
  }
}

// Premium badge catalog cache (id -> {imageUrl, seatSize, profileSize}) —
// SIZE ADJUSTMENT (2026-08-05): sizes are now admin-configurable from the
// panel (badges.js /api/badges/size), so the client fetches current px
// values instead of using the fixed CSS defaults. Those CSS defaults
// (.seat-blue-badge 16px, .profile-blue-badge 72px) stay as a safe
// fallback if this fetch hasn't completed yet or fails.
let badgeCatalogCache = {};
async function primeBadgeCatalog() {
  try {
    const r = await api("/api/badges/catalog");
    if (r.success && Array.isArray(r.catalog)) {
      badgeCatalogCache = {};
      r.catalog.forEach((b) => { badgeCatalogCache[b.id] = b; });
    }
  } catch (e) { /* keep whatever was cached, CSS defaults still apply */ }
}
primeBadgeCatalog();

// Premium badge display (Blue Diamond V etc., admin-granted only — see
// badges.js). Only shows an element that's already sitting hidden in the
// markup (public/index.html) — no DOM created here, just toggled.
function applyBlueBadge(el, activeBadges) {
  if (!el) return;
  const has = Array.isArray(activeBadges) && activeBadges.includes("blue_diamond_v");
  el.classList.toggle("hidden", !has);
  if (has) {
    const cfg = badgeCatalogCache.blue_diamond_v;
    if (cfg && cfg.profileSize) { el.style.width = cfg.profileSize + "px"; el.style.height = cfg.profileSize + "px"; }
  }
}

function saveSession() {
  console.log("[SESSION] saveSession ->", me ? { mobile: me.mobile, userId: me.userId } : null);
  localStorage.setItem("pp_user", JSON.stringify(me));
  if (authToken) localStorage.setItem("pp_auth_token", authToken);
  if (productionRefreshToken) localStorage.setItem("pp_refresh_token", productionRefreshToken);
  // AUDIT FIX (2026-09-25, "Expired" session bug, part 2 — persist expiry
  // across reload): accessTokenExpiresAt used to live only in memory, so
  // scheduleProactiveRefresh() went silent on every page reload/WebView
  // restart until the first reactive 401 re-armed it via
  // tryRefreshProductionSession() -> applySessionTokens(). Persisting it
  // here (and restoring + rescheduling in loadSession() below) means the
  // proactive timer survives a reload too, so most requests never hit a
  // 401 in the first place, on the very first request after reload included.
  if (accessTokenExpiresAt) localStorage.setItem("pp_access_expires_at", String(accessTokenExpiresAt));
  else localStorage.removeItem("pp_access_expires_at");
}
function loadSession() {
  const raw = localStorage.getItem("pp_user");
  console.log("[SESSION] loadSession raw pp_user present:", !!raw);
  if (raw) { try { me = JSON.parse(raw); } catch (e) { console.log("[SESSION] loadSession JSON.parse failed:", e); me = null; } }
  authToken = localStorage.getItem("pp_auth_token") || null;
  productionRefreshToken = localStorage.getItem("pp_refresh_token") || null;
  const savedExpiry = localStorage.getItem("pp_access_expires_at");
  accessTokenExpiresAt = savedExpiry ? Number(savedExpiry) : null;
  // Re-arm the proactive refresh timer immediately on load instead of
  // waiting for a reactive 401 — see saveSession() note above.
  scheduleProactiveRefresh();
}
function clearSession(reason) {
  console.log("[SESSION] clearSession called, reason:", reason);
  // Best-effort server-side revoke so a copied/leaked token stops working
  // immediately rather than just sitting idle until its own expiry. Fire
  // and forget — logout must not be blocked by a slow/failed network call.
  // AUDIT FIX (2026-09-27, logout leaves refresh token alive): this call
  // used to send only the Authorization header. The server's
  // /api/auth/logout handler also accepts refreshToken in the body and, if
  // present, revokes it via refreshTokens.revokeRefresh() — but the client
  // never sent it, so an explicit "Log out" left the still-valid (up to
  // REFRESH_TTL_MS, 30 days by default) production refresh token sitting
  // unrevoked in the database. Anyone who had captured it earlier (e.g. via
  // a synced localStorage backup) could keep minting fresh access tokens
  // long after the user believed they'd logged out. Sending it here closes
  // that gap; a copied/leaked access token now also stops working
  // immediately, and its refresh token can no longer renew it either.
  if (authToken || productionRefreshToken) {
    fetch(API + "/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": authToken ? "Bearer " + authToken : "" },
      body: JSON.stringify({ refreshToken: productionRefreshToken || null })
    }).catch(() => {});
  }
  localStorage.removeItem("pp_user");
  localStorage.removeItem("pp_auth_token");
  localStorage.removeItem("pp_refresh_token");
  localStorage.removeItem("pp_access_expires_at");
  productionRefreshToken = null;
  accessTokenExpiresAt = null;
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  saveActiveRoom(null);
  me = null;
  authToken = null;
  // FIX (requirement #4 — if refresh fails, sign out of Firebase and clear
  // ALL cached auth data): the app's own pp_* keys are cleared above; this
  // additionally signs out of Firebase itself and sweeps its own
  // "firebase:"-prefixed localStorage/sessionStorage keys, so a dead
  // Firebase session can never linger and cause the next login attempt to
  // fail again for the same reason. Guarded because clearSession() can run
  // before firebaseClient.js has finished loading (e.g. a very early boot
  // error) — this must never be why a logout fails.
  if (window.ppFirebaseAuth && window.ppFirebaseAuth.fullFirebaseSignOut) {
    window.ppFirebaseAuth.fullFirebaseSignOut().catch((err) => console.error("[SESSION] fullFirebaseSignOut failed:", err));
  }
}

// Feature: Logout Lock (Profile screen toggle). When ON, the app will not
// clear a saved login on its own for any reason short of the user tapping
// Logout themselves — specifically the "account temporarily unreachable"
// case in bootstrap() below. It deliberately does NOT protect against a
// real ban/account-deletion pushed by an admin (see socket.on("kicked",…)):
// that's a moderation action, not an accidental logout, and letting a
// client-side toggle block it would let anyone dodge a ban just by turning
// this on first.
function isLogoutLockOn() { return localStorage.getItem("pp_logout_lock") === "1"; }
function setLogoutLock(on) { localStorage.setItem("pp_logout_lock", on ? "1" : "0"); }
const logoutLockToggleEl = document.getElementById("toggle-logout-lock");
if (logoutLockToggleEl) {
  logoutLockToggleEl.addEventListener("change", (e) => {
    setLogoutLock(e.target.checked);
    toast(e.target.checked ? "Logout Lock enabled 🔒" : "Logout Lock disabled");
  });
}

// ---------------------------------------------------------------------------
// God Power System (Super Admin panel feature) — client side.
// Shows the 5s grant/revoke popup, and (only for is_invisible holders)
// the Invisible toggle on the Profile screen.
// ---------------------------------------------------------------------------
function showGodPowerPopup(text, kind) {
  const el = document.createElement("div");
  el.className = "godpower-popup" + (kind === "revoke" ? " revoke" : "");
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 5000);
}
function refreshGodPowerInvisibleRow() {
  const row = $("row-godpower-invisible");
  const toggle = $("toggle-godpower-invisible");
  if (!row || !toggle) return;
  const eligible = !!(me && me.is_invisible);
  row.classList.toggle("hidden", !eligible);
  if (eligible) toggle.checked = !!me.invisibleActive;
}
const godPowerInvisibleToggleEl = document.getElementById("toggle-godpower-invisible");
if (godPowerInvisibleToggleEl) {
  godPowerInvisibleToggleEl.addEventListener("change", () => {
    socket.emit("toggle-invisible");
  });
}

// Fix (session/room loss on refresh): currentRoomId previously lived only
// in a JS variable, so refreshing the page while inside a voice room reset
// it to null — the user landed back on the home screen even though their
// login session was completely fine, which read as "got logged out". We
// now persist which room the user was in and rejoin it automatically once
// the socket reconnects (see connectSocket()'s "connect" handler below).
function saveActiveRoom(roomId) {
  if (roomId) {
    localStorage.setItem("pp_room", roomId);
    // Timestamp lets bootstrap() below tell "this is a refresh/reconnect
    // gap, rejoin seamlessly" apart from "the app was closed and reopened
    // much later, don't silently drop them into a stale room" — see
    // loadActiveRoomIfFresh().
    localStorage.setItem("pp_room_ts", String(Date.now()));
  } else {
    localStorage.removeItem("pp_room");
    localStorage.removeItem("pp_room_ts");
  }
}
function loadActiveRoom() { return localStorage.getItem("pp_room"); }

// FIX (room lost on browser refresh, 2026-07-29): the "Auto-Join Room bug"
// fix elsewhere in this file made bootstrap() stop calling loadActiveRoom()
// at all, to stop the app from silently dropping a user into whatever room
// they happened to be in the LAST time they used the app, even hours/days
// later with no tap. That fixed the unwanted case, but as a side effect it
// also killed the wanted case: a person mid-conversation in a room hits
// browser refresh (or the app reloads after a crash/deploy) and lands on
// Home instead of seamlessly back in their room/seat — even though the
// server-side 8s grace period (server.js pendingDisconnects) was designed
// to hold their seat open for exactly this. The room was never actually
// "lost" server-side; the client just stopped asking to go back.
//
// Fix: bring loadActiveRoom() back into bootstrap(), but gate it on
// freshness via the pp_room_ts timestamp (kept rolling by a heartbeat —
// see the setInterval near connectSocket()). A refresh happens seconds
// after the timestamp was last written, so it passes; an app reopened
// after being closed for a long time does not, and falls back to Home
// exactly like before.
const ROOM_REJOIN_FRESHNESS_MS = 20000; // comfortably covers the 8s server grace period + slow-network bootstrap time
function loadActiveRoomIfFresh() {
  const roomId = localStorage.getItem("pp_room");
  if (!roomId) return null;
  const ts = Number(localStorage.getItem("pp_room_ts") || 0);
  if (!ts || Date.now() - ts > ROOM_REJOIN_FRESHNESS_MS) {
    saveActiveRoom(null); // stale marker — don't let it resurface on some later boot either
    return null;
  }
  return roomId;
}

// ===========================================================================
// AUTH — Google Sign-In
// ===========================================================================
// Password login UI has been removed (server-side password endpoints are
// untouched). Mobile Number + OTP card below now talks directly to this
// server's own /api/auth/send-otp and /api/auth/verify-otp (see
// security/otpService.js + sms/gateway.js) — no Firebase, no third-party
// SMS provider is involved in the OTP flow. "Continue with Google" is
// unchanged and still goes through Firebase (see firebaseClient.js).
async function finishFirebaseLogin(idToken, isRetry) {
  const r = await api("/api/auth/firebase-login", "POST", { idToken });
  if (r.success) {
    me = r.user;
    authToken = r.productionSession?.accessToken || r.authToken || authToken;
    productionRefreshToken = r.productionSession?.refreshToken || productionRefreshToken;
    // AUDIT FIX (2026-09-25, "Expired" session bug, part 2): arm the
    // proactive-refresh timer at login too, not only after the first
    // reactive 401 — see saveSession()/loadSession() notes above.
    accessTokenExpiresAt = r.productionSession?.accessExpiresAt ? new Date(r.productionSession.accessExpiresAt).getTime() : null;
    saveSession();
    scheduleProactiveRefresh();
    connectSocket();
    enterApp();
    return;
  }
  if (!isRetry && r.code === "token-expired" && window.ppFirebaseAuth && window.ppFirebaseAuth.getFreshIdTokenIfPossible) {
    console.log("[FIREBASE-AUTH] server reported an expired token — attempting one silent refresh before showing anything to the user");
    const freshToken = await window.ppFirebaseAuth.getFreshIdTokenIfPossible();
    if (freshToken) {
      return finishFirebaseLogin(freshToken, true); // retry exactly once
    }
  }
  // Refresh wasn't possible or didn't help (or this IS the retry and it
  // still failed) — requirement #4: a Firebase session that can't be
  // salvaged is fully cleared, not left half-alive to fail the same way
  // again on the next attempt.
  if (window.ppFirebaseAuth && window.ppFirebaseAuth.fullFirebaseSignOut) {
    window.ppFirebaseAuth.fullFirebaseSignOut().catch(() => {});
  }
  console.error("[FIREBASE-AUTH] firebase-login failed:", r.code, r.message);
  toast(r.message || "Login failed");
}

$("btn-google-login").addEventListener("click", async () => {
  try {
    const idToken = await window.ppFirebaseAuth.signInWithGoogle();
    await finishFirebaseLogin(idToken);
  } catch (err) {
    console.error("[FIREBASE-AUTH] signInWithGoogle failed:", err);
    // Popup closed by the user is not a real error — no toast needed.
    if (err.code !== "auth/popup-closed-by-user") toast(err.message || "Google sign-in failed");
  }
});


// ===========================================================================
// SCREEN WAKE LOCK
// ===========================================================================
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }
  } catch (e) { /* not supported / denied — fail silently */ }
}
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && me) await requestWakeLock();
  // ROOT-CAUSE FIX (2026-08-11, Phase 3 item #2 — "seated speaker stays
  // silent after prolonged backgrounding"): some mobile browsers (most
  // reliably iOS Safari; Android under memory pressure can do the same)
  // end the getUserMedia mic track outright while the tab/app is
  // backgrounded for a while, rather than only dropping the Socket.IO
  // connection. `localStream` then keeps referencing a now-dead
  // MediaStreamTrack (readyState "ended"). Neither the mesh path
  // (ensureLocalTracksSent()'s `hasAudioSender` check still sees a
  // sender already holding that dead track, so it does nothing) nor the
  // SFU seated-speaker self-heal added above this file's room-state
  // handler can recover a live mic from a truthy-but-dead `localStream` —
  // both only check "do we have a stream", not "is the track still
  // live". On resume, if we're seated and the current track has actually
  // ended, drop the stale reference so the normal init path (same one a
  // fresh seat-take already uses) re-acquires a real track and
  // reconnects, instead of silently doing nothing.
  if (document.visibilityState === "visible" && mySeatNumber !== null && currentRoomId) {
    const track = localStream && localStream.getAudioTracks()[0];
    if (track && track.readyState === "ended") {
      console.warn("[voice] mic track ended while backgrounded — re-acquiring");
      localStream = null;
      await initMicIfNeeded();
      ensureLocalTracksSent(); // no-op in SFU mode (peerConnections stays empty there) — mirrors the existing room-state handler's own call pattern
    }
  }
});

function consumeRoomInviteLink() {
  try {
    const params = new URLSearchParams(location.search || "");
    const roomId = (params.get("room") || params.get("roomInvite") || "").trim();
    if (!roomId || !me) return false;
    const key = `pp_room_invite_consumed:${roomId}`;
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    history.replaceState(history.state, "", location.pathname + location.hash);
    setTimeout(() => joinRoom(roomId), 120);
    return true;
  } catch (e) { console.warn("[ROOM-SHARE] deep link parse failed", e); return false; }
}

function enterApp() {
  applyLanguage(me && me.language);
  // First Time Profile Setup — a brand-new account lands here first no
  // matter which entry point logged them in (OTP or password), and this
  // check runs every time enterApp() is reached (including bootstrap on
  // refresh) so a half-finished setup can never be skipped by accident.
  // Once profile_completed flips to true on the server, this branch is
  // never hit again for that account.
  if (me && me.profile_completed === false) {
    showProfileSetupScreen();
    return;
  }
  fillHomeProfile();
  const lockToggle = $("toggle-logout-lock");
  if (lockToggle) lockToggle.checked = isLogoutLockOn();
  loadRoomList();
  loadActiveSocialTab();
  loadAnnouncements();
  requestWakeLock();
  showView("view-home");
  consumeRoomInviteLink();
}

// ===========================================================================
// FIRST TIME PROFILE SETUP (new user only) — also reused by Edit Profile
// ===========================================================================
let psSelectedGender = null;

function buildCountryOptions(selectEl, selectedId) {
  selectEl.innerHTML = '<option value="" disabled selected hidden>...</option>';
  COUNTRIES_CACHE.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.flag} ${c.name_en}`;
    if (c.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}
function buildLanguageOptions(selectEl, countryId, selectedLang) {
  const country = COUNTRIES_CACHE.find((c) => c.id === countryId);
  selectEl.innerHTML = "";
  (country ? country.languages : []).forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.textContent = l.name;
    if (l.code === selectedLang) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function setGenderPills(rowEl, gender) {
  rowEl.querySelectorAll(".ps-gender-pill").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.gender === gender);
    btn.onclick = () => {
      rowEl.querySelectorAll(".ps-gender-pill").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      rowEl.dataset.selected = btn.dataset.gender;
    };
  });
  rowEl.dataset.selected = gender || "";
}

let usernameCheckTimer = null;
function wireUsernameCheck(inputEl, statusEl) {
  inputEl.addEventListener("input", () => {
    clearTimeout(usernameCheckTimer);
    const val = inputEl.value.trim();
    if (!val) { statusEl.textContent = ""; statusEl.className = "ps-field-status"; return; }
    statusEl.textContent = "Checking...";
    statusEl.className = "ps-field-status";
    usernameCheckTimer = setTimeout(async () => {
      const r = await api("/api/user/check-username", "POST", { username: val });
      if (r.success && r.available) {
        statusEl.textContent = "✓ Available";
        statusEl.className = "ps-field-status ok";
      } else {
        statusEl.textContent = (r.message) || "Not available";
        statusEl.className = "ps-field-status err";
      }
    }, 450);
  });
}

async function showProfileSetupScreen() {
  await loadCountriesCache();
  $("ps-avatar-preview").src = me.photo || placeholderAvatar(me.name);
  $("ps-username").value = "";
  $("ps-username-status").textContent = "";
  setGenderPills($("ps-gender-row"), null);
  buildCountryOptions($("ps-country"), null);
  $("ps-language").innerHTML = "";
  showView("view-profile-setup");
}

wireUsernameCheck($("ps-username"), $("ps-username-status"));

$("ps-country").addEventListener("change", () => {
  buildLanguageOptions($("ps-language"), $("ps-country").value, null);
});

// Avatar: tapping the edit button opens a small sheet offering Camera vs
// Gallery (guideline Section 1) — Skip is always fine, a default avatar is
// used, and it can be added later from Edit Profile.
$("ps-avatar-btn").addEventListener("click", () => $("ps-photo-sheet").classList.toggle("hidden"));
$("ps-photo-sheet-close").addEventListener("click", () => $("ps-photo-sheet").classList.add("hidden"));
$("ps-pick-camera").addEventListener("click", () => { $("ps-photo-sheet").classList.add("hidden"); $("ps-photo-camera").click(); });
$("ps-pick-gallery").addEventListener("click", () => { $("ps-photo-sheet").classList.add("hidden"); $("ps-photo-gallery").click(); });
async function handlePsPhoto(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type || "")) { toast("Choose a JPG, PNG, or WebP image"); return; }
  if (file.size > 12 * 1024 * 1024) { toast("Image must be 12 MB or smaller"); return; }
  let sourceUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const overlay = document.createElement("div");
    overlay.className = "pp-crop-overlay";
    overlay.innerHTML = `<section class="pp-crop-card" role="dialog" aria-modal="true" aria-label="Crop profile photo"><header><strong>Crop profile photo</strong><button type="button" class="pp-crop-close" aria-label="Close">×</button></header><canvas width="320" height="320"></canvas><label>Zoom <input class="pp-crop-zoom" type="range" min="1" max="3" step="0.05" value="1"></label><p>Move the zoom slider to adjust the square crop.</p><footer><button type="button" class="pp-crop-cancel">Cancel</button><button type="button" class="pp-crop-save">Use photo</button></footer></section>`;
    document.body.appendChild(overlay);
    const canvas = overlay.querySelector("canvas"), ctx = canvas.getContext("2d"), zoom = overlay.querySelector(".pp-crop-zoom");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const draw = () => { const z = Number(zoom.value), sw = side / z, sx = (img.naturalWidth-sw)/2, sy = (img.naturalHeight-sw)/2; ctx.clearRect(0,0,320,320); ctx.drawImage(img,sx,sy,sw,sw,0,0,320,320); };
    const close = () => { overlay.remove(); URL.revokeObjectURL(sourceUrl); };
    zoom.addEventListener("input", draw); draw();
    overlay.querySelector(".pp-crop-close").addEventListener("click",close);
    overlay.querySelector(".pp-crop-cancel").addEventListener("click",close);
    overlay.addEventListener("click",e=>{if(e.target===overlay)close();});
    overlay.querySelector(".pp-crop-save").addEventListener("click",async()=>{
      const save=overlay.querySelector(".pp-crop-save"); save.disabled=true; save.textContent="Saving…";
      canvas.toBlob(async blob=>{ if(!blob){save.disabled=false;save.textContent="Use photo";toast("Could not crop this image");return;}
        const fd=new FormData(); fd.append("photo",blob,"profile.webp");
        const r=await apiUpload("/api/user/upload-photo",fd);
        if(r.success){me.photo=r.url;saveSession();$("ps-avatar-preview").src=r.url;close();}else{save.disabled=false;save.textContent="Use photo";toast(r.message||"Upload failed");}
      },"image/webp",0.88);
    });
  };
  img.onerror=()=>{URL.revokeObjectURL(sourceUrl);toast("Could not open this image");}; img.src=sourceUrl;
}
$("ps-photo-camera").addEventListener("change", (e) => handlePsPhoto(e.target.files[0]));
$("ps-photo-gallery").addEventListener("change", (e) => handlePsPhoto(e.target.files[0]));

$("btn-save-profile-setup").addEventListener("click", async () => {
  const username = $("ps-username").value.trim();
  const gender = $("ps-gender-row").dataset.selected;
  const country = $("ps-country").value;
  const language = $("ps-language").value;
  if (!username) { toast("Enter a Username"); return; }
  if (!gender) { toast("Select a Gender"); return; }
  if (!country) { toast("Select a Country"); return; }
  if (!language) { toast("Select a Language"); return; }
  const saveBtn = $("btn-save-profile-setup");
  const oldLabel = saveBtn.textContent;
  saveBtn.disabled = true; saveBtn.textContent = "Saving…";
  const r = await api("/api/user/complete-profile", "POST", { username, gender, country, language }).catch(() => ({success:false, message:"Network error. Please try again."}));
  saveBtn.disabled = false; saveBtn.textContent = oldLabel;
  if (r.success) {
    me = r.user;
    saveSession();
    applyLanguage(me.language);
    toast("Profile saved");
    enterApp();
  } else toast(r.message || "Something went wrong");
});

// ===========================================================================
// SOCKET.IO
// ===========================================================================
// Keeps the pp_room_ts freshness marker (see loadActiveRoomIfFresh()) from
// aging out while someone is genuinely, continuously in a room — only an
// actual gap (refresh, brief disconnect) should ever let it go stale.
setInterval(() => {
  if (currentRoomId && socket && socket.connected) saveActiveRoom(currentRoomId);
}, 5000);

// Phase 3 / Step 3.3: asks the server which voice transport is active
// (GET /api/voice-sfu/mode, added in Step 3.2 — inert until now). Any
// failure (network error, older server without this route, bad JSON)
// leaves voiceMode at its "mesh" default rather than throwing, so a
// broken or missing endpoint can never accidentally send this client down
// an SFU path it can't actually use. Safe to call repeatedly — cheap,
// unauthenticated, no side effects server-side.
async function refreshVoiceMode() {
  try {
    const agoraRes = await fetch("/api/agora/mode");
    const agoraData = await agoraRes.json();
    if (agoraData && agoraData.success && agoraData.voiceMode === "agora" && agoraData.configured) {
      voiceMode = "agora";
      window.PingPongVoiceMode = "agora";
      return;
    }
  } catch (_) {}
  try {
    // Staged rollout decisions are room-scoped. Without roomId the endpoint
    // reports the global base mode ("mesh" for VOICE_MODE=staged), which
    // would leave allowlisted rooms on the wrong transport.
    const roomQuery = currentRoomId ? `?roomId=${encodeURIComponent(currentRoomId)}` : "";
    const res = await fetch(`/api/voice-sfu/mode${roomQuery}`);
    const data = await res.json();
    const resolvedMode = data && (data.effectiveVoiceMode || data.voiceMode);
    voiceMode = data && data.success && resolvedMode === "sfu" ? "sfu" : "mesh";
  } catch (e) {
    voiceMode = "mesh";
  }
  window.PingPongVoiceMode = voiceMode;
}

function connectSocket() {
  if (socket) return;
  // FIX (repeated disconnect/rejoin loop, 2026-07-29): this was plain
  // io() with library defaults, which back off between reconnect attempts
  // (starting at 1s, growing up to 5s, and that's on top of however long
  // the attempt itself takes to fail on a bad connection). On a flaky
  // mobile network or a tunnel (ngrok/cloudflared-style, common for a
  // Termux-hosted server), a handful of slow/failed attempts in a row can
  // add up to more than the server's room-seat grace period, so the seat
  // gets freed while the client is still genuinely trying to get back in
  // — which looks exactly like the join→leave→join→leave loop we saw in
  // the server logs. Retrying quickly and persistently (capped at 3s
  // between tries, never giving up) gives every attempt the best realistic
  // chance to land inside the grace window instead of outside it.
  socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 20000,
    // Mobile browsers, Android WebView and local Termux tunnels can have
    // WebSocket handshake failures even while normal HTTP works. Let
    // Socket.IO immediately fall back to polling and upgrade later.
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    upgrade: true
  });
  window.socket = socket;
  attachRocketBridge(socket);
  registerCallSocketEvents();
  chRegisterSocketHandlers();

  socket.on("connect_error", (err) => {
    console.warn("[SOCKET] connect_error:", err?.message || err);
  });
  socket.on("disconnect", (reason) => {
    console.warn("[SOCKET] disconnected:", reason);
    if (currentRoomId) toast("Connection interrupted — reconnecting…");
  });
  socket.on("room-ui-config-update", (config) => {
    try { applyRoomUiConfig(config); if (currentRoom?.seats) renderSeats(currentRoom.seats); }
    catch (e) { console.warn("[ROOM UI] live size update failed", e); }
  });

  socket.on("connect", async () => {
    // ROOT-CAUSE FIX (2026-09-26, "Expired" session bug — socket path): a
    // Socket.IO reconnect (network switch, brief drop, or the tab/WebView
    // coming back to the foreground after being backgrounded — background
    // JS timers, including scheduleProactiveRefresh()'s setTimeout, are
    // routinely throttled/suspended by mobile browsers) can land AFTER the
    // access token has already silently expired without the proactive
    // refresh ever firing. Sending that stale token gets us
    // "identify-rejected" below. Check first and refresh here too, not
    // just reactively — this mirrors the REST api() proactive+reactive
    // pattern instead of only having the reactive half on the socket path.
    if (accessTokenExpiresAt && Date.now() >= accessTokenExpiresAt - 5000 && productionRefreshToken) {
      await tryRefreshProductionSession();
    }
    // SECURITY HARDENING (Module 5.1): now also sends authToken so the
    // server can cryptographically verify this identify claim instead of
    // trusting a bare userId — see server.js's identify handler.
    if (me && me.userId) socket.emit("identify", { userId: me.userId, authToken });
    if (currentRoomId === "101") socket.emit("cs101:start");
    // Resolve the transport BEFORE rejoining the room. Otherwise a server
    // configured for SFU can briefly execute the mesh path during a mobile
    // reconnect, creating duplicate media transports and negotiation churn.
    try { await refreshVoiceMode(); } catch (_) {}
    loadPrivateUnread();
    if (currentRoomId) rejoinRoom();
  });

  // Real winner feed for Lucky Fruit (replaces the old fake
  // demo names/tickers with actual players and actual amounts won,
  // sourced from real server-settled Lucky Fruit wins).
  socket.on("real-win", (entry) => {
    recentWins.unshift(entry);
    if (recentWins.length > 30) recentWins = recentWins.slice(0, 30);
    sendRealWinsToGame();
  });

  socket.on("room-list", renderRoomList);

  // ---- Official AI Customer Service Room 101 ----
  socket.on("cs101:ready", (info) => {
    if (currentRoomId !== "101") return;
    cs101ConfigClient = { ...cs101ConfigClient, ...(info || {}) };
    renderCs101Seat();
    cs101MaybeGreetOnSeat();
  });

  socket.on("cs101:config", (info) => {
    if (!info) return;
    cs101ConfigClient = { ...cs101ConfigClient, ...info };
    renderCs101Seat();
  });

  socket.on("cs101:reply", (payload) => {
    if (currentRoomId !== "101") return;
    cs101AppendMessage("ai", payload.text || "");
    cs101Speak(payload.text || "", payload.voice || {});
  });

  socket.on("cs101:error", () => {
    // Deliberately silent in the customer UI. Failures are logged server-side
    // and the AI can retry without exposing technical errors to the user.
  });
  socket.on("room-ranking-data", (payload) => {
    if (payload.roomId !== currentRoomId) return;
    rankingCache = { daily: payload.daily, weekly: payload.weekly, monthly: payload.monthly };
    renderRankingPreview();
    if (!$("modal-room-ranking").classList.contains("hidden")) renderRanking();
  });
  socket.on("room-ranking-update", (payload) => {
    if (payload.roomId !== currentRoomId) return;
    rankingCache = { daily: payload.daily, weekly: payload.weekly, monthly: payload.monthly };
    renderRankingPreview();
    if (!$("modal-room-ranking").classList.contains("hidden")) renderRanking();
  });
  socket.on("follow-status-update", handleFollowStatusUpdate);
  // Home no longer exposes the Groups tab; group features remain available elsewhere.

  // MESH VOICE TOPOLOGY (production hardening): a seated speaker must be
  // audible to BOTH seated peers and audience listeners. The previous
  // implementation built the mesh from room.seats only, so an audience
  // member never created a receiving RTCPeerConnection and could not hear
  // anyone. Build the desired graph from onlineUsers, but only create an
  // edge when at least one endpoint is seated (audience-to-audience is
  // unnecessary). Audience clients have no localStream, so they receive only.
  function reconcileMeshVoice(room) {
    if (voiceMode === "sfu" || !room || !Array.isArray(room.seats)) return;
    const selfId = me && me.userId;
    const seatedByUser = new Map();
    room.seats.forEach((seat) => {
      if (seat && seat.userId && seat.socketId) seatedByUser.set(seat.userId, seat.socketId);
    });
    const online = Array.isArray(room.onlineUsers) ? room.onlineUsers : [];
    const sockets = new Map();
    online.forEach((u) => {
      if (u && u.userId && u.socketId && u.userId !== selfId) sockets.set(u.userId, u.socketId);
    });
    // If the public room snapshot is briefly behind seat-update, preserve
    // the authoritative seat socket IDs as a fallback.
    seatedByUser.forEach((sid, uid) => { if (uid !== selfId) sockets.set(uid, sid); });

    const desired = new Set();
    sockets.forEach((sid, uid) => {
      const remoteIsSeated = seatedByUser.has(uid);
      const selfIsSeated = !!(mySeatNumber !== null && mySeatNumber !== undefined);
      if (selfIsSeated || remoteIsSeated) desired.add(sid);
    });

    Object.keys(peerConnections).forEach((sid) => {
      if (!desired.has(sid)) closePeer(sid);
    });
    desired.forEach((sid) => {
      if (!peerConnections[sid]) connectToPeer(sid);
    });
  }

  // Vapi client-side room-control tool needs the authenticated Socket.IO
  // channel. Expose only the socket object, never credentials.
  window.socket = socket;

  if (!window.__ppVoiceRecoveryTimer) {
    window.__ppVoiceRecoveryTimer=setInterval(()=>{
      if(!currentRoom || !currentRoomId) return;
      if (voiceMode==='sfu') {
        // ROOT-CAUSE FIX (2026-09-27, "audience can't hear seated user" —
        // remaining gap): sfuIsHealthy()/scheduleSfuRecovery() (see below)
        // existed but were ONLY ever invoked reactively — from LiveKit's own
        // onDisconnected callback, or from a publish failure caught inside
        // connectSfuRoom(). A seated participant whose mic publication goes
        // silently unhealthy WITHOUT LiveKit ever firing a disconnect event
        // (e.g. the OS revokes mic access, the underlying track ends on its
        // own, or the publish "succeeds" locally but never actually reaches
        // the server) had no path back to a healthy state — nothing was
        // polling. The mesh path already had this exact belt-and-suspenders
        // periodic check (reconcileMeshVoice/ensureLocalTracksSent, right
        // below); the SFU path had the health helper but not the poll. This
        // adds the poll using the same isMicPublished()-aware health check
        // the reactive paths already use, so a seated user's audio can never
        // be stuck silently broken between reactive triggers. try/catch
        // mirrors the mesh branch below so a health-check bug here can never
        // break this timer for either voice mode.
        try { if (!sfuIsHealthy() && !sfuVoiceLeaving) scheduleSfuRecovery('periodic-health-check'); } catch(e) { console.warn('[voice-sfu] periodic health check failed', e); }
        return;
      }
      if (voiceMode==='agora') return;
      try { reconcileMeshVoice(currentRoom); ensureLocalTracksSent(); } catch(e) { console.warn('[voice] periodic recovery failed',e); }
    },5000);
  }

  socket.on("room-joined", (data) => {
    if (!data?.roomId || data.roomId !== currentRoomId || leaveInProgress) return;
    roomJoinAckId = data.roomId;
    giftCalculatorState = { on: false, totals: Array(12).fill(0) };
    joinedRoomId = data.roomId;
    joinInProgress = false;
    if (!roomKept) showView("view-room");
    updateKeptRoomPill();
    notifyAndroidVoiceSession(true);
  });

  socket.on("room-state", (room) => {
    const previousRoomId = currentRoomId;
    currentRoom = room;
    currentRoom.musicPlaylist = Array.isArray(room?.musicPlaylist) ? room.musicPlaylist : [];
    if (room?.music) setMusicUI(room.music);
    else renderMusicPlaylist();
    if (previousRoomId !== room?.roomId) {
      giftCalculatorState = { on: false, totals: Array(12).fill(0) };
    }
    // ROOT-CAUSE FIX (2026-08-14, reconnect / duplicate join-room audit):
    // "room-state" for OUR own room is the server's acknowledgement that a
    // "join-room" we sent has actually completed (see finishJoin() in
    // server.js — it always emits "room-state" directly back to the
    // joining socket right after the join finishes). This is the one
    // place that clears joinInProgress / advances joinedRoomId, so a
    // join is never considered "done" client-side until the server has
    // actually confirmed it — closing the window where a double-tap or a
    // rapid reconnect could fire a second "join-room" on top of one still
    // in flight. If the user tapped a different room while this join was
    // in flight, dispatch that queued request now instead of settling on
    // the room that just arrived (only the LAST requested room should win).
    if (room && room.roomId === currentRoomId && !leaveInProgress) {
      // A room-wide room-state broadcast is not itself a join ACK. The server
      // now sends a direct room-joined event to the requesting socket. The
      // onlineUsers check remains as a compatibility fallback for older/live
      // servers and for normal post-join broadcasts.
      const selfJoined = Array.isArray(room.onlineUsers) && room.onlineUsers.some((u) => String(u?.userId || "") === String(me?.userId || ""));
      const joinConfirmed = roomJoinAckId === room.roomId || joinedRoomId === room.roomId || selfJoined;
      if (!joinConfirmed && joinInProgress) return;
      if (selfJoined && !roomJoinAckId && joinInProgress) roomJoinAckId = room.roomId;
      if (joinConfirmed) {
        joinedRoomId = room.roomId;
        joinInProgress = false;
        if (!roomKept) showView("view-room");
        updateKeptRoomPill();
        notifyAndroidVoiceSession(true);
        if (pendingJoinRequest && pendingJoinRequest.roomId !== room.roomId) {
          const next = pendingJoinRequest;
          pendingJoinRequest = null;
          joinRoom(next.roomId, next.password);
        } else {
          pendingJoinRequest = null;
        }
      }
    }
    // PHASE 1 FIX (2026-08-16, seat/mic authoritative-state audit): hydrate
    // seatMap/mySeatNumber from THIS room-state snapshot BEFORE any UI element
    // (mic button, Robin button, etc.) reads mySeatNumber below. Previously
    // hydrateSeatMap() ran after this block, so every visibility decision in
    // this block was made using the PREVIOUS snapshot's seat state — a stale-
    // by-one-broadcast bug (frontend briefly not matching backend room state).
    // seatsFromMap()/renderSeats() were already tolerant of this since they
    // re-run below, but toggles that read mySeatNumber directly (like the mic
    // button below) were not.
    hydrateSeatMap(room.seats);
    if (roomEntryEffectPending && room && room.roomId === currentRoomId && lastPremiumEntryRoomId !== room.roomId) {
      roomEntryEffectPending = false;
      lastPremiumEntryRoomId = room.roomId;
      const maybeShowEntry = (level) => {
        const mySvip = Number(level || 0);
        if (mySvip >= 5) showPremiumRoomEntryEffect(mySvip, "entry");
      };
      try {
        const cachedLevel = Number(me?.svipLevel || 0);
        if (cachedLevel >= 5) maybeShowEntry(cachedLevel);
        else api("/api/svip/status/" + encodeURIComponent(me?.userId || "")).then((r) => {
          if (r?.success && me && Number(r.svipLevel || 0) >= 5) { me.svipLevel = Number(r.svipLevel || 0); maybeShowEntry(me.svipLevel); }
        }).catch(() => {});
      } catch (e) { console.warn("premium room entry effect failed", e); }
    }
    // The Robin toolbar button must exist only in Room 101 — it must not be
    // reachable (or even visible) from any other room, and this fires on
    // every room-state snapshot so it can't get stuck showing after a
    // room switch either way.
    const robinBtn = $("btn-robin-support");
    if (robinBtn) robinBtn.classList.toggle("hidden", !(room && room.roomId === "101"));
    if (room && room.roomId === "101") {
      $("btn-mic-toggle")?.classList.toggle("hidden", mySeatNumber != null);
      if (room.aiSeat) cs101ConfigClient = { ...cs101ConfigClient, agentName: room.aiSeat.userName || cs101ConfigClient.agentName, avatarUrl: room.aiSeat.avatarUrl || cs101ConfigClient.avatarUrl };
      renderCs101Seat();
      initCs101Ui();
      if (socket) socket.emit("cs101:start");
    } else {
      cs101StopRecognition();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      cs101GreetedSeatKey = null;
      // Safety net: any path that lands a room-state snapshot for a room
      // other than 101 (e.g. force-moved to a different room, or a
      // reconnect that resumes into a different room than Robin's call was
      // started in) must not leave a Vapi call — and its open microphone —
      // running in the background. The explicit leave-seat/leave-room
      // handlers already stop Robin for the ordinary paths; this covers
      // the remaining ones so no AI voice state can ever survive outside
      // Room 101.
      if (window.PingPongRobin?.isActive?.()) window.PingPongRobin.stop();
      // PHASE 1 FIX (§12 — bottom control bar must reflect seat state): in
      // every non-101 room the mic-toggle button was always visible/tappable
      // regardless of seat state. It was already functionally guarded (the
      // click handler toasts "Take a seat to talk" and never requests a mic
      // or opens a voice connection when mySeatNumber is null — no rogue
      // voice connection was ever created), but an unseated audience member
      // could still see what looks like a live mic control. Hide it exactly
      // like Room 101 already does for its own AI-seat case, keyed off the
      // now-freshly-hydrated mySeatNumber above.
      $("btn-mic-toggle")?.classList.toggle("hidden", mySeatNumber == null);
    }
    currentRelationshipLinks = Array.isArray(room.relationshipLinks) ? room.relationshipLinks : [];
    if (!relationshipVisualConfigLoaded) fetchRelationshipVisualConfig(); // once per session is enough; live changes come via the socket event above
    renderSeats(room.seats);
    socket.emit("get-room-ranking", { roomId: room.roomId });
    if (room && room.roomId === "101") cs101MaybeGreetOnSeat();
    // Fix (voice goes silent after reconnect/refresh): seat data is hydrated
    // above, but that alone doesn't re-establish WebRTC audio to peers who
    // were already seated before we (re)connected — previously you'd see
    // them on their seat but hear nothing until they happened to re-take a
    // seat. If we're seated ourselves, (re)connect to every other occupied
    // seat's current socket, and drop any peer connection that's stale
    // (pointing at a socket id that's no longer actually seated here).
    // Phase 3 / Step 3.3: mesh-only. In SFU mode this whole peer-mesh
    // reconciliation is skipped — LiveKit's own subscription/publish
    // lifecycle (see public/voice-sfu.js) is what re-establishes audio
    // after a reconnect there, not per-peer RTCPeerConnections.
    if (voiceMode !== "sfu" && me) reconcileMeshVoice(room);
    renderChatLog(room.messages || []);
    try { updatePrivateUnreadUi(); } catch (_) {}
    $("room-name-display").firstChild.textContent = room.roomName + " ";
    $("room-lock-badge").classList.toggle("hidden", !room.roomLocked);
    // Room header is server-driven: show the live room number/ID, never a hardcoded demo value.
    const liveRoomId = room.roomNumber || room.roomId || "";
    $("room-host-display").textContent = liveRoomId ? "ID: " + liveRoomId : "";
    renderPartyOwnerSeat(room);
    updatePartyRoomQuickbar(room);
    updateKeptRoomPill();
    // Room-scoped music: every room-state snapshot fully replaces the local
    // player state. A room with no music must stop/unload the previous room's
    // audio immediately, preventing Room A's song from bleeding into Room B.
    setMusicUI(room.music && room.music.url ? room.music : { url: "", name: "", playing: false });
    applyRoomBackground(room.background || "");
    setRoomLogo(room.logo);
    // BUG FIX (settings-icon-does-nothing, 2026-07-29): this used to read
    // me.userId unconditionally. If `me` was ever momentarily null when a
    // room-state update arrived, this whole handler threw right here and
    // every line after it (including showing/hiding the Settings gear,
    // chat rendering, YouTube state, etc.) silently never ran for that
    // update. `me` is guarded now so one bad tick can't wedge the UI.
    const canModerate = !!me && (room.hostId === me.userId || (room.adminIds || []).includes(me.userId));
    $("btn-room-mod").classList.toggle("hidden", !canModerate);
    if (room.treasureChest) renderChest(room.treasureChest);

    // YouTube Room Player — hydrate playlist + playback state, same
    // control permission as room moderation (owner/admin).
    canControlYt = canModerate;
    $("btn-toggle-yt").classList.toggle("hidden", !canControlYt);
    ytCurrentPlaylist = room.videoPlaylist || [];
    renderYtPlaylist();
    if (room.videoPlayer) {
      ytPlayerState.mode = !!room.videoPlayer.mode;
      setYtModeUI(ytPlayerState.mode, true);
      applyYtPlayerState(room.videoPlayer);
    }
    initMicIfNeeded().then(ensureLocalTracksSent);
    if (voiceMode === "agora") {
      if (mySeatNumber === null) window.PingPongVoiceAgora?.connect({ room: currentRoomId, publish: false }).catch(e => console.warn("[agora] audience connect failed:", e));
      else if (window.PingPongVoiceAgora && !window.PingPongVoiceAgora.isConnected()) window.PingPongVoiceAgora.connect({ room: currentRoomId, publish: true }).catch(e => console.warn("[agora] seated connect failed:", e));
    }
    // PHASE 3, STEP 3.6 — audience (non-seated) SFU listening. Fires on
    // every room-state sync (initial join, reconnect, refresh).
    if (voiceMode === "sfu" && mySeatNumber === null) connectSfuAsAudience();
    // ROOT-CAUSE FIX (2026-08-11, "seated speaker goes permanently silent
    // over SFU after a dropped LiveKit connection"): connectSfuAsAudience()
    // above self-heals on every room-state sync, but a SEATED publisher had
    // no equivalent. Root cause: initMicIfNeeded() (called a few lines up)
    // starts with `if (localStream || !mySeatNumber) return;` — so once
    // localStream exists (mic hardware already granted), it returns
    // immediately and never re-enters initSfuMicIfNeeded()/connectSfuRoom(),
    // regardless of whether the LiveKit Room itself is still connected. If
    // LiveKit's own internal reconnect ever gives up for good — the token
    // TTL (LIVEKIT_TOKEN_TTL_SECONDS, default 6h) elapsing mid-session is
    // the most likely real-world trigger for a long-running voice room, but
    // any other terminal LiveKit disconnect has the same effect — the only
    // symptom was `onDisconnected` quietly setting `sfuConnected = false`:
    // no toast, no automatic recovery, and the existing mic-toggle button
    // can't fix it either (it only calls connectSfuRoom() from inside the
    // `if (!localStream)` branch, which is already false here). The seated
    // user's mic UI stays "on" and they keep talking into a socket nobody
    // is listening to for the rest of the session, until they leave and
    // re-take a seat. Mirrors connectSfuAsAudience()'s exact self-heal
    // shape: fires on every room-state sync, no-ops unless we're actually
    // seated, on SFU, already holding a live mic track, and NOT currently
    // connected — connectSfuRoom() itself is already idempotent/guarded, so
    // this cannot double-connect or double-publish.
    if (voiceMode === "sfu" && mySeatNumber !== null && localStream && !window.PingPongVoiceSFU.isConnected()) connectSfuRoom();
    if (voiceMode === "agora" && mySeatNumber !== null && window.PingPongVoiceAgora && !window.PingPongVoiceAgora.isConnected()) window.PingPongVoiceAgora.connect({ room: currentRoomId, publish: true }).catch(e => console.warn("[agora] seated self-heal failed:", e));

    // Fix: the game overlay's toggle button is only shown when an admin has
    // actually enabled games for this room (see Admin Panel → Rooms). If an
    // admin turns it off while someone has it open, close it for them too.
    const gameAllowed = room.gameEnabled !== false;
    $("btn-toggle-game").classList.toggle("hidden", !gameAllowed);
    $("btn-lucky-fruit-launcher")?.classList.toggle("hidden", !gameAllowed);
    if (!gameAllowed) closeRoomGame();
  });

  socket.on("user-count", (data) => {
    const pill = $("room-online-count");
    const value = $("room-online-count-value");
    const next = String(Math.max(0, Number(data?.count) || 0));
    // Keep the supplied member icon mounted. Only update the numeric value,
    // so legacy emoji/icon markup can never overwrite the new transparent icon.
    if (value.textContent !== next) {
      value.textContent = next;
      pill.classList.remove("count-bump");
      void pill.offsetWidth;
      pill.classList.add("count-bump");
    }
    if (roomKept) updateKeptRoomPill();
  });

  $("room-online-count").addEventListener("click", () => {
    const list = $("online-members-list");
    list.innerHTML = "";
    const users = currentRoom?.onlineUsers || [];
    if (!users.length) {
      list.innerHTML = '<div class="gift-target-empty">No one yet</div>';
    } else {
      users.forEach((u) => {
        const row = document.createElement("div");
        row.className = "gift-target-row";
        row.style.cursor = "pointer";
        row.innerHTML = `<img class="avatar avatar-sm" src="${escapeHtml(u.userPhoto || placeholderAvatar(u.userName))}" alt=""><span>${escapeHtml(u.userName)}${u.userId === currentRoom.hostId ? " 👑" : ""}</span>`;
        row.addEventListener("click", () => {
          $("modal-online-members").classList.add("hidden");
          const seatNumber = seatNumberForUser(u.userId);
          openSeatProfileSheet(u.userId, seatNumber);
        });
        list.appendChild(row);
      });
    }
    $("modal-online-members").classList.remove("hidden");
  });
  $("btn-close-online-members").addEventListener("click", () => $("modal-online-members").classList.add("hidden"));

  socket.on("seat-update", (data) => {
    if (data.action === "take") {
      if (data.oldSeatNumber && seatMap[data.oldSeatNumber]) delete seatMap[data.oldSeatNumber];
      // BUG FIX: "take" dropped customTag while "move" (below) kept it — a
      // freshly-seated user's tag/name-color badge stayed missing on the
      // seat until an unrelated seat "move" or full room-state refresh
      // happened to repopulate it. Server already sends customTag on take
      // (see server.js seat-update "take" emit); the client just wasn't
      // storing it. Mirrors the "move" branch below exactly.
      seatMap[data.seatNumber] = { userId: data.userId, socketId: data.socketId, userName: data.userName, userPhoto: data.userPhoto, role: data.role, activeFrame: data.activeFrame || null, vipLevel: data.vipLevel || 0, svipLevel: data.svipLevel || 0, secretLord: !!data.secretLord, level: Number(data.level) || 1, customTag: data.customTag || null, agencyBadge: data.agencyBadge || null, nameEffect: data.nameEffect || null };
      if (data.userId === me.userId) {
        // BUG FIX: this used to only set mySeatNumber and stop — the mic
        // (getUserMedia) never got requested here, only inside the
        // "room-state" handler. take-seat only ever emits "seat-update", so
        // a freshly-seated user's mic stayed uninitialized (localStream ===
        // null) until some unrelated room-state broadcast happened to fire
        // later. Meanwhile every other seated user immediately tries to
        // connectToPeer() them (see the `else` branch below) — their side
        // answers with zero audio tracks, so nobody hears the new seat even
        // though the connection itself "succeeds". Requesting the mic here,
        // then pushing tracks into any peer connections that already exist
        // (see ensureLocalTracksSent), closes that gap.
        mySeatNumber = data.seatNumber;
        if (voiceMode === "agora") {
          initMicIfNeeded().then(() => window.PingPongVoiceAgora?.connect({ room: currentRoomId, publish: true })).catch(e => console.warn("[agora] take-seat connect failed:", e));
        }
        if (currentRoomId === "101") {
          cs101MaybeGreetOnSeat();
          $("btn-mic-toggle")?.classList.add("hidden");
        } else {
          // PHASE 1 FIX: mirror the room-state handler's seat-based
          // visibility here too — take-seat only ever emits "seat-update"
          // (see BUG FIX note above), never a fresh "room-state", so if we
          // only unhid the button on room-state it could stay stuck hidden
          // after a real seat-take until an unrelated room-state broadcast.
          $("btn-mic-toggle")?.classList.remove("hidden");
        }
        // Sitting down means the mic is immediately live. No second manual
        // tap is required; the toolbar button is only the mute/unmute control.
        micEnabled = true;
        if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = true; });
        updateMicButtonUi();
        initMicIfNeeded().then(async () => {
          startVoiceActivityDetection();
          await ensureLocalTracksSent();
        });
        // Also proactively connect to everyone already sitting, instead of
        // only ever waiting to be connected to — makes voice come up
        // immediately even if the other side's connectToPeer() call for us
        // fires first and loses a race with our getUserMedia() prompt.
        // Phase 3 / Step 3.3: mesh-only — in SFU mode initMicIfNeeded()
        // above joins the LiveKit room instead, which already both
        // publishes our mic and subscribes to every other participant, so
        // there is no per-peer connection step to do here.
        // ROOT-CAUSE FIX (voice drops on seat change, production symptom
        // 2026-08-10): this used to call connectToPeer() unconditionally for
        // every other seated peer, with no check for whether a connection to
        // them already existed. That's correct for a brand-new seat-join
        // (audience -> seat: no peer connection yet, must be created) but
        // wrong for a same-user seat MOVE (seat A -> seat B: same socketId,
        // connection to every other peer is already live and healthy) —
        // every already-seated peer's stable connection was getting a fresh,
        // pointless renegotiation offer purely because we sat down somewhere
        // else. That's exactly the "duplicate/unnecessary negotiation" class
        // of bug: harmless in the common case (glare handling in
        // getOrCreatePeer() resolves it), but under load (several people
        // already speaking) the resulting rollback/renegotiate churn is what
        // produced the observed "voice sometimes stops after a seat change,
        // recovers after a bit" symptom. Only reconnect to peers we don't
        // already have a connection to — mirrors the identical
        // `!peerConnections[sid]` guard the room-state reconciliation above
        // already uses for the same reason.
        if (voiceMode !== "sfu" && voiceMode !== "agora") {
          reconcileMeshVoice(currentRoom || { seats: seatsFromMap(), onlineUsers: [] });
        }
      } else if (voiceMode !== "sfu" && voiceMode !== "agora") {
        // Reconcile the complete seated/audience graph. This covers both a
        // new speaker joining and an audience listener joining an existing
        // room, without tearing down healthy peers on ordinary seat moves.
        reconcileMeshVoice(currentRoom || { seats: seatsFromMap(), onlineUsers: [] });
      }
    } else if (data.action === "move") {
      const from = Number(data.fromSeatNumber);
      const to = Number(data.seatNumber);
      // Seat moves can arrive around a room-state refresh. Resolve the existing
      // entry by seat first, then by userId, so a stale/missing source index
      // can never make the user's name/effect disappear during a seat change.
      const entry = seatMap[from] || Object.values(seatMap).find((s) => s && s.userId === data.userId) || null;
      Object.keys(seatMap).forEach((k) => {
        if (seatMap[k] && seatMap[k].userId === data.userId && Number(k) !== to) delete seatMap[k];
      });
      seatMap[to] = { ...(entry || {}), userId: data.userId, socketId: data.socketId || entry?.socketId, userName: data.userName || entry?.userName, userPhoto: data.userPhoto || entry?.userPhoto, role: data.role || entry?.role, activeFrame: data.activeFrame || entry?.activeFrame || null, vipLevel: data.vipLevel || entry?.vipLevel || 0, svipLevel: data.svipLevel || entry?.svipLevel || 0, secretLord: !!data.secretLord || !!entry?.secretLord, customTag: data.customTag || entry?.customTag || null, agencyBadge: data.agencyBadge || entry?.agencyBadge || null, nameEffect: data.nameEffect || entry?.nameEffect || null };
      if (data.userId === me.userId) {
        // Atomic seat move: preserve the existing voice transport/mic. Only
        // the seat number changes; no leave/join voice teardown occurs.
        mySeatNumber = to;
        if (currentRoomId === "101") {
          $("btn-mic-toggle")?.classList.add("hidden");
          cs101MaybeGreetOnSeat();
        } else {
          // PHASE 1 FIX: seat move keeps the user seated throughout, so the
          // button must stay visible/unhidden — explicit for clarity and to
          // guard against any earlier hidden state left over from a stale
          // snapshot.
          $("btn-mic-toggle")?.classList.remove("hidden");
        }
      }
      if (currentRoom) {
        currentRoom.seats = seatsFromMap();
        renderSeats(currentRoom.seats);
        if (voiceMode !== "sfu" && voiceMode !== "agora") reconcileMeshVoice(currentRoom);
      }
    } else if (data.action === "leave") {
      const entry = seatMap[data.seatNumber];
      if (entry) {
        if (entry.userId === me.userId) {
          mySeatNumber = null;
          if (currentRoomId === "101" && typeof window.PingPongRobin?.stop === "function") {
            // Stop both an active call and a call that is still connecting.
            // This is the authoritative seat-leave boundary.
            void window.PingPongRobin.stop();
          }
          if (currentRoomId === "101") $("btn-mic-toggle")?.classList.remove("hidden");
          // PHASE 1 FIX: leaving a seat in a non-101 room must hide the mic
          // control again immediately — matches §1/§12 ("when a user leaves
          // a seat, the mic/voice UI must disappear immediately").
          else $("btn-mic-toggle")?.classList.add("hidden");
          micEnabled = false;
          updateMicButtonUi();
          // Seat -> audience is a VOICE ROLE change, not a room exit. Keep
          // the media transport and microphone permission alive but disable
          // the local track so the user continues hearing every seated
          // speaker without publishing audio. The actual mic hardware is
          // released only when leaving the room (teardownVoice).
          if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = false; });
          stopVoiceActivityDetection();
          ensureLocalTracksSent();
          // PHASE 3, STEP 3.6 — covers BOTH self-initiated (leave-seat)
          // and admin-forced (mod-move-to-audience) moves, since server.js
          // broadcasts the same "seat-update"/action:"leave" event for
          // both. Mesh mode is untouched (guarded by voiceMode check) —
          // closePeer(entry.socketId) below already handles the mesh side
          // exactly as before this step.
          if (voiceMode === "sfu") downgradeSfuToAudience();
          if (voiceMode === "agora") window.PingPongVoiceAgora?.releaseMic?.();
        }
        closePeer(entry.socketId);
        speakingUsers.delete(entry.userId);
        voiceLevels.delete(String(entry.userId));
        delete seatMap[data.seatNumber];
      }
    }
    if (currentRoom) {
      // ROOT-CAUSE FIX (2026-08-22, "voice not heard after a seat leave"):
      // this used to call reconcileMeshVoice({ seats: seatsFromMap() }) —
      // an object with NO onlineUsers. reconcileMeshVoice() builds its
      // "who should stay connected" set from room.onlineUsers, so any
      // audience listener (someone below the seats, not seated) was
      // silently dropped from that set on every single seat-update event,
      // regardless of action ("take"/"move"/"leave"). Each already-seated
      // speaker's client would then see the audience listener's socket
      // missing from `desired` and close that peer connection — cutting
      // the listener's voice from every speaker the moment ANYONE left a
      // seat. Updating currentRoom.seats in place and passing the real,
      // still-intact currentRoom (with onlineUsers) fixes this: the
      // desired peer set is now always computed from the true online/seat
      // state, so audience members keep hearing seated speakers straight
      // through a seat leave/take/move.
      currentRoom.seats = seatsFromMap();
      renderSeats(currentRoom.seats);
      if (voiceMode !== "sfu" && voiceMode !== "agora") reconcileMeshVoice(currentRoom);
    }
  });

  // Real-time voice activity from other participants — drives the speaking
  // ring/waveform on the correct seat, independent of who's just "seated".
  socket.on("voice-activity", (data) => {
    if (!data || !data.userId) return;
    const isSpeaking = !!data.speaking;
    if (isSpeaking) { speakingUsers.add(data.userId); if (!voiceLevels.has(String(data.userId))) voiceLevels.set(String(data.userId), 0.72); }
    else { speakingUsers.delete(data.userId); voiceLevels.set(String(data.userId), 0); }
    // Do not rebuild the entire seat grid for every audio-level event.
    // Re-rendering replaced the avatar/frame DOM while someone was talking,
    // which made custom frames visibly jump/flicker. Update only the existing
    // seat's speaking class; layout and frame geometry stay untouched.
    const targetUserId = String(data.userId);
    const seatEl = Array.from(document.querySelectorAll("#view-room .seat[data-user-id]"))
      .find((el) => String(el.dataset.userId) === targetUserId);
    if (seatEl) {
      const active = speakingUsers.has(targetUserId) || musicUsers.has(targetUserId);
      seatEl.classList.toggle("speaking", active);
      seatEl.classList.toggle("is-speaking", active);
    }
  });

  // Lightweight live intensity relay. This only drives the decorative voice
  // effect; the authoritative speaking state remains the existing event above.
  socket.on("voice-level", (data) => {
    if (!data || !data.userId) return;
    const level = Math.max(0, Math.min(1, Number(data.level) || 0));
    voiceLevels.set(String(data.userId), level);
    updateSeatVoiceEffects();
  });

  socket.on("room-relationship-update", (data) => {
    if (!currentRoomId || !data || data.roomId !== currentRoomId) return;
    currentRelationshipLinks = Array.isArray(data.links) ? data.links : [];
    if (currentRoom) currentRoom.relationshipLinks = currentRelationshipLinks;
    renderRelationshipLinks(currentRelationshipLinks);
  });

  // Admin Panel (2026-08-11): CP/Friendship size/opacity/animation/position
  // + custom asset changes push here live — no page refresh needed (TEST 9).
  socket.on("relationship-config-update", (config) => {
    applyRelationshipVisualConfig(config);
  });

  socket.on("relationship-update", (data) => {
    if (!data) return;
    if (sheetTargetUserId && data.relationship) {
      const a = data.relationship.userA, b = data.relationship.userB;
      if ((a === me.userId && b === sheetTargetUserId) || (b === me.userId && a === sheetTargetUserId)) {
        loadSheetRelationshipStatus(sheetTargetUserId);
      }
    }
    if (otherProfileUser && data.relationship) {
      const a = data.relationship.userA, b = data.relationship.userB;
      if ((a === me.userId && b === otherProfileUser.userId) || (b === me.userId && a === otherProfileUser.userId)) {
        loadOtherRelationshipStatus(otherProfileUser.userId);
      }
    }
    if (data.request && data.request.status === "accepted") {
      toast("💞 Relationship accepted");
      if (typeof loadCpCenterRelationship === "function") loadCpCenterRelationship().catch(() => {});
    }
  });

  socket.on("relationship-request-sent", (data) => {
    if (data && data.type) toast(`${data.type === "cp" ? "💞 CP" : "🤝 Friendship"} request sent`);
  });

  socket.on("new-message", (msg) => appendChatMsg(msg));

  // Premium room activity feed: joins use the same bottom-up chat stream
  // as messages and gifts, with avatar + animated entry treatment.
  socket.on("room-activity", (evt) => {
    try {
      if (!evt || evt.type !== "user-joined") return;
      const log = $("chat-log");
      if (!log) return;
      const div = document.createElement("div");
      div.className = "chat-msg activity-line room-join-notice";
      div.innerHTML = `
        <div class="activity-pill join-pill">
          <span class="join-avatar-wrap"><img class="join-avatar" src="${escapeHtml(evt.userPhoto || placeholderAvatar(evt.userName || "User"))}" alt=""></span>
          <span class="join-copy"><b>${escapeHtml(evt.userName || "User")}</b><span>joined the room</span></span>
          <span class="join-spark">✦</span>
        </div>`;
      log.classList.remove("empty");
      log.appendChild(div);
      while (log.children.length > MAX_VISIBLE_MESSAGES) log.removeChild(log.firstChild);
      scheduleActivityExpiry(div, Date.now(), 20000);
      requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
    } catch (e) { console.error("room-activity render failed", e); }
  });

  socket.on("gift-received", (data) => {
    if (!data || !data.gift) return;
    // HARDENING (2026-08-18, receiver sees nothing on gift send fix): each
    // step now runs independently. Previously a throw in any one step (fly
    // animation DOM math, sound playback, seat lookup) silently skipped
    // every step after it — including the receiver's own toast/notification
    // and their local diamonds bump — even though the gift itself had
    // already been credited server-side. Now every receiver-visible signal
    // (toast, chat notice, balance) is guaranteed to run regardless of
    // whether the fancier animation/sound pieces succeed.
    try { spawnGiftFly(data.gift, data.fromUserId, data.toUserId, data.fromName, data.toName); } catch (e) { console.error("gift-received: fly animation", e); }
    try { playGiftSound(data.gift, data.requestId); } catch (e) { console.error("gift-received: sound", e); }
    try { flashSeatReceive(data.toUserId); } catch (e) { console.error("gift-received: seat flash", e); }
    try { appendGiftMsg(data); } catch (e) { console.error("gift-received: chat notice", e); }
    try { toast(`🎁 ${data.fromName} sent ${data.gift.name}`); } catch (e) { console.error("gift-received: toast", e); }
    if (data.toUserId === me.userId) {
      // Restored on request (2026-08-04): server now credits the recipient
      // in Diamonds again (see send-gift on the server), so this local
      // optimistic update matches — the real wallet-update push that
      // follows corrects it either way.
      try {
        me.beans = (me.beans || 0) + (data.gift.price || 0);
        saveSession();
        fillHomeProfile();
      } catch (e) { console.error("gift-received: local balance update", e); }
    }
  });

  socket.on("gift-calculator-state", (data) => {
    if (!data || !currentRoomId || String(data.roomId) !== String(currentRoomId)) return;
    // The calculator display is room-visible to everyone. Only the server-side
    // owner/admin handlers can change ON/OFF/Reset, so ordinary users can
    // safely receive and render the same authoritative totals.
    setGiftCalculatorState(data);
  });

  // High-Value Gift / Big Win room notifications (spec 2026-08-29). The
  // server only ever emits this to sockets already joined to the
  // Socket.IO room the event happened in (§8 room scope), so no
  // client-side "am I in this room" filtering is needed here — receiving
  // the event at all already means it's for us.
  socket.on("room-event", (evt) => { try { handleRoomEvent(evt); } catch (e) { console.error("room-event: handling failed", e); } });

  socket.on("music-update", (music) => setMusicUI(music));
  socket.on("music-playlist-update", (playlist) => {
    if (currentRoom) currentRoom.musicPlaylist = Array.isArray(playlist) ? playlist : [];
    renderMusicPlaylist();
  });
  socket.on("music-activity", (data) => {
    if (!data || !data.userId) return;
    if (data.speaking) musicUsers.add(String(data.userId)); else musicUsers.delete(String(data.userId));
    const seatEl = Array.from(document.querySelectorAll("#view-room .seat[data-user-id]"))
      .find(el => String(el.dataset.userId) === String(data.userId));
    if (seatEl) {
      const active = speakingUsers.has(String(data.userId)) || musicUsers.has(String(data.userId));
      seatEl.classList.toggle("speaking", active); seatEl.classList.toggle("is-speaking", active);
    }
  });

  // ---- YouTube Room Player ----
  socket.on("yt-mode-update", (data) => {
    ytPlayerState.mode = !!data.on;
    setYtModeUI(ytPlayerState.mode);
    if (data.byName) appendChatMsg({ system: true, message: `${data.byName} ${data.on ? "has turned on" : "has turned off"} the video room mode` });
  });
  socket.on("yt-playlist-update", (playlist) => {
    ytCurrentPlaylist = playlist || [];
    renderYtPlaylist();
  });
  socket.on("yt-player-update", (state) => {
    applyYtPlayerState(state);
  });

  // Video Gift catalog changes app-wide (any admin Add/Update/Delete) —
  // refresh the cache and, if the Custom tab happens to be open, re-render
  // it immediately. No refresh needed on the user's end.
  socket.on("video-gift-catalog", (gifts) => {
    VIDEO_GIFT_CATALOG_CACHE.gifts = Array.isArray(gifts) ? gifts.filter(g => g && g.enabled !== false && g.videoUrl) : [];
    if (!$("modal-gift").classList.contains("hidden") && activeGiftTier !== "bag") renderGiftGrid();
  });

  // Gift Manager catalog changes (current Gift Box categories) — any admin
  // Add/Edit/Delete/Toggle refreshes the cache and re-renders live, same
  // pattern as the Video Gift "Custom" tab above.
  socket.on("gift-catalog", (gifts) => {
    GIFT_CATALOG_CACHE.gifts = Array.isArray(gifts) ? gifts.filter(g => giftCategory(g) && giftDiamondAmount(g) > 0) : [];
    if (!$("modal-gift").classList.contains("hidden") && activeGiftTier !== "custom") renderGiftGrid();
  });

  // Full-screen Video Gift playback — queued so simultaneous sends never
  // overlap; deducting Diamonds already happened server-side before this
  // event was broadcast, so by the time it arrives it's guaranteed valid.
  socket.on("video-gift-play", (data) => {
    try { appendGiftMsg({ ...data, gift: { ...data.gift, image: data.gift.image || data.gift.icon || data.gift.thumbnail || "" }, quantity: data.gift.quantity || 1 }); } catch (e) { console.error("video-gift: chat notice", e); }
    if (data.fromUserId === me.userId && data.gift.price) {
      const sentQty = Math.max(1, Number(data.gift.quantity || 1));
      me.diamonds = Math.max(0, (me.diamonds || 0) - (data.gift.price * sentQty));
      saveSession(); fillHomeProfile();
    }
    if (roomEffectPrefs.giftEffect) { videoGiftQueue.push(data); playNextVideoGift(); }
  });

  // Vehicle Entry System (add-on) — a room member's Active Vehicle plays a
  // full-screen entry clip the moment they join. Server already checked
  // ownership/expiry before broadcasting this, so the client just plays it.
  socket.on("vehicle-entry", (data) => {
    if (!roomEffectPrefs.entryAnimation) return;
    vehicleEntryQueue.push(data);
    playNextVehicleEntry();
  });

  // Fix (game coins vs wallet coins looked like two separate balances):
  // wallet-update only fired for gifts/chest/admin changes, while the
  // Lucky Fruit sync result only patched me.diamonds + the home
  // screen. Both now go through the same function so every place Diamonds are
  // shown (home, menu, wallet modal, gift modal, an open game) updates
  // together, in real time, from a single source of truth.
  function applyWalletUpdate(data) {
    if (typeof data.diamonds === "number") me.diamonds = data.diamonds;
    if (typeof data.diamonds === "number") me.diamonds = data.diamonds;
    if (typeof data.beans === "number") me.beans = Math.max(0, Math.floor(data.beans));
    if (typeof data.level === "number") me.level = data.level;
    if (typeof data.vipLevel === "number") me.vipLevel = data.vipLevel;

    // HARDENING (2026-08-18, live-balance-not-updating fix): the visible
    // number updates are done FIRST and each wrapped so one broken widget
    // can never silently block the rest. Previously fillHomeProfile() ran
    // first — if ANY of its side calls (svip tag refresh, agency/coin-
    // center menu checks, frame/badge rendering) ever threw, every update
    // below it (menu pill, wallet modal, gift modal) silently never ran,
    // even though `me.diamonds`/`me.diamonds` themselves were already correct
    // — which is exactly why a relogin (full re-render from scratch) always
    // showed the right balance while the live, already-open app did not.
    try { const menuDiamonds = $("menu-wallet-diamonds"), menuBeans = $("menu-wallet-beans");
      if (menuDiamonds) menuDiamonds.textContent = me.diamonds;
      if (menuBeans) menuBeans.textContent = me.beans || 0; } catch (e) { console.error("wallet-update: menu pill", e); }
    try { const walletDiamonds = $("wallet-diamonds"), walletBeans = $("wallet-beans");
      if (walletDiamonds) walletDiamonds.textContent = me.diamonds;
      if (walletBeans) walletBeans.textContent = me.beans || 0; } catch (e) { console.error("wallet-update: wallet modal", e); }
    try { const homeDiamonds = $("home-diamonds");
      if (homeDiamonds) homeDiamonds.textContent = me.diamonds; } catch (e) { console.error("wallet-update: home pill", e); }
    try { const pill = $("gift-modal-diamonds");
      if (pill && !$("modal-gift").classList.contains("hidden")) { pill.textContent = me.diamonds; renderGiftLevelCard(); } } catch (e) { console.error("wallet-update: gift modal", e); }
    try { const lvlBadge = $("profile-level-badge");
      if (lvlBadge) applyLevelBadge(lvlBadge, me.level || 1); } catch (e) { console.error("wallet-update: profile level badge", e); }

    // Diamonds can change for any reason while a room game is open (a gift
    // sent/received, a reward, an admin adjustment) — not just from
    // playing. Push the fresh real balance straight into whichever game is
    // currently loaded so its on-screen wallet always matches the account,
    // in real time, not just at open.
    try {
      const tvScreen = $("room-tv-screen"), tvFrame = $("room-tv-frame");
      if (tvScreen && tvFrame && tvScreen.classList.contains("tv-open") && tvFrame.src) {
        const gameType = "FOODWHEEL_INIT";
        try { tvFrame.contentWindow.postMessage({ type: gameType, balance: me.diamonds || 0 }, "*"); } catch (e) {}
      }
    } catch (e) { console.error("wallet-update: room tv sync", e); }

    saveSession();
    // Keep the embedded production wallet page in sync while it is already
    // open. The wallet page also performs a fresh authenticated fetch on
    // load, so this is only the live-update path.
    try {
      const walletFrame = $("wallet-ui-frame");
      if (walletFrame && walletFrame.contentWindow) {
        walletFrame.contentWindow.postMessage({
          type: "PINGPONG_WALLET_UPDATE",
          diamonds: me.diamonds,
          beans: me.beans
        }, window.location.origin);
      }
    } catch (e) { console.error("wallet-update: wallet iframe", e); }
    try { fillHomeProfile(); } catch (e) { console.error("wallet-update: fillHomeProfile", e); }
  }

  socket.on("wallet-update", applyWalletUpdate);

  // Merchant/Seller inventory is intentionally separate from the normal user
  // Diamond wallet. Update an open Seller Center immediately when its parent
  // Merchant transfers inventory, without requiring logout/relogin.
  socket.on("merchant-center-balance-update", (data) => {
    try {
      if (!me || !data) return;
      const seller = data.seller;
      if (data.role === "seller" && seller && String(seller.userId) === String(me.userId)) {
        checkMerchantCenterMenu();
        const hero = document.querySelector(".mc-hero-copy h1");
        if (hero) hero.textContent = `${Number(seller.balanceDiamonds || 0).toLocaleString()} 💎`;
        const card = document.querySelector(`.mc-seller-card[data-seller-user="${CSS.escape(String(me.userId))}"] .mc-seller-balance`);
        if (card) card.textContent = `${Number(seller.balanceDiamonds || 0).toLocaleString()} 💎`;
        if (!$('view-merchant-center')?.classList.contains('hidden')) openMerchantCenter();
      } else if (data.role === "merchant" && data.merchant && String(data.merchant.userId) === String(me.userId)) {
        if (!$('view-merchant-center')?.classList.contains('hidden')) openMerchantCenter();
      }
    } catch (e) { console.error("merchant-center-balance-update", e); }
  });
  // SVIP level/resource changes (level up, membership expiry, Admin
  // re-uploading a tag PNG) — refresh the tag + badge live, no refresh
  // needed, exactly like the VIP logo already behaves.
  socket.on("svip_level_changed", (data) => {
    if (!me || data.userId !== me.userId) return;
    me.svipLevel = Number(data.toLevel || 0);
    refreshMySvipTag();
    if (me.svipLevel >= 1 && currentRoomId) {
      try { showPremiumRoomEntryEffect(me.svipLevel, "levelup"); } catch (e) { console.warn("SVIP level-up effect failed", e); }
    }
  });
  socket.on("svip_resource_update", (data) => {
    if (!me || data.userId !== me.userId) return;
    const resources = data.resources || {};
    me.svipLevel = Number(data.level || 0);
    applySvipTag($("home-svip-tag"), resources);
    applySvipTag($("profile-svip-tag"), resources);
    if (resources.frame) {
      me.activeFrame = {
        frameId: `svip-${me.svipLevel}-premium`,
        name: `SVIP${me.svipLevel} Premium Frame`,
        imageUrl: resources.frame,
        expiresAt: data.expireAt || null,
        system: true,
        svip: true
      };
    } else if (data.level === 0 || data.expireAt == null) {
      me.activeFrame = null;
    }
    saveSession();
    try { fillHomeProfile(); } catch (_) {}
    try { if (currentRoom) renderSeats(seatsFromMap()); } catch (_) {}
  });

  // ---- Fruit Wheel: server-authoritative round/result/winner packets. Keep
  // the latest packet (module-scope vars declared above) so an iframe
  // load/reload race cannot lose a real result. ----
  socket.on("fruitwheel-round", (data) => {
    if (data && (!data.roomId || !currentRoomId || data.roomId === currentRoomId)) {
      fruitWheelLiveState = { ...data };
      if (data.phase === "betting") {
        fruitWheelLiveWinners = null;
        fruitWheelLiveMyResult = null;
      }
    }
    const frame = $("room-tv-frame");
    if (roomTvActiveGame === "foodwheel" && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_ROUND", ...data }, "*");
    }
  });
  socket.on("fruitwheel-winners", (data) => {
    // Ignore late packets from a previous round/room. They must never replace
    // the current round's winner list or repaint old win badges.
    const sameRoom = data && (!data.roomId || !currentRoomId || data.roomId === currentRoomId);
    const sameRound = data && fruitWheelLiveState && Number(data.roundId) === Number(fruitWheelLiveState.roundId);
    if (!sameRoom || !sameRound) return;
    fruitWheelLiveWinners = { ...data, winners: Array.isArray(data.winners) ? data.winners.slice(0, 3) : [] };
    const frame = $("room-tv-frame");
    if (roomTvActiveGame === "foodwheel" && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_WINNERS", ...data }, "*");
    }
  });
  // Real per-user outcome (win or lose) for the round that just resolved —
  // targeted just at this socket, only ever sent by the server after it has
  // actually settled the payout. Replaces any client-side guess at "did I
  // win / how much".
  socket.on("fruitwheel-result", (data) => {
    // A result is valid only for the current round. Late/replayed result
    // packets from a previous round must not show a stale payout.
    if (!data || !fruitWheelLiveState || Number(data.roundId) !== Number(fruitWheelLiveState.roundId)) return;
    fruitWheelLiveMyResult = { ...data };
    const frame = $("room-tv-frame");
    if (roomTvActiveGame === "foodwheel" && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_MY_RESULT", ...data }, "*");
      // The server has just finished this user's settlement. Refresh the
      // durable round ledger so Game Records shows the exact round, foods,
      // amounts, win/loss and balance transition from the real server.
      sendFruitWheelHistoryToGame();
    }
  });
  // STABILIZATION (Full Lucky Fruit audit, 2026-08-06): the server used to
  // silently drop a bad/late bet with no reply at all, so a tap that failed
  // server-side still looked "placed" in the UI until the next wallet-update
  // quietly proved otherwise. Both outcomes are now explicit and forwarded
  // to the game so it can confirm or roll back its own optimistic UI state
  // instead of guessing.
  socket.on("fruitwheel-bet-ack", (data) => {
    const frame = $("room-tv-frame");
    if (roomTvActiveGame === "foodwheel" && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_BET_ACK", ...data }, "*");
    }
  });
  socket.on("fruitwheel-bet-rejected", (data) => {
    const frame = $("room-tv-frame");
    if (roomTvActiveGame === "foodwheel" && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_BET_REJECTED", ...data }, "*");
    }
  });
  // Real, persistent Jackpot Ranking — cumulative real winnings per user,
  // pushed whenever it changes (a real payout just happened) and also
  // requested fresh on join so the modal isn't empty until the next round.
  socket.on("fruitwheel-leaderboard", (data) => {
    const frame = $("room-tv-frame");
    if (roomTvActiveGame === "foodwheel" && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_LEADERBOARD", ...data }, "*");
    }
  });
  socket.on("fruitwheel-live-bet-leaderboard", (data) => {
    const frame = $("room-tv-frame");
    if (roomTvActiveGame === "foodwheel" && frame && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_LIVE_BET_LEADERBOARD", ...data }, "*");
    }
  });

  socket.on("god_power_granted", (data) => {
    if (me) { me.is_immune = true; me.can_manage_all = true; me.is_invisible = true; me.invisibleActive = false; saveSession(); }
    showGodPowerPopup(data.message || "You are now an Official God Power Holder", "grant");
    refreshGodPowerInvisibleRow();
  });
  socket.on("account-banned", (data) => {
    toast(data?.message || "Your account has been banned");
    setTimeout(() => { clearSession("account-banned"); try { socket.disconnect(); } catch (_) {} showView("view-login"); }, 250);
  });
  socket.on("god_power_revoked", (data) => {
    if (me) { me.is_immune = false; me.can_manage_all = false; me.is_invisible = false; me.invisibleActive = false; saveSession(); }
    showGodPowerPopup(data.message || "Your God Power has been removed", "revoke");
    refreshGodPowerInvisibleRow();
  });
  socket.on("invisible-state", (data) => {
    if (me) { me.invisibleActive = !!data.active; saveSession(); }
    refreshGodPowerInvisibleRow();
    toast(data.active ? "You are now Invisible 👻" : "You are now visible to everyone");
  });

  socket.on("room-left", (data) => {
    if (!data || !data.roomId) return;
    // A server-side room switch also emits room-left for the OLD room. When a
    // newer join is already in flight, that event is an internal switch ACK,
    // not a request to navigate Home. Ignore it and wait for the NEW room's
    // authoritative room-joined/room-state ACK.
    if (joinInProgress && currentRoomId && data.roomId !== currentRoomId && !pendingLeaveRoomId) return;
    // Ignore a late ACK from an older room after a newer leave/join operation
    // has already become authoritative. Only the room currently being left
    // can finish the leave lifecycle.
    if (pendingLeaveRoomId && data.roomId !== pendingLeaveRoomId) return;
    if (currentRoomId === data.roomId || joinedRoomId === data.roomId || pendingLeaveRoomId === data.roomId) {
      if (leaveSafetyTimer) { clearTimeout(leaveSafetyTimer); leaveSafetyTimer = null; }
      pendingLeaveRoomId = null;
      leaveInProgress = false;
      currentRoomId = null; currentRoom = null; joinedRoomId = null; roomJoinAckId = null; joinInProgress = false; pendingJoinRequest = null;
      saveActiveRoom(null);
      teardownVoice();
      stopRoomMusic();
      closeRoomGame();
      teardownYtPlayer();
      notifyAndroidVoiceSession(false);
      roomKept = false;
      updateKeptRoomPill();
      showView("view-home");
      loadRoomList();
    }
  });

  socket.on("room-error", (data) => {
    // ROOT-CAUSE FIX (2026-08-14): "room-error" means the "join-room" we
    // sent did NOT complete — without clearing joinInProgress here it would
    // stay stuck true forever (no "room-state" ack is ever coming for a
    // rejected join), permanently blocking every future join attempt.
    joinInProgress = false;
    roomEntryEffectPending = false;
    if (pendingJoinRequest) {
      const next = pendingJoinRequest;
      pendingJoinRequest = null;
      joinRoom(next.roomId, next.password);
      return;
    }
    toast(data.message || "A problem occurred in the room");
    if (data.needPassword) {
      // Wrong/missing password on a locked room — ask again instead of
      // bouncing the user back to the room list.
      promptRoomPassword(data.roomId || currentRoomId);
      return;
    }
    // The room we tried to (re)join is gone/locked — don't keep retrying it
    // on every future refresh/reconnect.
    if (currentRoomId && (!currentRoom || currentRoom.roomId !== currentRoomId)) {
      stopRoomMusic();
      currentRoomId = null; currentRoom = null;
      joinedRoomId = null; // join-lifecycle guard (2026-08-14 fix) — not joined to anything anymore
      saveActiveRoom(null);
      roomKept = false;
      updateKeptRoomPill();
      showView("view-home"); loadRoomList();
    }
  });

  socket.on("announcement", (entry) => {
    const banner = $("announce-banner");
    banner.textContent = "📢 " + entry.text;
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 6000);
    toast("📢 " + entry.text);
  });

  socket.on("seat-lock-update", (data) => {
    if (!currentRoom) return;
    currentRoom.lockedSeats = currentRoom.lockedSeats || [];
    if (data.locked) {
      if (!currentRoom.lockedSeats.includes(data.seatNumber)) currentRoom.lockedSeats.push(data.seatNumber);
    } else {
      currentRoom.lockedSeats = currentRoom.lockedSeats.filter(n => n !== data.seatNumber);
    }
    renderSeats(seatsFromMap());
  });

  socket.on("room-background-update", (data) => {
    applyRoomBackground(data.url || "");
    if (currentRoom) currentRoom.background = data.url || "";
  });

  socket.on("room-logo-update", (data) => {
    const nextLogo = data.url || DEFAULT_ROOM_LOGO_URL;
    setRoomLogo(nextLogo);
    if (currentRoom) currentRoom.logo = nextLogo;
    const preview = $("mod-logo-preview"); if (preview) preview.src = nextLogo;
    roomProfileLogo(nextLogo);
  });

  socket.on("chat-cleared", (data) => {
    $("chat-log").innerHTML = "";
    appendChatMsg({ system: true, message: `${data.by} cleared the chat` });
  });

  socket.on("kicked", (data) => {
    console.log("[SOCKET] kicked event received:", data);
    toast(data.message || "You have been removed from the room");
    teardownVoice();
    stopRoomMusic();
    closeRoomGame();
    teardownYtPlayer();
    currentRoomId = null; currentRoom = null;
    joinedRoomId = null; joinInProgress = false; pendingJoinRequest = null; // join-lifecycle guard (2026-08-14 fix)
    saveActiveRoom(null);
    if (data.forceLogout) {
      // Account-level action (ban/delete) — the session itself is no
      // longer valid, not just the current room, so fully log out rather
      // than leaving the person on the home screen still "signed in" as
      // an account that can no longer act.
      console.log("[SOCKET] kicked with forceLogout -> clearing session");
      clearSession("kicked-forceLogout");
      if (socket) { socket.disconnect(); socket = null; }
      showView("view-login");
      return;
    }
    showView("view-home"); loadRoomList();
  });

  // SECURITY HARDENING (Module 5.1): server rejected our identify claim —
  // this only fires if we sent an authToken that's invalid/expired/doesn't
  // match the claimed userId, so the session itself is no longer trustworthy.
  // Same handling as "kicked" with forceLogout.
  socket.on("identify-rejected", async (data) => {
    console.log("[SOCKET] identify-rejected:", data);
    // ROOT-CAUSE FIX (2026-09-26, "Expired" session bug — socket path):
    // don't treat a rejected identify as automatically fatal. It's
    // frequently just a stale access token sent right after a reconnect
    // (see the proactive check in the "connect" handler above) — the
    // refresh token behind it is very likely still valid for up to 30
    // days. Try exactly one refresh-and-re-identify cycle, the same as
    // api()'s reactive retry, before giving up and logging out.
    if (productionRefreshToken && await tryRefreshProductionSession()) {
      if (socket && me && me.userId) socket.emit("identify", { userId: me.userId, authToken });
      return;
    }
    clearSession("identify-rejected");
    if (socket) { socket.disconnect(); socket = null; }
    showView("view-login");
    toast(data.message || "Session expired — please log in again");
  });

  socket.on("chest-opened", (data) => {
    // The server is the only wallet source of truth. It already credits the
    // ranked user and sends wallet-update/frame-inventory-updated privately.
    // This event is presentation-only: show the same opening countdown and
    // reveal the Top 1/2/3 rewards to everyone in the room.
    playChestOpenAnimation(data);
  });

  socket.on("chest-details", (data) => {
    renderChestDetails(data);
  });

  socket.on("private-thread-cleared", (payload) => {
  if (threadPeerId && String(payload?.otherUserId || "") === String(threadPeerId)) {
    renderedThreadMsgIds.clear();
    const log = $("thread-log");
    if (log) log.innerHTML = "";
  }
  loadPrivateUnread();
});
socket.on("new-private-message", (msg) => {
    const peerId = msg && msg.from === me?.userId ? msg.to : msg?.from;
    if (threadPeerId && (msg.from === threadPeerId || msg.to === threadPeerId)) {
      appendThreadMsg(msg);
      if (msg.from !== me?.userId) markThreadRead(threadPeerId);
    } else {
      bumpPrivateUnread(peerId);
      const notice = msg.type === "system_notification" ? `🔔 ${msg.message}` : msg.type === "agency_invite" ? "🏢 New Agency Invitation received" : msg.type === "relationship_request" ? (msg.data && msg.data.relationshipType === "cp" ? "💞 New CP request" : "🤝 New Friendship request") : "New message received";
      if (roomPrivateOpen && currentRoomId) {
        if (roomPrivateActivePeerId && String(peerId) === String(roomPrivateActivePeerId)) {
          roomPrivateAppendMessage(msg);
          if (msg.from !== me?.userId) markThreadRead(roomPrivateActivePeerId);
        } else {
          roomPrivateRefreshList();
        }
      } else {
        toast(notice);
      }
    }
  });

  // ---- Phase 3: Agency & Host System live updates ----
  socket.on("agency-status-update", (data) => {
    if (data && data.agencyId) {
      me.agencyId = data.agencyId;
      saveSession();
      checkAgencyMenu();
      toast("🏢 Your Agency is now active!");
    }
  });
  socket.on("host-status-update", (data) => {
    // Fired the moment an Agency invite is accepted — updates the menu
    // immediately without needing a full page reload.
    me.isHost = true;
    if (data.agencyId) me.agencyId = data.agencyId;
    saveSession();
    checkHostCenterMenu();
    checkAgencyMenu();
    toast("🎉 You are now an Agency Host!");
  });
  socket.on("host-stats-update", handleHostStatsUpdate);
  socket.on("host-gift-received", handleHostGiftReceived);
  socket.on("agency-invite-updated", () => { if (currentAgencyId) renderAgencyDashboard(); });
  socket.on("agency-host-list-update", () => { if (currentAgencyId) renderAgencyDashboard(); });
  socket.on("agency-stats-update", (data) => {
    if (currentAgencyId && data.agencyId === currentAgencyId && $("view-agency").classList.contains("active")) {
      renderAgencyDashboard();
    }
  });

  // Admin assigned a frame to THIS account only — private receipt notice.
  // Does not equip it; open My Frames to select and use it.
  socket.on("frame-inventory-updated", () => {
    toast("🖼️ You received a new profile frame.");
  });

  // This account's active frame changed (equipped/removed via My Frames,
  // possibly from another device) — sync silently, no "received" toast.
  socket.on("frame-active-updated", (frame) => {
    me.activeFrame = frame;
    saveSession();
    updateProfileFrameCountdown();
    fillHomeProfile();
    if (currentRoom) renderSeats(seatsFromMap());
  });
  socket.on("profile_frame_update", (data) => {
    if (!data || !me || String(data.userId) !== String(me.userId)) return;
    me.activeFrame = data.frame || null;
    saveSession();
    updateProfileFrameCountdown();
    fillHomeProfile();
    if (currentRoom) renderSeats(seatsFromMap());
  });

  // Admin assigned (or removed) a coloured tag while we're online.
  socket.on("tag-updated", (tag) => {
    me.customTag = tag;
    saveSession();
    fillHomeProfile();
      applyCustomTag($("profile-tag-badge"), me.customTag);
    renderAgencyBadge($("profile-agency-badge"), me.agencyBadge);
    toast(tag ? `🏷️ You got the "${tag.text}" tag!` : "Tag removed");
  });

  // Admin assigned (or removed) the dedicated Active Agency badge.
  socket.on("agency-badge-updated", (badge) => {
    me.agencyBadge = badge || null;
    saveSession();
    fillHomeProfile();
    renderAgencyBadge($("profile-agency-badge"), me.agencyBadge);
    renderAgencyBadge($("home-agency-badge"), me.agencyBadge, true);
    toast(badge ? "🏅 Active Agency badge added." : "Active Agency badge removed");
  });

  // Admin assigned (or removed) a VIP Name Effect style while we're online.
  // Only affects the Room Seat name glow/animation (see renderSeats) — the
  // active room, if any, is already refreshed via the "room-state" push
  // that comes alongside this from the server; this just keeps `me` and a
  // friendly toast in sync.
  socket.on("name-effect-updated", (nameEffect) => {
    me.nameEffect = nameEffect;
    applyProfileNameEffect($("profile-name-display"), me);
    applyProfileNameEffect($("home-username"), me);
    saveSession();
    fillHomeProfile();
    toast(nameEffect ? "✨ Your profile name color was updated." : "Profile name color removed");
  });

  socket.on("room-profile-style-update", (data) => {
    if (!data || !data.userId) return;
    Object.values(seatMap).forEach((seat) => {
      if (!seat || seat.userId !== data.userId) return;
      seat.customTag = data.customTag || null;
      seat.nameEffect = data.nameEffect || null;
      seat.activeFrame = data.activeFrame || null;
      seat.vipLevel = data.vipLevel || 0;
      seat.svipLevel = data.svipLevel || 0;
      seat.activeBadges = Array.isArray(data.activeBadges) ? data.activeBadges : [];
    });
    if (currentRoom) renderSeats(seatsFromMap());
  });

  // Admin set (or cleared) our Custom ID Number while we're online.
  socket.on("custom-id-updated", (data) => {
    me.customId = data.customId;
    saveSession();
    applyIdDisplay($("profile-userid"), me);
  const genderBadge = $("pp-gender-badge");
  if (genderBadge) {
    genderBadge.textContent = me.gender === "Female" ? "♀" : me.gender === "Male" ? "♂" : "⚧";
    genderBadge.style.background = me.gender === "Female" ? "#ff8ab5" : me.gender === "Male" ? "#5AA9FF" : "#b48cff";
  }
  const countryBadge = $("pp-country-badge");
  applyCountryFlag(countryBadge, me);
    toast(me.customId ? `✨ Your Custom ID: ${me.customId}` : "Custom ID removed");
  });

  // Admin sent (or removed) a premium badge (Blue Diamond V etc. — see
  // badges.js). If it's about us, keep `me` in sync so it shows on our own
  // seat/profile immediately. If we currently have that user's profile
  // open (view-other-profile), refresh the badge there too — Room Seat
  // itself already refreshes on its own via the "room-state" push that
  // comes alongside this from the server (see badges.js's notifyUser()).
  socket.on("user_badges_update", (data) => {
    if (!data || !data.userId) return;
    if (data.userId === me.userId) {
      me.activeBadges = data.activeBadges || data.badges || [];
      saveSession();
      toast((data.activeBadges || data.badges || []).includes("blue_diamond_v") ? "💎 You received a new Badge!" : "A badge was removed");
      applySellerOfficialTags($("profile-seller-tag"), $("profile-official-tag"), me.activeBadges, $("profile-agency-tag"));
      applyMerchantTag($("profile-merchant-tag"), me.activeBadges);
      applySellerOfficialTags($("sheet-seller-tag"), $("sheet-official-tag"), me.activeBadges, $("sheet-agency-tag"));
      applyMerchantTag($("sheet-merchant-tag"), me.activeBadges);
    }
    if (otherProfileUser && otherProfileUser.userId === data.userId) {
      otherProfileUser.activeBadges = data.activeBadges || data.badges || [];
      applyBlueBadge($("other-blue-badge"), otherProfileUser.activeBadges);
      applySellerOfficialTags($("other-seller-tag"), $("other-official-tag"), otherProfileUser.activeBadges, $("other-agency-tag"));
      applyMerchantTag($("other-merchant-tag"), otherProfileUser.activeBadges);
    }
  });

  // Admin changed a badge's Room Seat / Profile size from the panel
  // (badges.js /api/admin/badges/size) — broadcast to everyone since it
  // changes how the badge renders for every viewer, not just its owner.
  // Re-render whatever's currently visible so it takes effect without a
  // page refresh.
  socket.on("badge_catalog_update", (data) => {
    if (!data || !Array.isArray(data.catalog)) return;
    badgeCatalogCache = {};
    data.catalog.forEach((b) => { badgeCatalogCache[b.id] = b; });
    if (otherProfileUser) {
      applyBlueBadge($("other-blue-badge"), otherProfileUser.activeBadges);
      applySellerOfficialTags($("other-seller-tag"), $("other-official-tag"), otherProfileUser.activeBadges, $("other-agency-tag"));
      applyMerchantTag($("other-merchant-tag"), otherProfileUser.activeBadges);
    }
    applySellerOfficialTags($("profile-seller-tag"), $("profile-official-tag"), me && me.activeBadges, $("profile-agency-tag"));
    applyMerchantTag($("profile-merchant-tag"), me && me.activeBadges);
    if (currentRoom) renderSeats(seatsFromMap());
  });

  socket.on("voice-offer", async (data) => {
    if (!data?.from || !data?.offer || data.from === socket.id) return;
    const pc = getOrCreatePeer(data.from);
    const offerCollision = pc.makingOffer || pc.signalingState !== "stable";
    if (offerCollision && !pc.polite) return;
    try {
      if (localStream && mySeatNumber !== null && mySeatNumber !== undefined) {
        const audioSender = pc._ppVoiceAudioTransceiver?.sender || pc.getSenders().find(s => s._ppVoiceAudioSender || (s.track && s.track.kind === "audio"));
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioSender && audioTrack && audioSender.track !== audioTrack) await audioSender.replaceTrack(audioTrack);
      }
      if (offerCollision) {
        await pc.setLocalDescription({ type: "rollback" });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      // Candidates can arrive before the offer because Socket.IO and ICE are
      // separate asynchronous flows. Queue them until a remote description
      // exists, then flush in order instead of silently dropping them.
      if (pc._pendingRemoteCandidates?.length) {
        const queued = pc._pendingRemoteCandidates.splice(0);
        for (const candidate of queued) {
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(applyOpusFEC(answer));
      socket.emit("voice-answer", { target: data.from, targetUserId: userIdForSocketId(data.from), answer: pc.localDescription });
    } catch (e) {
      console.warn("[voice] offer handling failed:", data.from, e && e.message);
    }
  });

  socket.on("voice-answer", async (data) => {
    const pc = peerConnections[data.from];
    if (pc && pc.signalingState === "have-local-offer") {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        if (pc._pendingRemoteCandidates?.length) {
          const queued = pc._pendingRemoteCandidates.splice(0);
          for (const candidate of queued) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn("[voice] answer handling failed:", data.from, e && e.message);
      }
    }
  });

  socket.on("voice-candidate", async (data) => {
    if (!data?.from || !data?.candidate) return;
    const pc = peerConnections[data.from] || getOrCreatePeer(data.from);
    if (pc.remoteDescription) {
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) { console.debug("[voice] ICE candidate rejected:", e && e.message); }
    } else if (pc._pendingRemoteCandidates) {
      // Bound the queue so a malicious/stale signaling burst cannot grow
      // memory without limit. Normal mobile joins use only a handful.
      if (pc._pendingRemoteCandidates.length < 64) pc._pendingRemoteCandidates.push(data.candidate);
    }
  });

  // Phase 1 / Tier A (server-side complement, see voice-reconnect.js): the
  // server tells the room when a seated peer enters/leaves its reconnect
  // grace period. This doesn't replace the existing ICE-restart/rebuild
  // logic in getOrCreatePeer() — it just gives it context: hold off on
  // tearing a peer connection down while `reconnectingPeerUserIds` has
  // them, and actively re-offer the instant they're confirmed back rather
  // than waiting on our own ICE timers to notice.
  socket.on("voice-peer-reconnecting", ({ userId }) => {
    if (userId) reconnectingPeerUserIds.add(userId);
  });
  socket.on("voice-peer-resumed", ({ userId }) => {
    if (!userId) return;
    reconnectingPeerUserIds.delete(String(userId));
    const entry = Object.values(seatMap).find((s) => s && String(s.userId) === String(userId));
    // A resumed user normally has a NEW Socket.IO id. The old WebRTC peer is
    // permanently bound to the old signaling identity, so keeping it around
    // creates a dead/duplicate media path. Remove only that user's stale peer
    // first, then create exactly one fresh path to the new socket.
    Object.keys(peerConnections).forEach((sid) => {
      if (userIdForSocketId(sid) && String(userIdForSocketId(sid)) === String(userId) && (!entry || sid !== entry.socketId)) {
        closePeer(sid);
      }
    });
    // Audience listeners must also recover when a speaker's socket changes.
    // This is intentionally NOT gated by mySeatNumber: listeners need the
    // same recovery path as seated speakers.
    if (entry && entry.socketId && entry.socketId !== socket.id) {
      connectToPeer(entry.socketId, true);
    }
  });

  // Fix (fatal crash on every page load): these four handlers used to sit
  // at the top level of the script, far below this function, calling
  // socket.on(...) while the module-level `socket` variable was still null
  // (this function — the only place that assigns it — hadn't run yet). That
  // threw an uncaught TypeError on every single page load, which silently
  // aborted the rest of the script's top-to-bottom execution, including the
  // bootstrap() call at the very end of the file. Login still worked
  // because its button listener happened to be registered earlier in the
  // file, before the crash point — but refresh never ran bootstrap() at
  // all, so no session/room restore ever happened; the socket from before
  // the refresh was just gone, and after 8s the grace period expired and
  // the seat got freed. Moved here, alongside every other socket.on(...)
  // call, where `socket` is guaranteed to actually exist.
  socket.on("seat-invite", ({ seatNumber, fromName }) => {
    if (!currentRoomId) return;
    if (confirm(`${fromName} invited you to seat ${seatNumber}. Join?`)) {
      socket.emit("take-seat", { roomId: currentRoomId, seatNumber });
    }
  });
  socket.on("mod-mute-update", ({ targetUserIds, mutedUntil }) => {
    if (!targetUserIds.includes(me.userId)) return;
    hostMutedUntil = mutedUntil || 0;
    if (hostMutedUntil) {
      micEnabled = false;
      if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
      updateMicButtonUi();
      $("btn-mic-toggle").disabled = true;
      toast("The Host has muted your mic");
    } else {
      $("btn-mic-toggle").disabled = false;
      toast("Your mic has been unmuted");
    }
  });
  socket.on("mod-announcement", ({ fromName, message }) => {
    toast(`${fromName}: ${message}`);
  });
  socket.on("theme-library-update", (themes) => { themeLibraryCache = themes; renderThemeLibraryGrid(); });
  // Fix (Room Lock save had no explicit confirmation, 2026-07-29): the
  // server has emitted "room-lock-saved" right after persisting a lock/
  // unlock since Phase 11, but no client handler ever listened for it —
  // the UI only updated indirectly via the room-wide "room-state" broadcast
  // a moment later, with no direct feedback to the person who just tapped
  // Save. That's not what caused settings to fail to persist, but it is
  // exactly why a successful save could still read as "did that even do
  // anything?" from the owner's side. Now it gives an explicit toast.
  socket.on("room-lock-saved", ({ locked }) => {
    toast(locked ? "Room Lock enabled 🔒" : "Room Lock disabled");
  });

  // ROOT-CAUSE FIX (2026-08-01, session-restore / settings-icon dead —
  // the real cause, not the earlier partial fixes): these two listeners
  // used to sit at the very bottom of this file as bare top-level
  // statements — `socket.on("level-info-data", ...)` and
  // `socket.on("id-level-up", ...)` — instead of inside connectSocket()
  // like every other socket.on(...) call in this file. `socket` is
  // `null` until connectSocket() actually runs, so on every single page
  // load the browser hit `socket.on(...)` on a null value while
  // executing the script top-to-bottom, threw a TypeError right there,
  // and — because this is a plain synchronous <script> tag, not
  // something wrapped in try/catch — every line AFTER that point in the
  // file simply never ran. That included the Settings-gear click-handler
  // registration (btn-room-mod, further down) and the bootstrap() call
  // at the very end of the file. So: the Settings icon looked dead
  // because its click listener was never attached, and refresh always
  // showed the login screen because bootstrap()/loadSession()/session-
  // restore never even ran — not because the token or session logic
  // itself was wrong. All the earlier defensive fixes (retry logic,
  // try/catch, Logout Lock, etc.) were real improvements but could never
  // fix this, because the crash happened before any of that code was
  // reachable on page load. Moving these two listeners inside
  // connectSocket() — where they're re-registered on every (re)connect,
  // exactly like the other handlers above — removes the null-socket
  // crash entirely.
  socket.on("level-info-data", (info) => {
    levelInfoCache = info;
    if (!$("modal-level-info").classList.contains("hidden")) renderLevelInfo();
  });
  socket.on("id-level-up", (info) => {
    levelInfoCache = info;
    if (!$("modal-level-info").classList.contains("hidden")) renderLevelInfo();
    toast(`🎉 Level Up! You're now Level ${info.currentLevel}`);
    const badge = $("level-info-badge");
    badge.classList.remove("level-up-pulse");
    void badge.offsetWidth; // restart the animation even if it's already mid-play
    badge.classList.add("level-up-pulse");
  });
  // UPGRADE (2026-08-04, Level Management) — GLOBAL THEME UPDATE: when an
  // admin saves a new theme for a level group, every online user currently
  // in that group sees it live, no reload. Registered here inside
  // connectSocket() (not as a bare top-level statement) for the exact same
  // reason as the two listeners above — see the ROOT-CAUSE FIX comment.
  socket.on("level-theme-update", (data) => {
    if (levelInfoCache && levelInfoCache.groupIndex === data.groupIndex) {
      levelInfoCache.theme = data.theme;
      if (!$("modal-level-info").classList.contains("hidden")) renderLevelInfo();
    }
  });
}

function rejoinRoom() {
  if (!currentRoomId) return;
  // ROOT-CAUSE FIX (2026-08-14, reconnect/duplicate join-room audit): a
  // real Socket.IO reconnect always gets a brand-new socket.id server-side
  // (server-side room/seat/presence state is keyed off the connection, not
  // the browser tab), so any previous joinedRoomId ack was for a socket
  // that no longer exists and must never be treated as "still joined" —
  // always rejoin here. Still guarded by joinInProgress so two "connect"
  // events firing close together (observed in the rapid-reconnect logs)
  // cannot fire two overlapping "join-room" emits for the same socket.
  joinedRoomId = null;
  if (joinInProgress) {
    pendingJoinRequest = { roomId: currentRoomId, password: undefined };
    return;
  }
  joinInProgress = true;
  roomEntryEffectPending = true;
  pendingJoinRequest = null;
  $("chat-log").innerHTML = "";
  setRoomLogo(null);
  applyRoomBackground("");
  socket.emit("join-room", { roomId: currentRoomId, userId: me.userId, userName: me.name, userPhoto: me.photo || "" });
  loadGiftBanner(currentRoomId);
  showView("view-room");
  notifyAndroidVoiceSession(true); // PHASE 3 item #4 fix
}

// ===========================================================================
// HOME / ROOM LIST
// ===========================================================================
function fillHomeProfile() {
  // Home no longer renders the old profile/name/VIP strip. Keep this updater
  // backward-compatible with other screens by guarding optional Home nodes.
  const diamondsElement = $("home-diamonds");
  const diamonds = $("home-diamonds");
  if (diamondsElement) diamondsElement.textContent = me.diamonds;
  if (diamonds) diamonds.textContent = me.diamonds;
  try { refreshGodPowerInvisibleRow(); } catch (e) { console.error("fillHomeProfile: godpower row", e); }
  try { const el = $("home-avatar"); if (el) el.src = me.photo || placeholderAvatar(me.name); } catch (e) { console.error("fillHomeProfile: avatar", e); }
  try { const el = $("home-username"); if (el) { el.textContent = me.name; applyProfileNameEffect(el, me); } } catch (e) { console.error("fillHomeProfile: username", e); }
  try { const el = $("home-vip-badge"); if (el) applyVipBadge(el, me.vipLevel); } catch (e) { console.error("fillHomeProfile: vip badge", e); }
  try { const el = $("home-tag-badge"); if (el) applyCustomTag(el, me.customTag); const ab = $("home-agency-badge"); if (ab) renderAgencyBadge(ab, me.agencyBadge, true); } catch (e) { console.error("fillHomeProfile: custom tag", e); }
  try { const el = $("home-avatar-frame"); if (el) applyFrameRing(el, me.vipLevel); } catch (e) { console.error("fillHomeProfile: frame ring", e); }
  try { const el = $("home-avatar-frame"); if (el) applyCustomFrame(el, me.activeFrame); } catch (e) { console.error("fillHomeProfile: custom frame", e); }
  try { updateProfileFrameCountdown(); } catch (_) {}
  try { refreshMySvipTag(); } catch (e) { console.error("fillHomeProfile: svip tag", e); }
  try { checkAgencyMenu(); } catch (e) { console.error("fillHomeProfile: agency menu", e); }
  try { checkDiamondCenterMenu(); } catch (e) { console.error("fillHomeProfile: diamond center menu", e); }
  try { checkMerchantCenterMenu(); } catch (e) { console.error("fillHomeProfile: merchant center menu", e); }
  
  try { checkHostCenterMenu(); } catch (e) { console.error("fillHomeProfile: host center menu", e); }
}

async function loadAnnouncements() {
  const r = await api("/api/announcements");
  if (r.success && r.announcements.length) {
    const box = $("home-announcements");
    box.classList.remove("hidden");
    box.textContent = "📢 " + r.announcements[0].text;
  }
}

async function checkAgencyMenu() {
  const r = await api("/api/agency/mine/" + me.userId);
  // Agency Center is owner-only. A Host who belongs to an Agency must see
  // Host Center, not the owner's Agency management dashboard.
  const show = !!(r.success && r.agency && r.agency.isOwner);
  $("menu-agency")?.classList.toggle("hidden", !show);
}
async function checkDiamondCenterMenu() {
  const r = await api("/api/diamond-center/status");
  const show = !!(r.success && r.enabled);
  $("menu-diamond-center").classList.toggle("hidden", !show);
  const divider = document.querySelector(".menu-diamond-center-divider");
  if (divider) divider.classList.toggle("hidden", !show);
}
async function checkMerchantCenterMenu() {
  const r = await api("/api/merchant-center/me");
  const enabled = !!(r.success && r.merchant);
  const isMerchant = enabled && r.role === "merchant";
  const isSeller = enabled && r.role === "seller";
  $("menu-merchant-center")?.classList.toggle("hidden", !isMerchant);
  $("menu-seller-center")?.classList.toggle("hidden", !isSeller);
  const divider = document.querySelector(".menu-merchant-center-divider");
  if (divider) divider.classList.toggle("hidden", !(isMerchant || isSeller));
}
// Host Center menu entry shows only once this account has actually become
// an Agency Host (via admin assignment or accepting an Agency invitation) —
// agencyId is the reliable signal; isHost alone just means "owns a room".
function checkHostCenterMenu() {
  $("menu-host-center").classList.toggle("hidden", !me.agencyId);
}
function placeholderAvatar(name) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#34244C"/><text x="50" y="62" font-size="40" fill="#F0A868" text-anchor="middle" font-family="sans-serif">${initial}</text></svg>`
  );
}

// SINGLE-ROOM UI INVARIANT (2026-09-18): the server may temporarily expose
// the same owner's room from local + Redis cluster state. Never render duplicate
// cards for one host. Prefer the local canonical record, then the record with
// the highest live count. This is display-only and never deletes room data.
function dedupeRoomList(list) {
  const byHost = new Map();
  (Array.isArray(list) ? list : []).forEach((room) => {
    if (!room || !room.roomId) return;
    const key = room.hostId ? String(room.hostId) : `room:${room.roomId}`;
    const prev = byHost.get(key);
    if (!prev) { byHost.set(key, room); return; }
    const prevLocal = prev.crossInstance ? 0 : 1;
    const curLocal = room.crossInstance ? 0 : 1;
    if (curLocal > prevLocal ||
        (curLocal === prevLocal && Number(room.onlineCount || 0) > Number(prev.onlineCount || 0))) {
      byHost.set(key, room);
    }
  });
  return Array.from(byHost.values());
}

let roomListCache = [];
async function loadRoomList() {
  const r = await api("/api/room/list");
  if (r.success) {
    roomListCache = dedupeRoomList(r.rooms);
    renderRoomList(getHomeRoomsForMode());
  }
}

function renderRoomList(rooms) {
  renderHomeMyRoomCard();
  renderMyRoomPanel();
  const wrap = $("room-list");
  if (!wrap) return;
  // IMPORTANT: loadRoomList() can run repeatedly (tab switches, reconnects,
  // returning Home). Clear the previous DOM cards before rendering the
  // authoritative list; otherwise the same room is appended again on every
  // refresh and can look like 8–9 duplicate rooms even when the server has
  // only one room record.
  wrap.innerHTML = "";
  const visibleRooms = dedupeRoomList(Array.isArray(rooms) ? rooms : getHomeRoomsForMode());
  $("room-empty")?.classList.toggle("hidden", visibleRooms.length > 0);
  // Popular uses the same compact one-row room cards as Mine.
  // Only the Popular header/banner/ranking chrome changes; room-card layout stays unchanged.
  const isPopularGrid = homePrimaryTab === "popular";
  wrap.classList.toggle("popular-room-grid", isPopularGrid);
  visibleRooms.forEach((room) => {
    const card = document.createElement("div");
    if (isPopularGrid) {
      // Popular tab: 2-column tile cards (square art, level badge top-right,
      // listener count bottom-right, flag + name underneath).
      card.className = "popular-room-card";
      const lvl = Math.max(1, Number(room.hostLevel) || 1);
      card.innerHTML = `
        <div class="popular-room-art">
          ${room.logo ? `<img src="${escapeHtml(room.logo)}" alt="" draggable="false">` : `<span class="popular-room-art-ph">🎙️</span>`}
          <span class="popular-room-level"><img src="/images/level-badges/level-tier-${roomLevelTierStart(lvl)}.png" alt=""><b>${lvl}</b></span>
          <span class="popular-room-online"><i class="pr-bars"></i>${Number(room.onlineCount || 0)}</span>
        </div>
        <div class="popular-room-title">${room.countryFlag ? `<span class="room-flag">${room.countryFlag}</span>` : ""}<span class="popular-room-name">${escapeHtml(room.roomName || "Room")}</span>${room.roomLocked ? '<span class="room-card-lock" title="Locked">🔒</span>' : ""}</div>`;
    } else {
      card.className = "room-card";
      const avatarUrls = (room.onlineAvatars || []).filter(Boolean).slice(0, 4);
      const extraCount = Math.max(0, (room.onlineCount || 0) - avatarUrls.length);
      const avatarsHtml = avatarUrls.map((url) => `<img src="${escapeHtml(url)}" alt="">`).join("") +
        (extraCount > 0 ? `<span class="avatar-stack-more">+${extraCount}</span>` : "");
      const badge = room.hostBadge;
      const badgeColor = badge && badge.color ? badge.color : "#B8860B";
      const badgeHtml = badge && badge.text ? `<span class="host-badge" style="background:${escapeHtml(badgeColor)}22;color:${escapeHtml(badgeColor)}">👑 ${escapeHtml(badge.text)}</span>` : "";
      const roomId = room.roomNumber || room.roomId || "—";
      const hostId = room.hostId || "—";
      card.innerHTML = `
        <div class="room-card-icon">${room.logo ? `<img src="${escapeHtml(room.logo)}" alt="">` : "🎙️"}</div>
        <div class="room-card-body">
          <h3>${room.countryFlag ? `<span class="room-flag">${room.countryFlag}</span>` : ""}${escapeHtml(room.roomName || "Room")}${room.roomLocked ? '<span class="room-card-lock" title="Locked">🔒</span>' : ""}</h3>
          <span class="room-card-host">ID: ${escapeHtml(hostId)} · Room #${escapeHtml(roomId)}</span>
          ${badgeHtml}
          <div class="room-card-meta"><div class="avatar-stack">${avatarsHtml}</div><span class="online-pill"><span class="live-dot"></span> ${Number(room.onlineCount || 0)}</span></div>
        </div>`;
    }
    card.addEventListener("click", () => joinRoom(room.roomId));
    wrap.appendChild(card);
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

// ===========================================================================
// HOME SCREEN — PRIMARY NAV + FIXED SECONDARY TABS
// ===========================================================================
const SOCIAL_PAGE_SIZE = 20;
let socialTab = "recently";
let homePrimaryTab = "mine";
let recentRoomsCache = [], recentRoomsShown = 0;
let followingCache = [], followingShown = 0;
let myRoomCache = [];
let popularFilter = "popular";
let homeSearchOpen = false;
let homeSearchTerm = "";

function formatVisitTime(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const timeStr = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today • ${timeStr}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Yesterday • ${timeStr}`;
  return d.toLocaleDateString("en-GB") + " • " + timeStr;
}

document.querySelectorAll(".social-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchSocialTab(btn.dataset.tab));
});

document.querySelectorAll(".home-primary-tab").forEach((btn) => {
  btn.addEventListener("click", () => switchHomePrimaryTab(btn.dataset.homeTab));
});

function setHomePopularChrome(isPopular) {
  $("banner-slider-container")?.classList.toggle("hidden", !isPopular);
  $("home-popular-tools")?.classList.toggle("hidden", !isPopular);
  $("home-popular-filter")?.classList.toggle("hidden", !isPopular);
  $("social-tabs")?.classList.toggle("hidden", isPopular);
  $("home-my-room-card")?.classList.toggle("hidden", isPopular || !getMyRooms().length);
}

function getHomeRoomsForMode() {
  let rooms = [...roomListCache];
  const term = homeSearchTerm.trim().toLowerCase();
  if (term) {
    rooms = rooms.filter((r) =>
      String(r.roomName || "").toLowerCase().includes(term) ||
      String(r.hostName || "").toLowerCase().includes(term) ||
      String(r.hostId || "").toLowerCase().includes(term) ||
      String(r.roomNumber || "").toLowerCase().includes(term) ||
      String(r.roomId || "").toLowerCase().includes(term)
    );
  }
  if (homePrimaryTab === "mine") {
    const mine = rooms.filter((r) => String(r.hostId || "") === String(me.userId));
    const others = rooms.filter((r) => String(r.hostId || "") !== String(me.userId));
    return [...mine, ...others];
  }
  if (homePrimaryTab === "popular") {
    const category = (r) => String(r.category || r.roomType || r.type || r.contentType || "").toLowerCase();
    if (popularFilter === "game") rooms = rooms.filter(r => /game|teen|patti|fruit|wheel|play/.test(category(r)) || r.isGame === true);
    if (popularFilter === "video-music") rooms = rooms.filter(r => /video|music|youtube|media/.test(category(r)) || r.isVideo === true || r.isMusic === true);
    return rooms.sort((a, b) => (Number(b.onlineCount || 0) - Number(a.onlineCount || 0)) || (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
  }
  return rooms;
}

function renderPopularSummary() {
  const rooms = [...roomListCache];
  const live = rooms.filter(r => (r.onlineCount || 0) > 0);
  const hosts = new Set(rooms.map(r => String(r.hostId || "")).filter(Boolean));
  const cp = rooms.reduce((n, r) => n + Number(r.onlineCount || 0), 0);
  if ($("popular-ranking-count")) $("popular-ranking-count").textContent = String(Math.min(99, live.length));
  if ($("popular-agency-ranking-count")) $("popular-agency-ranking-count").textContent = "LIVE";
  if ($("popular-cp-count")) $("popular-cp-count").textContent = String(Math.min(999, cp));
}


function switchHomePrimaryTab(tab) {
  homePrimaryTab = tab;
  document.querySelectorAll(".home-primary-tab").forEach((b) => b.classList.toggle("active", b.dataset.homeTab === tab));
  setHomePopularChrome(tab === "popular");
  if (tab === "popular") {
    ["live", "recently", "following", "myroom"].forEach((t) => $("social-panel-" + t)?.classList.add("hidden"));
    $("social-panel-live")?.classList.remove("hidden");
    $("home-room-scroll")?.classList.add("is-popular");
    $("home-room-section-title").textContent = "";
    renderPopularSummary();
    renderRoomList(getHomeRoomsForMode());
    return;
  }
  $("home-room-scroll")?.classList.remove("is-popular");
  $("home-room-section-title").textContent = tab === "explore" ? "Explore Rooms" : "Rooms";
  $("social-panel-live")?.classList.remove("hidden");
  $("social-panel-recently")?.classList.add("hidden");
  $("social-panel-following")?.classList.add("hidden");
  $("social-panel-myroom")?.classList.add("hidden");
  renderRoomList(getHomeRoomsForMode());
}

function switchSocialTab(tab) {
  socialTab = tab;
  ["live", "recently", "following", "myroom"].forEach((t) => {
    const panel = $("social-panel-" + t);
    if (panel) panel.classList.toggle("hidden", t !== tab && !(t === "live" && tab === "recently"));
  });
  document.querySelectorAll(".social-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  // Recently is the default room-discovery pane. Following/My Room are
  // independent panes and replace the room list in the scroll area.
  if (tab === "recently") {
    $("social-panel-live")?.classList.remove("hidden");
    $("social-panel-recently")?.classList.add("hidden");
    $("social-panel-following")?.classList.add("hidden");
    $("social-panel-myroom")?.classList.add("hidden");
    loadRoomList();
  } else if (tab === "following") {
    $("social-panel-live")?.classList.add("hidden");
    $("social-panel-recently")?.classList.add("hidden");
    $("social-panel-myroom")?.classList.add("hidden");
    $("social-panel-following")?.classList.remove("hidden");
    loadFollowingLive();
  } else if (tab === "myroom") {
    $("social-panel-live")?.classList.add("hidden");
    $("social-panel-recently")?.classList.add("hidden");
    $("social-panel-following")?.classList.add("hidden");
    $("social-panel-myroom")?.classList.remove("hidden");
    renderMyRoomPanel();
  }
}
function loadActiveSocialTab() { switchSocialTab(socialTab); }

// ---- Recently ----
async function loadRecentRooms() {
  const r = await api(`/api/recent-rooms/${me.userId}`);
  if (!r.success) return;
  recentRoomsCache = r.recentRooms; recentRoomsShown = 0;
  renderRecentRoomsPage();
}
function renderRecentRoomsPage() {
  const wrap = $("recent-rooms-list");
  if (recentRoomsShown === 0) wrap.innerHTML = "";
  $("recent-rooms-empty").classList.toggle("hidden", recentRoomsCache.length > 0);
  recentRoomsCache.slice(recentRoomsShown, recentRoomsShown + SOCIAL_PAGE_SIZE).forEach((entry) => {
    const item = document.createElement("div");
    item.className = "social-item";
    item.innerHTML = `
      <div class="social-item-icon">🎙️</div>
      <div class="social-item-body">
        <h3>${escapeHtml(entry.roomName)}</h3>
        <span class="sub">#${escapeHtml(entry.roomNumber)} · Visited: ${formatVisitTime(entry.lastVisitAt)} · ${entry.isLive ? `👥 ${entry.onlineCount} Online` : "Closed"}</span>
      </div>
      <button class="btn btn-primary btn-sm join-btn" ${entry.isLive ? "" : "disabled"}>Join</button>
    `;
    if (entry.isLive) item.querySelector(".join-btn").addEventListener("click", () => joinRoom(entry.roomId));
    wrap.appendChild(item);
  });
  recentRoomsShown += Math.min(SOCIAL_PAGE_SIZE, recentRoomsCache.length - recentRoomsShown);
  $("btn-recent-load-more").classList.toggle("hidden", recentRoomsShown >= recentRoomsCache.length);
}
$("btn-recent-load-more").addEventListener("click", renderRecentRoomsPage);
$("btn-clear-recent").addEventListener("click", async () => {
  if (!confirm("Clear all history?")) return;
  const r = await api(`/api/recent-rooms/${me.userId}`, "DELETE");
  if (r.success) loadRecentRooms();
});

// ---- Following ----
async function loadFollowingLive() {
  const r = await api(`/api/following-live/${me.userId}`);
  if (!r.success) return;
  followingCache = r.following; followingShown = 0;
  renderFollowingPage();
}
function followingItemHtml(f) {
  const statusClass = (f.live || f.online) ? "online" : "offline";
  return `
    <div class="social-item-icon">${f.photo ? `<img src="${escapeHtml(f.photo)}" alt="">` : "👤"}<span class="status-dot ${statusClass}"></span></div>
    <div class="social-item-body">
      <h3>${escapeHtml(f.name)}${f.live ? '<span class="live-badge">Live</span>' : ""}</h3>
      <span class="sub">ID: ${escapeHtml(f.userId)}${f.live ? ` · Room: #${escapeHtml(f.roomNumber)} ${escapeHtml(f.roomName)}` : (f.online ? " · Online" : " · Offline")}</span>
    </div>
    <button class="btn btn-primary btn-sm join-btn" ${f.live ? "" : "disabled"}>Join</button>
  `;
}
function renderFollowingPage() {
  const wrap = $("following-list");
  if (followingShown === 0) wrap.innerHTML = "";
  $("following-empty").classList.toggle("hidden", followingCache.length > 0);
  followingCache.slice(followingShown, followingShown + SOCIAL_PAGE_SIZE).forEach((f) => {
    const item = document.createElement("div");
    item.className = "social-item";
    item.dataset.userId = f.userId;
    item.innerHTML = followingItemHtml(f);
    if (f.live) item.querySelector(".join-btn").addEventListener("click", () => joinRoom(f.roomId));
    wrap.appendChild(item);
  });
  followingShown += Math.min(SOCIAL_PAGE_SIZE, followingCache.length - followingShown);
  $("btn-following-load-more").classList.toggle("hidden", followingShown >= followingCache.length);
}
$("btn-following-load-more").addEventListener("click", renderFollowingPage);
function handleFollowStatusUpdate(update) {
  const idx = followingCache.findIndex((f) => f.userId === update.userId);
  if (idx === -1) return; // someone we don't follow, or Following tab not loaded yet
  followingCache[idx] = {
    ...followingCache[idx],
    online: update.status !== "offline", live: update.status === "live",
    roomId: update.roomId, roomNumber: update.roomNumber, roomName: update.roomName
  };
  if (socialTab !== "following") return;
  const el = document.querySelector(`#following-list .social-item[data-user-id="${update.userId}"]`);
  if (!el) return;
  el.innerHTML = followingItemHtml(followingCache[idx]);
  if (followingCache[idx].live) el.querySelector(".join-btn").addEventListener("click", () => joinRoom(followingCache[idx].roomId));
}

// ---- Followed Rooms (Party home) ----
function getMyRooms() {
  const followed = new Set((me?.followingList || []).map(String));
  return (roomListCache || []).filter((r) => followed.has(String(r.hostId || "")));
}
function renderMyRoomPanel() {
  const rooms = getMyRooms();
  myRoomCache = rooms;
  const wrap = $("my-room-list");
  wrap.innerHTML = "";
  $("my-room-empty").classList.toggle("hidden", rooms.length > 0);
  if (!rooms.length) return;
  rooms.forEach((room) => {
    const item = document.createElement("div");
    item.className = "social-item my-room-item";
    item.innerHTML = `
      <div class="social-item-icon">${room.logo ? `<img src="${escapeHtml(room.logo)}" alt="">` : "🎙️"}</div>
      <div class="social-item-body">
        <h3>${room.countryFlag ? `<span class="room-flag">${room.countryFlag}</span>` : ""}${escapeHtml(room.roomName)}</h3>
        <span class="sub">#${escapeHtml(room.roomNumber)} · ${room.onlineCount || 0} Online</span>
      </div>
      <button class="btn btn-primary btn-sm join-btn">Join</button>
    `;
    item.querySelector(".join-btn").addEventListener("click", () => joinRoom(room.roomId));
    wrap.appendChild(item);
  });
}

function renderHomeMyRoomCard() {
  const card = $("home-my-room-card");
  if (card) card.classList.add("hidden");
}

// Global Search — opens the dedicated search surface instead of the old
// home-only room filter. Existing home room filtering remains intact for
// other code paths, but the top Search icon now performs real User/Room search.
let globalSearchType = "room";
let globalSearchLastQuery = "";

function setGlobalSearchType(type) {
  globalSearchType = type === "user" ? "user" : "room";
  document.querySelectorAll(".pp-search-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.searchType === globalSearchType);
  });
  renderGlobalSearchResults();
}

function renderGlobalSearchResults() {
  const roomWrap = $("global-search-room-results");
  const userWrap = $("global-search-user-results");
  if (!roomWrap || !userWrap) return;
  roomWrap.classList.toggle("hidden", globalSearchType !== "room");
  userWrap.classList.toggle("hidden", globalSearchType !== "user");
  const active = globalSearchType === "room" ? roomWrap : userWrap;
  const hasResults = !!active.children.length;
  $("global-search-empty")?.classList.toggle("hidden", !globalSearchLastQuery || hasResults);
}

function renderGlobalSearchData(data) {
  const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const users = Array.isArray(data?.users) ? data.users : [];
  const roomWrap = $("global-search-room-results");
  const userWrap = $("global-search-user-results");
  if (!roomWrap || !userWrap) return;
  roomWrap.innerHTML = "";
  userWrap.innerHTML = "";

  rooms.forEach((room) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pp-search-room-card";
    const cover = room.cover_url || "/images/room-default-theme.jpg";
    card.innerHTML = `
      <img class="pp-search-room-cover" src="${escapeHtml(cover)}" alt="" onerror="this.src='/images/room-default-theme.jpg'">
      <div class="pp-search-room-info">
        <strong>${escapeHtml(room.room_name || "Room")}</strong>
        <span>ID: ${escapeHtml(room.room_id || room.room_number || "—")}</span>
        <small>${room.host_name ? `Host: ${escapeHtml(room.host_name)}` : ""}</small>
      </div>
      <span class="pp-search-room-online">👥 ${Number(room.online_count || 0)}</span>
      <span class="pp-search-arrow">›</span>`;
    card.addEventListener("click", () => joinRoom(room.room_id));
    roomWrap.appendChild(card);
  });

  users.forEach((user) => {
    const row = document.createElement("div");
    row.className = "pp-search-user-row";
    const following = !!user.is_following;
    row.innerHTML = `
      <button class="pp-search-user-main" type="button">
        <img class="pp-search-user-avatar" src="${escapeHtml(user.avatar_url || placeholderAvatar(user.nickname))}" alt="">
        <span class="pp-search-user-info"><strong>${escapeHtml(user.nickname || "User")}</strong><small>ID: ${escapeHtml(user.user_id || "—")}</small></span>
      </button>
      <button class="pp-search-follow ${following ? "following" : ""}" type="button">${following ? "Following" : "Follow"}</button>`;
    const main = row.querySelector(".pp-search-user-main");
    main.addEventListener("click", () => openOtherProfile(user.user_id));
    const followBtn = row.querySelector(".pp-search-follow");
    followBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const nowFollowing = followBtn.classList.contains("following");
      const endpoint = nowFollowing ? "/api/user/unfollow" : "/api/user/follow";
      followBtn.disabled = true;
      const r = await api(endpoint, "POST", { targetUserId: user.user_id });
      followBtn.disabled = false;
      if (!r.success) { toast(r.message || "Could not update follow"); return; }
      me = r.user; saveSession();
      user.is_following = !nowFollowing;
      followBtn.classList.toggle("following", user.is_following);
      followBtn.textContent = user.is_following ? "Following" : "Follow";
    });
    userWrap.appendChild(row);
  });
  renderGlobalSearchResults();
}

async function runGlobalSearch() {
  const input = $("global-search-input");
  const q = String(input?.value || "").trim();
  globalSearchLastQuery = q;
  $("global-search-clear")?.classList.toggle("hidden", !q);
  $("global-search-loading")?.classList.toggle("hidden", !q);
  $("global-search-empty")?.classList.add("hidden");
  if (!q) {
    $("global-search-room-results").innerHTML = "";
    $("global-search-user-results").innerHTML = "";
    $("global-search-loading")?.classList.add("hidden");
    return;
  }
  try {
    const r = await api("/api/search?q=" + encodeURIComponent(q) + "&type=all");
    if (!r.success) throw new Error(r.message || "Search failed");
    renderGlobalSearchData(r);
  } catch (e) {
    console.error("global search", e);
    $("global-search-room-results").innerHTML = "";
    $("global-search-user-results").innerHTML = "";
    toast(e.message || "Search failed");
  } finally {
    $("global-search-loading")?.classList.add("hidden");
    renderGlobalSearchResults();
  }
}

$("btn-home-search")?.addEventListener("click", () => {
  showView("view-search");
  const input = $("global-search-input");
  if (input) {
    input.value = "";
    globalSearchLastQuery = "";
    $("global-search-clear")?.classList.add("hidden");
    setTimeout(() => input.focus(), 40);
  }
  setGlobalSearchType("room");
});
$("btn-search-back")?.addEventListener("click", () => showView("view-home"));
$("global-search-submit")?.addEventListener("click", runGlobalSearch);
$("global-search-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runGlobalSearch(); }
});
$("global-search-clear")?.addEventListener("click", () => {
  const input = $("global-search-input");
  if (input) { input.value = ""; input.focus(); }
  globalSearchLastQuery = "";
  $("global-search-clear")?.classList.add("hidden");
  $("global-search-room-results").innerHTML = "";
  $("global-search-user-results").innerHTML = "";
  renderGlobalSearchResults();
});
document.querySelectorAll(".pp-search-tab").forEach((btn) => {
  btn.addEventListener("click", () => setGlobalSearchType(btn.dataset.searchType));
});
$("home-search-input")?.addEventListener("input", (e) => {
  homeSearchTerm = e.target.value || "";
  renderRoomList(getHomeRoomsForMode());
});
$("home-search-clear")?.addEventListener("click", () => {
  homeSearchTerm = "";
  if ($("home-search-input")) $("home-search-input").value = "";
  renderRoomList(getHomeRoomsForMode());
});
document.querySelectorAll("[data-popular-filter]").forEach((btn) => btn.addEventListener("click", () => {
  popularFilter = btn.dataset.popularFilter;
  document.querySelectorAll("[data-popular-filter]").forEach(b => b.classList.toggle("active", b === btn));
  renderRoomList(getHomeRoomsForMode());
}));

document.querySelectorAll("[data-popular-tool]").forEach((btn) => btn.addEventListener("click", () => {
  const mode = btn.dataset.popularTool;
  document.querySelectorAll("[data-popular-tool]").forEach(b => b.classList.toggle("selected", b === btn));
  if (mode === "family") { toast("Family is coming soon"); return; }
  if (mode === "agency-ranking") { window.location.href = "/agency-ranking/"; return; }
  if (mode === "ranking") { window.location.href = "/rankings/rooms.html"; return; }
  if (mode === "cp") { window.location.href = "/rankings/cp.html"; return; }
  let rooms = getHomeRoomsForMode();
  if (mode === "ranking" || mode === "cp") rooms.sort((a, b) => (b.onlineCount || 0) - (a.onlineCount || 0));
  if (mode === "agency-ranking") { window.location.href = "/agency-ranking/"; return; }
  const label = mode === "ranking" ? "Ranking Rooms" : mode === "agency-ranking" ? "Agency Ranking" : "CP Rooms";
  if ($("home-room-section-title")) $("home-room-section-title").textContent = label;
  renderRoomList(rooms);
}));

// Shows/hides the room logo in the room header — used on join and whenever
// the owner/admin changes it live.
function setRoomLogo(url) {
  const img = $("room-logo-display");
  if (!img) return;
  img.src = url || DEFAULT_ROOM_LOGO_URL;
  img.classList.remove("hidden");
}

$("btn-create-room").addEventListener("click", () => {
  $("create-room-name").value = "";
  $("modal-create-room").classList.remove("hidden");
});
$("btn-cancel-create-room").addEventListener("click", () => $("modal-create-room").classList.add("hidden"));
let roomCreateInFlight = false;
$("btn-confirm-create-room").addEventListener("click", async () => {
  if (roomCreateInFlight) return;
  const roomName = $("create-room-name").value.trim();
  if (!roomName) { toast("Enter a Room name"); return; }
  roomCreateInFlight = true;
  const createBtn = $("btn-confirm-create-room");
  createBtn.disabled = true;
  try {
    const r = await api("/api/room/create", "POST", { roomName, userId: me.userId, userName: me.name });
  $("modal-create-room").classList.add("hidden");
  if (r.success) { joinRoom(r.room.roomId); return; }
  if (r.existingRoomId) {
    if (confirm(r.message + "\n\nGo to your existing room?")) joinRoom(r.existingRoomId);
  } else toast(r.message || "Couldn't create the room");
  } catch (e) {
    console.error("[room-create] request failed", e);
    toast("Couldn't create the room");
  } finally {
    roomCreateInFlight = false;
    createBtn.disabled = false;
  }
});

document.querySelectorAll('.nav-btn[data-nav="home"]').forEach((b) => b.addEventListener("click", () => { showView("view-home"); loadRoomList(); loadActiveSocialTab(); }));
document.querySelectorAll('.nav-btn[data-nav="profile"]').forEach((b) => b.addEventListener("click", openOwnProfile));
document.querySelectorAll('.nav-btn[data-nav="inbox"]').forEach((b) => b.addEventListener("click", () => { privateReturnToRoom = false; openInbox(); }));
$("private-message-indicator")?.addEventListener("click", () => { openRoomPrivateMessages(); });

// ===========================================================================
$("btn-room-speaker")?.addEventListener("click", () => {
  roomSpeakerOn = !roomSpeakerOn;
  applyRoomSpeakerState();
  if (roomSpeakerOn) {
    Object.values(remoteAudioEls).forEach((audio) => {
      try { audio.muted = false; audio.volume = 1; audio.play().catch(() => {}); } catch (_) {}
    });
  }
});
applyRoomSpeakerState();

// VOICE ROOM
// ===========================================================================
async function ensureRoomSocketReady() {
  if (!socket) connectSocket();
  if (socket?.connected) return true;
  return await new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); socket?.off("connect", onConnect); socket?.off("connect_error", onError); resolve(ok); };
    const onConnect = () => finish(true);
    const onError = () => {}; // keep waiting; Socket.IO has infinite reconnect enabled
    const timer = setTimeout(() => finish(!!socket?.connected), 12000);
    socket?.once("connect", onConnect);
    socket?.once("connect_error", onError);
    if (socket?.connected) finish(true);
  });
}

function stopRoomMusic() {
  const audio = $("room-audio");
  if (!audio) return;
  try { audio.pause(); } catch (_) {}
  audio.removeAttribute("src");
  try { audio.load(); } catch (_) {}
  if (currentRoom) currentRoom.music = { url: "", name: "", playing: false };
  const label = $("music-now-playing");
  if (label) label.textContent = "No song playing";
  const btn = $("btn-open-music");
  if (btn) btn.classList.remove("active");
}

async function joinRoom(roomId, password) {
  if (!roomId || !me?.userId) return;
  const meta = roomListCache.find((r) => r.roomId === roomId);
  // Owner and God Power holders can enter their authorized locked rooms
  // without being shown the password prompt. Room admins still need the
  // room password. The server remains authoritative for this rule.
  const lockBypass = !!(meta && meta.roomLocked && (meta.hostId === me.userId || me.can_manage_all));
  if (meta && meta.roomLocked && !password && !lockBypass) {
    promptRoomPassword(roomId);
    return;
  }
  if (leaveInProgress) {
    // Serialize leave -> join. The leave ACK will dispatch this last tap.
    pendingJoinRequest = { roomId, password };
    return;
  }
  if (joinedRoomId === roomId && currentRoomId === roomId && !password) {
    roomKept = false;
    updateKeptRoomPill();
    showView("view-room");
    return;
  }
  // Serialize immediately, BEFORE waiting for Socket.IO. The previous code
  // only set joinInProgress after ensureRoomSocketReady(), so two fast taps
  // during connection setup could both pass the guard and emit overlapping
  // joins.
  if (joinInProgress) {
    pendingJoinRequest = { roomId, password };
    return;
  }

  const opSeq = ++roomLifecycleSeq;
  roomKept = false;
  updateKeptRoomPill();
  roomJoinAckId = null;
  joinInProgress = true;
  pendingJoinRequest = null;
  const socketReady = await ensureRoomSocketReady();
  if (opSeq !== roomLifecycleSeq || !joinInProgress) return;
  if (!socketReady) {
    joinInProgress = false;
    roomJoinAckId = null;
    pendingJoinRequest = null;
    toast("Connection is taking too long. Please try again.");
    return;
  }

  // Stop only local media/playback immediately; keep the current room view
  // visible while switching. The server owns membership and will ACK the new
  // room before the client considers the switch complete.
  stopRoomMusic();
  currentRoomId = roomId;
  saveActiveRoom(roomId);
  mySeatNumber = null;
  closeRoomGame();
  teardownYtPlayer();
  seatMap = {};
  currentRelationshipLinks = [];
  speakingUsers.clear(); musicUsers.clear(); voiceLevels.clear();
  $("btn-room-mod").classList.add("hidden");
  setRoomLogo(null);
  roomEntryEffectPending = true;

  // Do NOT block room entry on voice-mode discovery. On mobile/WebView or a
  // slow tunnel, either REST probe can take a long time even though the
  // Socket.IO room channel is already usable. Voice mode is allowed to
  // settle in the background; the authoritative room join must be emitted
  // immediately after the socket becomes ready.
  refreshVoiceMode().catch(() => {});
  if (opSeq !== roomLifecycleSeq || !joinInProgress) return;

  socket.emit("join-room", {
    roomId, userId: me.userId, userName: me.name, userPhoto: me.photo || "",
    password: password || undefined
  });
  $("gift-banner").innerHTML = "";
  // IMPORTANT: do NOT show the room here. The room UI is opened only from
  // the authoritative room-state ACK below, and only when our own user is
  // present in that snapshot. This eliminates the "looks open but isn't
  // actually joined" WebView/mobile-network symptom.
  if (joinedRoomId !== roomId && currentRoomId !== roomId) showView("view-home");
  notifyAndroidVoiceSession(false);
}

// Room Lock (#11): shown either when the cached room list already flags a
// room as locked, or reactively when the server rejects a join with
// needPassword (e.g. a stale/uncached room list, or a wrong password retry).
function promptRoomPassword(roomId) {
  $("room-password-input").value = "";
  $("modal-room-password").dataset.roomId = roomId;
  $("modal-room-password").classList.remove("hidden");
  $("room-password-input").focus();
}
$("btn-room-password-submit").addEventListener("click", () => {
  const roomId = $("modal-room-password").dataset.roomId;
  const password = $("room-password-input").value;
  if (!password) { toast("Enter Password"); return; }
  $("modal-room-password").classList.add("hidden");
  joinRoom(roomId, password);
});
$("room-password-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("btn-room-password-submit").click();
});
$("btn-room-password-cancel").addEventListener("click", () => {
  $("modal-room-password").classList.add("hidden");
});

function updateKeptRoomPill() {
  const pill = $("kept-room-pill");
  if (!pill) return;
  const active = !!roomKept && !!joinedRoomId && !!currentRoom;
  pill.classList.toggle("hidden", !active);
  if (!active) return;
  $("kept-room-name").textContent = currentRoom.roomName || "Room";
  const rid = currentRoom.roomNumber || currentRoom.roomId || "—";
  $("kept-room-id").textContent = "ID: " + rid;
  const count = Array.isArray(currentRoom.onlineUsers) ? currentRoom.onlineUsers.filter(u => !u?.hidden).length : 0;
  $("kept-room-online").textContent = count + " online";
}

function keepRoom() {
  if (!joinedRoomId || !currentRoom) return;
  roomKept = true;
  closeAllPanels();
  // KEEP intentionally does NOT emit leave-room, stop voice, clear the active-room
  // marker, or tear down media. The socket membership and seat remain authoritative.
  updateKeptRoomPill();
  showView("view-home");
  loadRoomList();
  toast("Room kept active · you are still online");
}

function exitRoom() {
  // Leaving the room is different from closing/collapsing the calculator panel:
  // terminate the room-local calculator state so it cannot keep counting after
  // the owner/admin has left this room.
  if (currentRoomId && canManageGiftCalculator()) {
    socket.emit("gift-calculator-set", { roomId: currentRoomId, on: false });
  }
  closeGiftCalculatorModal(false);
  giftCalculatorState = { on: false, totals: Array(12).fill(0) };
  syncGiftCalculatorPowerUi();
  if (leaveInProgress) return;
  roomKept = false;
  updateKeptRoomPill();
  stopPremiumRoomEntryEffect();
  roomEntryEffectPending = false;
  lastPremiumEntryRoomId = null;
  const leavingRoomId = joinedRoomId || currentRoomId;

  if (!joinedRoomId) {
    roomLifecycleSeq++;
    joinInProgress = false;
    pendingJoinRequest = null;
    currentRoomId = null;
    currentRoom = null;
    saveActiveRoom(null);
    showView("view-home");
    return;
  }

  leaveInProgress = true;
  pendingLeaveRoomId = leavingRoomId;
  roomLifecycleSeq++;
  joinInProgress = false;
  pendingJoinRequest = null;

  if (socket?.connected && leavingRoomId) {
    try { socket.emit("leave-room", { roomId: leavingRoomId, userId: me.userId }); } catch (_) {}
    if (leaveSafetyTimer) clearTimeout(leaveSafetyTimer);
    leaveSafetyTimer = setTimeout(() => {
      if (!leaveInProgress || pendingLeaveRoomId !== leavingRoomId) return;
      pendingLeaveRoomId = null;
      leaveInProgress = false;
      currentRoomId = null; currentRoom = null; joinedRoomId = null;
      saveActiveRoom(null);
      teardownVoice(); stopRoomMusic(); closeRoomGame(); teardownYtPlayer();
      if (window.PingPongRobin?.isActive?.()) window.PingPongRobin.stop();
      stopChestCountdown();
      notifyAndroidVoiceSession(false);
      updateKeptRoomPill();
      showView("view-home");
      loadRoomList();
      toast("Exited room");
    }, 5000);
    return;
  }

  pendingLeaveRoomId = null;
  leaveInProgress = false;
  teardownVoice(); stopRoomMusic(); closeRoomGame(); teardownYtPlayer();
  if (window.PingPongRobin?.isActive?.()) window.PingPongRobin.stop();
  stopChestCountdown();
  currentRoomId = null; currentRoom = null; joinedRoomId = null; roomJoinAckId = null;
  saveActiveRoom(null);
  notifyAndroidVoiceSession(false);
  updateKeptRoomPill();
  showView("view-home");
  loadRoomList();
}

$("btn-leave-room").addEventListener("click", keepRoom);
$("btn-room-power")?.addEventListener("click", exitRoom);
$("btn-open-kept-room")?.addEventListener("click", () => {
  if (!joinedRoomId || !currentRoom) return;
  roomKept = false;
  updateKeptRoomPill();
  showView("view-room");
});
$("btn-exit-kept-room")?.addEventListener("click", exitRoom);

// Resets the YouTube Room Player to a clean slate when leaving a room (or
// just before joining a different one) — otherwise a stale player instance
// or a previous room's playlist could bleed into the next room's view.
function teardownYtPlayer() {
  clearInterval(ytDriftTimer); ytDriftTimer = null;
  if (ytPlayer && typeof ytPlayer.destroy === "function") { try { ytPlayer.destroy(); } catch (_) {} }
  ytPlayer = null;
  ytPendingLoad = null;
  ytCurrentPlaylist = [];
  ytPlayerState = { mode: false, currentIndex: -1, isPlaying: false, position: 0, updatedAt: Date.now() };
  canControlYt = false;
  $("yt-player-wrap").classList.add("hidden");
  syncYtHeaderClass();
  $("btn-toggle-yt").classList.remove("active");
  $("modal-yt-playlist").classList.add("hidden");
}

function hydrateSeatMap(seats) {
  seatMap = {};
  mySeatNumber = null;
  seats.forEach((seat, i) => {
    if (seat) {
      seatMap[i + 1] = { userId: seat.userId, socketId: seat.socketId, userName: seat.userName, userPhoto: seat.userPhoto, role: seat.role, activeFrame: seat.activeFrame || null, vipLevel: seat.vipLevel || 0, svipLevel: seat.svipLevel || 0, secretLord: !!seat.secretLord, customTag: seat.customTag || null, agencyBadge: seat.agencyBadge || null, nameEffect: seat.nameEffect || null, modLabel: seat.modLabel || null, micMuted: !!seat.micMuted, activeBadges: seat.activeBadges || [], level: Number(seat.level) || 1 };
      if (seat.userId === me.userId) mySeatNumber = i + 1;
    }
  });
  // Authoritative room-state hydration can be the first place where the
  // browser learns that this user is seated. The old hands-free Robin flow
  // only started from the incremental `seat-update` event, so a perfectly
  // valid room-state-first join could leave the customer seated with no Vapi
  // call and no server-side symptom. Trigger the same idempotent lifecycle
  // hook after hydration; it is safe because cs101MaybeGreetOnSeat() has a
  // per-seat key and Vapi start() itself is duplicate-safe.
  if (mySeatNumber != null && typeof cs101MaybeGreetOnSeat === "function") {
    setTimeout(() => {
      try { cs101MaybeGreetOnSeat(); } catch (err) {
        console.warn("[Robin] seat hydration auto-start hook failed:", err);
      }
    }, 0);
  }
}
function seatsFromMap() {
  const seats = Array(12).fill(null);
  Object.keys(seatMap).forEach((num) => {
    const entry = seatMap[num];
    seats[num - 1] = {
      userId: entry.userId,
      userName: entry.userName || currentRoom?.onlineUsers?.find(u => u.userId === entry.userId)?.userName || "User",
      userPhoto: entry.userPhoto || "",
      socketId: entry.socketId,
      role: entry.role,
      activeFrame: entry.activeFrame || null,
      vipLevel: entry.vipLevel || 0,
      customTag: entry.customTag || null,
      agencyBadge: entry.agencyBadge || null,
      nameEffect: entry.nameEffect || null,
      modLabel: entry.modLabel || null,
      micMuted: !!entry.micMuted,
      activeBadges: entry.activeBadges || []
    };
  });
  return seats;
}

function cs101IsOfficialRoom() {
  return !!(currentRoom && (currentRoom.roomId === "101" || currentRoom.aiCustomerService === true));
}

let cs101ConfigClient = { enabled:true, agentName:"AI Customer Service", avatarUrl:"/photos/cs101-female.svg", voiceEnabled:true, voiceRate:0.98, voicePitch:1.04 };
let cs101GreetedSeatKey = null;
let cs101AutoListening = false;
let cs101VoiceReady = false;
let cs101LastSpokenText = "";
// Guarantee-Robin-speaks fallback: set true the moment a Vapi call attempt
// fails for the current seat visit. While true, the browser
// SpeechRecognition/SpeechSynthesis bridge is allowed to run even though
// Vapi is "enabled" in config — because "enabled" only means configured,
// not that the live call actually succeeded. Reset to false on every new
// seat-sit so a later, working attempt still prefers Vapi.
let cs101VapiUnavailableThisVisit = true;

function cs101VoiceBridgeAllowed() {
  // Production default: browser speech is the keyless voice transport.
  // Vapi is optional and never required for customer support.
  return cs101IsOfficialRoom() && mySeatNumber != null &&
    cs101VapiUnavailableThisVisit === true &&
    cs101ConfigClient.voiceEnabled !== false;
}

// Wired as window.PingPongRobin.onVoiceFailure — called by vapi-support.js
// the instant a call attempt fails to connect or drops with an error, for
// ANY reason (bad key, unpublished assistant, network, blocked mic). This
// is what makes "Robin will speak" not depend on a third-party service
// working: the moment Vapi can't be reached, the room falls back to the
// app's own server (text AI reply) + the browser's own speech synthesis,
// neither of which needs Vapi/Daily.co at all.
function cs101FallbackAfterVapiFailure() {
  if (!cs101IsOfficialRoom() || mySeatNumber == null || !socket) return;
  if (cs101VapiUnavailableThisVisit) return; // already switched over for this seat visit
  cs101VapiUnavailableThisVisit = true;
  socket.emit("cs101:greet");
}

// Wired as window.PingPongRobin.onVoiceStart — called the moment Vapi
// genuinely connects. If the fallback bridge had already been switched on
// (e.g. the watchdog below fired a little early on a slow connection, and
// Vapi went on to connect anyway a few seconds later), this hands the seat
// back to Vapi and stops the browser mic listener/speech so only ONE
// voice path is ever active for the seat at a time.
function cs101CancelFallback() {
  cs101VapiUnavailableThisVisit = false;
  cs101StopRecognition();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function renderCs101Seat(info) {
  const el = $("cs101-ai-seat");
  if (!el) return;
  const show = cs101IsOfficialRoom() && cs101ConfigClient.enabled !== false;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  const img = $("cs101-ai-avatar-img");
  if (img) img.src = cs101ConfigClient.avatarUrl || "/photos/cs101-female.svg";
  const name = $("cs101-ai-seat-name");
  if (name) name.textContent = cs101ConfigClient.agentName || "AI Customer Service";
}

function cs101AppendMessage(role, text) {
  const log = $("cs101-log");
  if (!log || !text) return;
  const el = document.createElement("div");
  el.className = `cs101-msg ${role === "user" ? "user" : "ai"}`;
  el.textContent = text;
  log.appendChild(el);
  while (log.children.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function cs101ChooseFemaleVoice(lang) {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  const femaleHints = /female|woman|zira|samantha|susan|karen|hazel|aria|jenny|sonia|heera|priya|veena|google.*hindi|google.*bengali|microsoft.*zira|microsoft.*heera/i;
  const prefix = String(lang || "en").split("-")[0].toLowerCase();
  const sameLanguage = voices.filter(v => String(v.lang || "").toLowerCase().startsWith(prefix));
  return sameLanguage.find(v => femaleHints.test(v.name || "")) ||
         sameLanguage.find(v => /female|woman/i.test(v.name || "")) ||
         voices.find(v => femaleHints.test(v.name || "")) ||
         sameLanguage[0] || voices[0] || null;
}
if ("speechSynthesis" in window) {
  const warmVoices = () => { cs101VoiceReady = true; try { window.speechSynthesis.getVoices(); } catch (_) {} };
  warmVoices();
  window.speechSynthesis.onvoiceschanged = warmVoices;
}

function cs101StopRecognition() {
  if (cs101Recognition) {
    try { cs101Recognition.stop(); } catch (_) {}
  }
  cs101Listening = false;
  cs101AutoListening = false;
}

function cs101Speak(text, voiceMeta = {}) {
  if (!cs101VoiceBridgeAllowed() || window.PingPongRobin?.isActive?.()) return Promise.resolve();
  return new Promise((resolve) => {
    if (!text || !cs101ConfigClient.voiceEnabled || !roomSpeakerOn || !("speechSynthesis" in window)) return resolve();
    const spoken = String(text).trim();
    if (!spoken || spoken === cs101LastSpokenText) return resolve();
    cs101LastSpokenText = spoken;
    cs101StopRecognition();
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(spoken.slice(0, 1800));
      const preferred = String(voiceMeta.language || (me && me.language) || "").toLowerCase();
      const lang = preferred.startsWith("bn") ? "bn-IN" : (preferred.startsWith("hi") ? "hi-IN" : (/^[\u0980-\u09FF]/.test(spoken) ? "bn-IN" : (/^[\u0900-\u097F]/.test(spoken) ? "hi-IN" : "en-IN")));
      utter.lang = lang;
      const voice = cs101ChooseFemaleVoice(lang);
      if (voice) utter.voice = voice;
      utter.rate = Number(voiceMeta.rate || cs101ConfigClient.voiceRate || 0.96);
      utter.pitch = Number(voiceMeta.pitch || cs101ConfigClient.voicePitch || 1.08);
      utter.volume = 1;
      const done = () => { if (cs101IsOfficialRoom() && mySeatNumber != null) setTimeout(cs101StartAutoRecognition, 650); resolve(); };
      utter.onend = done;
      utter.onerror = done;
      // A tiny deferred speak is more reliable on Android when voices are still loading.
      setTimeout(() => { try { synth.speak(utter); } catch (_) { resolve(); } }, cs101VoiceReady ? 0 : 120);
    } catch (_) { resolve(); }
  });
}
function cs101SendText(text) {
  const value = String(text || "").trim();
  if (!value || !socket || currentRoomId !== "101") return;
  cs101AppendMessage("user", value);
  cs101History.push({ role: "user", content: value });
  while (cs101History.length > 12) cs101History.shift();
  socket.emit("cs101:message", { roomId: "101", text: value, history: cs101History });
}

function cs101StartAutoRecognition() {
  if (!cs101VoiceBridgeAllowed()) return;
  // Belt-and-suspenders: never open a second mic listener while Vapi
  // itself reports an active call, even if the fallback flag above is
  // somehow stale. Two concurrent getUserMedia consumers is exactly the
  // "spoke once then stopped responding" failure mode.
  if (window.PingPongRobin?.isActive?.()) return;
  if (currentRoomId !== "101" || mySeatNumber == null || cs101AutoListening) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  const r = new Recognition();
  cs101Recognition = r;
  const browserLang = String(navigator.language || "en-IN").toLowerCase();
  r.lang = "en-IN";
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onstart = () => { cs101Listening = true; cs101AutoListening = true; };
  r.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || "";
    if (text) cs101SendText(text);
  };
  r.onerror = () => { cs101Listening = false; cs101AutoListening = false; };
  r.onend = () => { cs101Listening = false; cs101AutoListening = false; };
  try { r.start(); } catch (_) { cs101Listening = false; cs101AutoListening = false; }
}

function cs101MaybeGreetOnSeat() {
  if (!cs101IsOfficialRoom() || mySeatNumber == null || !socket) {
    if (mySeatNumber == null) cs101GreetedSeatKey = null;
    return;
  }
  const key = `${currentRoomId}:${me?.userId || ""}:${mySeatNumber}`;
  if (cs101GreetedSeatKey === key) return;
  console.log("[Robin] Customer Service seat detected", { roomId: currentRoomId, seat: mySeatNumber, userId: me?.userId });

  // Hands-free production behavior: the moment the customer occupies a
  // seat in Room 101, start the real Vapi conversation. Do NOT gate this on
  // the async config preload flag: a slow mobile/tunnel response used to make
  // the seat event happen first, permanently skipping Robin for that visit.
  // autoStartForCustomerServiceSeat() now owns config loading/retries.
  const start = async () => {
    if (currentRoomId !== "101" || mySeatNumber == null) return;
    if (typeof window.PingPongRobin?.autoStartForCustomerServiceSeat !== "function") {
      return;
    }
    try {
      const started = await window.PingPongRobin.autoStartForCustomerServiceSeat();
      if (started || window.PingPongRobin?.isActive?.()) {
        cs101GreetedSeatKey = key;
      } else {
        // Keep the seat un-greeted so a late script/config/permission
        // readiness event can retry without requiring the customer to leave
        // and re-enter the seat.
        cs101GreetedSeatKey = null;
      }
    } catch (err) {
      cs101GreetedSeatKey = null;
      console.warn("[Robin] automatic Vapi start failed; retrying while seated:", err);
    }
  };

  // The Vapi script may load just after app.js. Give it a short, bounded
  // retry window; no UI interaction is required.
  let tries = 0;
  const waitForVapi = () => {
    if (currentRoomId !== "101" || mySeatNumber == null) return;
    if (typeof window.PingPongRobin?.autoStartForCustomerServiceSeat === "function") {
      start();
      return;
    }
    if (++tries < 150) setTimeout(waitForVapi, 100);
    else console.warn("[Robin] Vapi client did not load; automatic voice was not started.");
  };
  waitForVapi();
}
function initCs101Ui() {
  // Room 101 is intentionally hands-free: no Talk/Send controls are shown.
  const panel = $("cs101-panel");
  if (panel) panel.classList.add("hidden");
  if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
  // Wired every time (idempotent) rather than once at load, since
  // vapi-support.js and app.js load order isn't guaranteed and
  // window.PingPongRobin only exists once vapi-support.js has run.
  // BUG FIX (2026-08-14): cs101FallbackAfterVapiFailure/cs101CancelFallback
  // were defined but never actually assigned to window.PingPongRobin's
  // onVoiceFailure/onVoiceStart hooks, so the browser-speech fallback that
  // is supposed to guarantee Robin still talks when the Vapi cloud call
  // fails (bad key, unpublished assistant, blocked mic, network drop) never
  // ran. Every customer whose Vapi call failed got silence instead of the
  // fallback voice. Assigning it here (idempotent — same functions every
  // call) is what actually turns the fallback on.
  if (window.PingPongRobin) {
    window.PingPongRobin.onVoiceFailure = cs101FallbackAfterVapiFailure;
    window.PingPongRobin.onVoiceStart = cs101CancelFallback;
  }

  renderCs101Seat();
  cs101MaybeGreetOnSeat();
}

let giftCalculatorState = { on: false, totals: Array(12).fill(0) };

function canManageGiftCalculator() {
  return !!me && !!currentRoom && (currentRoom.hostId === me.userId || (currentRoom.adminIds || []).includes(me.userId));
}

function formatGiftCalculatorValue(rawValue) {
  const value = Math.max(0, Number(rawValue) || 0);
  if (value < 1000) return value.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
    minimumFractionDigits: 0
  }).format(value);
}

function renderGiftCalculatorIndicators() {
  document.querySelectorAll("#seat-grid .gift-calculator-badge").forEach((el) => el.remove());
  // Display is room-wide: every user sees the same seat total when the
  // calculator is ON. Owner/admin-only permission applies only to controls.
  if (!giftCalculatorState.on) return;
  const locked = (currentRoom && currentRoom.lockedSeats) || [];
  const seats = (currentRoom && currentRoom.seats) || [];
  seats.forEach((seat, i) => {
    // Only an occupied, unlocked seat gets the tiny calculator indicator.
    if (!seat || locked.includes(i + 1)) return;
    const seatEl = document.querySelector(`#seat-grid .seat:nth-child(${i + 1})`);
    if (!seatEl) return;
    const badge = document.createElement("span");
    badge.className = "gift-calculator-badge";
    const icon = document.createElement("img");
    icon.className = "gift-calculator-badge-icon";
    icon.src = "/images/icons/gift-calculator-seat-icon.png";
    icon.alt = "";
    icon.draggable = false;
    icon.setAttribute("aria-hidden", "true");
    const value = Number(giftCalculatorState.totals?.[i] || 0);
    const text = document.createElement("span");
    text.className = "gift-calculator-badge-value";
    text.textContent = formatGiftCalculatorValue(value);
    badge.append(icon, text);
    seatEl.appendChild(badge);
  });
}

function setGiftCalculatorState(data) {
  if (!data) return;
  giftCalculatorState = {
    on: !!data.on,
    totals: Array.isArray(data.totals) ? Array.from({ length: 12 }, (_, i) => Math.max(0, Number(data.totals[i]) || 0)) : Array(12).fill(0)
  };
  syncGiftCalculatorPowerUi();
  renderGiftCalculatorIndicators();
}

function syncGiftCalculatorPowerUi() {
  const on = !!giftCalculatorState.on;
  const canControl = canManageGiftCalculator();
  $("btn-gift-calculator-on")?.classList.toggle("is-on", on);
  $("btn-gift-calculator-off")?.classList.toggle("is-off", !on);
  $("btn-gift-calculator-on")?.setAttribute("aria-pressed", String(on));
  $("btn-gift-calculator-off")?.setAttribute("aria-pressed", String(!on));

  // The modal itself is owner/admin-only, but keep the control layer fail-safe:
  // ordinary users can never operate Reset/Close/ON/OFF even if a stale DOM
  // state or a future UI path exposes the sheet.
  ["btn-gift-calculator-on","btn-gift-calculator-off","btn-gift-calculator-reset","btn-gift-calculator-close","btn-gift-calculator-x","gift-calculator-handle"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = !canControl;
    el.setAttribute("aria-disabled", String(!canControl));
  });
}

function openGiftCalculatorModal() {
  if (!canManageGiftCalculator()) { toast("Only the room owner/admin can use Gift Calculator"); return; }
  closeAllPanels("gift-calculator-modal");
  $("room-more-menu")?.classList.add("hidden");
  $("gift-calculator-modal")?.classList.remove("hidden");
  $("gift-calculator-modal")?.setAttribute("aria-hidden", "false");
  syncGiftCalculatorPowerUi();
  // Opening/reopening the panel never changes ON/OFF state.
  socket.emit("gift-calculator-open", { roomId: currentRoomId });
}

function closeGiftCalculatorModal(sendServer = false) {
  const modal = $("gift-calculator-modal");
  if (modal) { modal.classList.add("hidden"); modal.setAttribute("aria-hidden", "true"); }
  // IMPORTANT: Close only hides the panel. Calculator state and seat totals
  // stay alive until the user explicitly presses OFF or leaves the room.
  syncGiftCalculatorPowerUi();
}

function setGiftCalculatorPower(on) {
  if (!canManageGiftCalculator() || !currentRoomId) return;
  socket.emit("gift-calculator-set", { roomId: currentRoomId, on: !!on });
}

function resetGiftCalculator() {
  if (!canManageGiftCalculator()) return;
  socket.emit("gift-calculator-reset", { roomId: currentRoomId });
}

function renderPartyOwnerSeat(room) {
  const wrap = $("party-owner-seat");
  if (!wrap) return;
  const honorSeat = Array.isArray(room?.seats) ? room.seats[0] : null;
  const occupantId = String(honorSeat?.userId || "");
  const name = honorSeat?.userName || "Honor Seat";
  const photo = honorSeat?.userPhoto || "";
  const avatar = $("party-owner-avatar");
  const nameEl = $("party-owner-name");
  const idEl = $("party-owner-id");
  const canUseHonor = !!(me && (String(me.userId) === String(room?.hostId || "") || (room?.adminIds || []).map(String).includes(String(me.userId))));
  if (nameEl) nameEl.textContent = name;
  if (idEl) idEl.textContent = honorSeat ? `ID: ${occupantId}` : "Owner / Admin Only";
  if (avatar) {
    avatar.classList.toggle("is-empty", !honorSeat);
    avatar.innerHTML = photo
      ? `<img src="${escapeHtml(photo)}" alt="" draggable="false">`
      : `<span class="party-owner-placeholder">⌂</span>`;
  }
  wrap.dataset.userId = occupantId;
  wrap.classList.toggle("is-live", !!honorSeat);
  wrap.classList.toggle("is-admin-access", canUseHonor);
  wrap.setAttribute("aria-label", canUseHonor ? (honorSeat ? "Honor seat occupied" : "Take Honor Seat") : "Honor seat reserved for room owner and admins");
  wrap.onclick = () => {
    if (!currentRoomId) return;
    if (!honorSeat) {
      if (canUseHonor) socket.emit("take-seat", { roomId: currentRoomId, seatNumber: 1 });
      else toast("Honor Seat is reserved for the room owner/admins");
      return;
    }
    if (String(honorSeat.userId) === String(me?.userId || "")) {
      socket.emit("leave-seat", { roomId: currentRoomId });
      return;
    }
    openSeatProfileSheet(honorSeat.userId, 1);
  };
}

function updatePartyRoomQuickbar(room) {
  const online = Array.isArray(room?.onlineUsers) ? room.onlineUsers.length : 0;
  const score = $("party-room-score");
  const ping = $("party-room-ping");
  if (score) score.textContent = online.toLocaleString();
  try {
    const ann = $("room-announcement-text");
    if (ann) {
      const t = String(room?.announcement || room?.roomAnnouncement || room?.notice || "").trim();
      ann.textContent = t || "🙂🙂🙂🙂";
    }
    const invite = $("btn-room-mic-invite");
    if (invite) invite.classList.toggle("hidden", mySeatNumber != null);
  } catch (_) {}
  if (ping) ping.textContent = "LIVE";
}

function renderSeats(seats) {
  renderPartyOwnerSeat(currentRoom);
  updatePartyRoomQuickbar(currentRoom);
  const grid = $("seat-grid");
  grid.innerHTML = "";
  renderCs101Seat();
  initCs101Ui();
  const locked = (currentRoom && currentRoom.lockedSeats) || [];
  seats.forEach((seat, i) => {
    const seatNumber = i + 1;
    // All 12 physical seats are now regular voice seats in the same grid.
    const isLocked = locked.includes(seatNumber);
    const div = document.createElement("div");
    div.className = "seat" + (seat ? " occupied" : "") + (isLocked ? " locked" : "") +
      (seat && (speakingUsers.has(String(seat.userId)) || musicUsers.has(String(seat.userId))) ? " speaking" : "");
    if (seat) div.dataset.userId = seat.userId;
    const circle = document.createElement("div");
    circle.className = "seat-circle";
    if (seat) {
      const voiceFx = document.createElement("div");
      voiceFx.className = "seat-voice-effects";
      voiceFx.setAttribute("aria-hidden", "true");
      const goldFx = document.createElement("span");
      goldFx.className = "voice-fx-gold";
      const fireFx = document.createElement("span");
      fireFx.className = "voice-fx-fire";
      const waterFx = document.createElement("span");
      waterFx.className = "voice-fx-water";
      voiceFx.append(goldFx, fireFx, waterFx);
      circle.appendChild(voiceFx);
      const photoWrap = document.createElement("div");
      photoWrap.className = "seat-avatar-photo";
      const img = document.createElement("img");
      img.src = seat.userPhoto || placeholderAvatar(seat.userName);
      photoWrap.appendChild(img);
      circle.appendChild(photoWrap);
      if (seat.vipLevel > 0) applyFrameRing(circle, seat.vipLevel);
      applyCustomFrame(circle, seat.activeFrame);
      if (seat.micMuted) {
        const muteBadge = document.createElement("img");
        muteBadge.className = "seat-mic-muted";
        muteBadge.src = "/images/icons/icon-mic-muted-pdf.png";
        muteBadge.alt = "Muted";
        div.style.position = "relative";
        div.appendChild(muteBadge);
      }
      // Premium badges (Blue Diamond V etc., admin-granted only — see
      // badges.js). Small 16px overlay, top-right above the avatar,
      // absolutely-positioned on `div` (position:relative set below).
      if (seat.activeBadges && seat.activeBadges.includes("blue_diamond_v")) {
        const blueBadge = document.createElement("img");
        blueBadge.className = "seat-blue-badge";
        blueBadge.src = "/images/badges/blue_diamond_v.png";
        blueBadge.alt = "Blue Diamond V";
        const cfg = badgeCatalogCache.blue_diamond_v;
        if (cfg && cfg.seatSize) { blueBadge.style.width = cfg.seatSize + "px"; blueBadge.style.height = cfg.seatSize + "px"; }
        div.style.position = "relative";
        div.appendChild(blueBadge);
      }
    } else if (isLocked) {
      const lockIcon = document.createElement("img");
      lockIcon.className = "seat-lock-icon";
      lockIcon.src = "/images/icons/icon-seat-lock.png";
      lockIcon.alt = "Locked";
      circle.appendChild(lockIcon);
    } else {
      // Empty seats use the supplied microphone artwork instead of the old
      // plus sign. The seat circle itself stays the same compact glass
      // diameter used for occupied profiles.
      const micIcon = document.createElement("img");
      micIcon.className = "seat-empty-mic-icon";
      micIcon.src = "/images/icons/seat-mic-empty.png";
      micIcon.alt = "Join seat";
      micIcon.draggable = false;
      micIcon.decoding = "async";
      circle.appendChild(micIcon);
    }
    div.appendChild(circle);
    const nameEl = document.createElement("span");
    nameEl.className = "seat-name";
    applyProfileNameEffect(nameEl, seat);
    nameEl.textContent = seat ? seat.userName : (seatNumber === 1 ? "Host" : ("No." + seatNumber));
    if (seat && seat.secretLord) {
      const lordEl = document.createElement("span");
      lordEl.className = "svip-secret-lord-tag";
      lordEl.textContent = "SVIP11 • Secret Lord";
      div.appendChild(lordEl);
    }
    // Name color is text-only. Custom tag colors are intentionally not
    // allowed to override the premium profile-name effect.
    div.appendChild(nameEl);
    // Active Agency is intentionally NOT rendered under a room seat.
    // The agency asset remains available on profile/home surfaces, while
    // the seat shows only the user's name (plus the existing avatar/frame).
    if (seat && seat.customTag && seat.customTag.text) {
      const tagEl = document.createElement("span");
      applyCustomTag(tagEl, seat.customTag, true);
      div.appendChild(tagEl);
    }
    if (seat && seat.modLabel && seat.modLabel.text) {
      const labelEl = document.createElement("span");
      labelEl.className = "tag-badge tag-badge-sm";
      labelEl.style.background = seat.modLabel.color || "#F7CE7E";
      labelEl.style.color = tagTextColor(seat.modLabel.color);
      labelEl.textContent = seat.modLabel.text;
      div.appendChild(labelEl);
    }

    div.addEventListener("click", () => {
      if (!seat) {
        const isOwner = currentRoom && currentRoom.hostId === me.userId;
        const isAdmin = currentRoom && (currentRoom.adminIds || []).includes(me.userId);
        if (isOwner || isAdmin) {
          openEmptySeatManagePopup(seatNumber);
        } else {
          socket.emit("take-seat", { roomId: currentRoomId, seatNumber });
        }
      } else {
        openSeatProfileSheet(seat.userId, seatNumber);
      }
    });
    grid.appendChild(div);
  });
  renderRelationshipLinks((currentRoom && currentRoom.relationshipLinks) || currentRelationshipLinks || []);
  updateSeatVoiceEffects();
  renderGiftCalculatorIndicators();
}

function voiceEffectTier(seat) {
  const vip = Math.max(0, Number(seat?.vipLevel) || 0);
  const svip = Math.max(0, Number(seat?.svipLevel) || 0);
  // Every VIP/SVIP gets the same three premium visual families. The dominant
  // family changes by tier so higher-status users still feel distinct without
  // locking the product to a single colour.
  if (svip > 0) return ((svip - 1) % 3) + 1;
  if (vip > 0) return ((vip - 1) % 3) + 1;
  return 0;
}

function updateSeatVoiceEffects() {
  const seats = document.querySelectorAll("#view-room .seat[data-user-id]");
  seats.forEach((seatEl) => {
    const userId = String(seatEl.dataset.userId || "");
    if (!userId) return;
    const seat = seatMap[userId] || Object.values(seatMap).find((x) => x && String(x.userId) === userId);
    const level = Math.max(0, Math.min(1, Number(voiceLevels.get(userId)) || 0));
    const tier = voiceEffectTier(seat);
    const active = tier > 0 && speakingUsers.has(userId) && level > 0.02;
    seatEl.classList.toggle("voice-fx-active", active);
    const circle = seatEl.querySelector(".seat-circle");
    const fx = seatEl.querySelector(".seat-voice-effects");
    if (!circle || !fx) return;
    const levelText = active ? level.toFixed(3) : "0";
    circle.style.setProperty("--voice-level", levelText);
    fx.style.setProperty("--voice-level", levelText);
    fx.style.setProperty("--voice-scale", active ? (0.94 + level * 0.10).toFixed(3) : "0.94");
    fx.style.setProperty("--voice-rise", active ? (-8 - level * 18).toFixed(1) + "px" : "-8px");
    fx.dataset.effectTier = String(tier);
  });
}

function cpShowcaseSeatNumberForRelationship(userId) {
  if (!currentRoom || !Array.isArray(currentRoom.seats)) return null;
  const idx = currentRoom.seats.findIndex((seat) => seat && String(seat.userId) === String(userId));
  return idx >= 0 ? idx + 1 : null;
}

function renderRelationshipLinks(links) {
  const grid = $("seat-grid");
  if (!grid) return;
  currentRelationshipLinks = Array.isArray(links) ? links : [];
  const old = grid.querySelector(".relationship-link-layer");
  if (old) old.remove();
  if (!currentRelationshipLinks.length) return;
  const layer = document.createElement("div");
  layer.className = "relationship-link-layer";
  grid.appendChild(layer);
  const gridRect = grid.getBoundingClientRect();
  currentRelationshipLinks.forEach((rel) => {
    // DEFENSE IN DEPTH (spec section 4 — "the client should also
    // defensively ignore invalid/non-adjacent relationship links"): the
    // server already only emits adjacent links (friendshipCp.js
    // getSeatRelationshipLinks -> areAdjacentSeats), but the client never
    // trusts that alone. A stale/duplicate/malformed link is dropped here
    // too rather than rendered.
    if (!clientAreAdjacentSeats(rel.seatA, rel.seatB)) return;
    const a = grid.querySelector(`.seat:nth-child(${rel.seatA})`);
    const b = grid.querySelector(`.seat:nth-child(${rel.seatB})`);
    if (!a || !b) return;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const ax = ar.left + ar.width / 2 - gridRect.left;
    const ay = ar.top + ar.height / 2 - gridRect.top;
    const bx = br.left + br.width / 2 - gridRect.left;
    const by = br.top + br.height / 2 - gridRect.top;
    const x = (ax + bx) / 2;
    const y = (ay + by) / 2 - Math.min(10, Math.abs(bx - ax) * 0.02);
    const img = document.createElement("img");
    img.className = "relationship-link " + (rel.type === "cp" ? "cp" : "friendship");
    const cfg = rel.type === "cp" ? relationshipVisualConfig.cp : relationshipVisualConfig.friendship;
    img.src = cfg.assetUrl;
    img.alt = rel.type === "cp" ? "CP" : "Friendship";
    // Offset applied directly to position (not via CSS transform) so it
    // can never fight with the float keyframe's own transform. Scale is
    // set as a per-element CSS variable so the shared float keyframe can
    // multiply it in correctly regardless of type — see style.css.
    img.style.left = (x + (cfg.offsetX || 0)) + "px";
    img.style.top = (y + (cfg.offsetY || 0)) + "px";
    img.style.setProperty("--rel-scale", cfg.scale != null ? cfg.scale : 1);
    if (rel.type === "cp") {
      img.style.pointerEvents = "auto";
      img.style.cursor = "pointer";
      img.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const targetId = String(me?.userId || "") === String(rel.userA) ? rel.userB : rel.userA;
        const targetSeat = cpShowcaseSeatNumberForRelationship(targetId);
        if (targetId && targetSeat && typeof openSeatProfileSheet === "function") {
          await openSeatProfileSheet(targetId, targetSeat);
        }
      });
    }
    layer.appendChild(img);
  });
}

// ---------------- CP/Friendship visual config (Admin Panel controlled) ----------------
// Mirrors seatAdjacency.js's grid topology on the client, so a stale/bad
// link from the server (or from an older cached room-state) can never
// render a heart between non-adjacent seats — see the defensive check in
// renderRelationshipLinks above. Kept in sync with the server's
// RELATIONSHIP_SEAT_GRID_COLUMNS default (4); the server is the source of
// truth, this is only a client-side safety net.
const RELATIONSHIP_SEAT_GRID_COLUMNS = 4;
function clientAreAdjacentSeats(seatA, seatB) {
  const a = Number(seatA), b = Number(seatB);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a === b) return false;
  const rowA = Math.floor((a - 1) / RELATIONSHIP_SEAT_GRID_COLUMNS), colA = (a - 1) % RELATIONSHIP_SEAT_GRID_COLUMNS;
  const rowB = Math.floor((b - 1) / RELATIONSHIP_SEAT_GRID_COLUMNS), colB = (b - 1) % RELATIONSHIP_SEAT_GRID_COLUMNS;
  const rowDiff = Math.abs(rowA - rowB), colDiff = Math.abs(colA - colB);
  return (rowDiff === 0 && colDiff === 1) || (colDiff === 0 && rowDiff === 1);
}

let relationshipVisualConfigLoaded = false;
let relationshipVisualConfig = {
  version: 0,
  cp: { width: 40, height: 40, scale: 1, opacity: 0.98, animationEnabled: true, animationSpeedSec: 2.1, offsetX: 0, offsetY: 0, assetUrl: "/images/relationships/cp-heart.png" },
  friendship: { width: 40, height: 40, scale: 1, opacity: 0.98, animationEnabled: true, animationSpeedSec: 2.4, offsetX: 0, offsetY: 0, assetUrl: "/images/relationships/friendship-heart.png" }
};

function applyRelationshipVisualConfig(config) {
  if (!config || !config.cp || !config.friendship) return;
  relationshipVisualConfig = config;
  relationshipVisualConfigLoaded = true;
  const root = document.documentElement.style;
  ["cp", "friendship"].forEach((kind) => {
    const c = config[kind];
    root.setProperty(`--${kind}-width`, c.width + "px");
    root.setProperty(`--${kind}-height`, c.height + "px");
    root.setProperty(`--${kind}-opacity`, c.opacity);
    root.setProperty(`--${kind}-anim-duration`, c.animationEnabled ? (c.animationSpeedSec + "s") : "0s");
  });
  // Config (size/opacity/asset/etc.) changed — re-render any currently
  // visible hearts so an admin's change is reflected immediately (TEST 9,
  // TEST 11) without needing a seat change to trigger a re-render.
  if (currentRoom) renderRelationshipLinks(currentRelationshipLinks);
}

async function fetchRelationshipVisualConfig() {
  try {
    const r = await api("/api/relationships/config");
    if (r && r.success && r.config) applyRelationshipVisualConfig(r.config);
  } catch (err) {
    console.error("[relationship-config] fetch failed:", err);
  }
}

window.addEventListener("resize", () => {
  if (currentRoom && currentRoomId) renderRelationshipLinks((currentRoom && currentRoom.relationshipLinks) || currentRelationshipLinks);
});

// ---------------- Chat ----------------
const CHAT_MESSAGE_TTL_MS = 60 * 1000;

// ROOT-CAUSE FIX (duplicate chat message render): the server issues a
// unique `id` per message specifically so the client can dedupe strictly
// by id instead of guessing by content (see performSendMessage() in
// server.js). This tracks which message ids are currently rendered in
// #chat-log so a duplicate "new-message" delivery (socket reconnect
// resend, a forwarded cross-instance op retried, etc.) never produces a
// second UI item for the same message.
const renderedChatMsgIds = new Set();

function renderChatLog(messages) {
  const log = $("chat-log");
  log.innerHTML = "";
  renderedChatMsgIds.clear();
  const now = Date.now();
  const visible = (Array.isArray(messages) ? messages : []).filter((msg) => {
    if (!msg || !msg.createdAt) return true;
    return now - Number(msg.createdAt) < CHAT_MESSAGE_TTL_MS;
  });
  log.classList.toggle("empty", visible.length === 0);
  visible.forEach(appendChatMsg);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

const MAX_VISIBLE_MESSAGES = 30;

// BOTTOM-UP ACTIVITY FEED (chat + gifts share this one flow):
// generalized expiry helper — any entry (chat line or gift notice) fades
// out and is removed after `ttlMs` from `createdAt` (defaults to "now",
// which is what gift notices — which have no server createdAt — use).
// Kept as one shared implementation so chat and gifts age out identically
// and neither can leak a stray setTimeout/DOM node.
function scheduleActivityExpiry(div, createdAt, ttlMs, onExpire) {
  createdAt = Number(createdAt || Date.now());
  const remaining = ttlMs - (Date.now() - createdAt);
  if (remaining <= 0) {
    div.remove();
    if (onExpire) onExpire();
    return;
  }
  div.dataset.expiresAt = String(createdAt + ttlMs);
  window.setTimeout(() => {
    if (!div.isConnected) return;
    div.classList.add("chat-msg-expiring");
    window.setTimeout(() => {
      div.remove();
      if (onExpire) onExpire();
      const log = $("chat-log");
      if (log && !log.children.length) log.classList.add("empty");
    }, 260);
  }, remaining);
}

function scheduleChatExpiry(div, msg) {
  if (!msg || !msg.createdAt) return; // no createdAt (older persisted rows) — never auto-expire, same as before this refactor
  scheduleActivityExpiry(div, msg.createdAt, CHAT_MESSAGE_TTL_MS, () => {
    if (msg && msg.id != null) renderedChatMsgIds.delete(msg.id);
  });
}

// §7-10: normal chat renders as a single notification-style line ("Name:
// message"), not a left/right WhatsApp-style bubble — the room's bottom-up
// activity feed (below) is the only presentation now. The container
// (#chat-log), its bottom-anchored stacking/scroll, its 60s TTL and its
// duplicate-delivery dedupe are untouched from before this change.
function appendChatMsg(msg) {
  if (msg && msg.id != null) {
    if (renderedChatMsgIds.has(msg.id)) return; // duplicate delivery — already rendered
    renderedChatMsgIds.add(msg.id);
  }
  const log = $("chat-log");
  log.classList.remove("empty");
  const div = document.createElement("div");
  const isMine = !msg.system && me && String(msg.userId) === String(me.userId);
  div.className = "chat-msg activity-line" + (msg.system ? " system" : "") + (isMine ? " mine" : "");
  if (msg.system) {
    div.innerHTML = `<span class="chat-system-pill">${escapeHtml(msg.message)}</span>`;
  } else {
    const tag = (msg.customTag && msg.customTag.text) ? msg.customTag : (typeof msg.customTag === "string" ? { text: msg.customTag, color: "#F7CE7E" } : null);
    const tagHtml = tag?.text
      ? `<span class="tag-badge tag-badge-sm chat-floating-tag" style="background:${escapeHtml(tag.color || "#F7CE7E")};color:${tagTextColor(tag.color)}">${escapeHtml(tag.text)}</span>`
      : "";
    const agencyHtml = msg.agencyBadge
      ? `<img class="chat-agency-badge" src="${escapeHtml(msg.agencyBadge.imageUrl || "/images/badges/active-agency.png")}" alt="${escapeHtml(msg.agencyBadge.text || "Active Agency")}">`
      : "";
    const nameClass = (msg.nameEffect === "premium_gradient") ? " name-fx-premium-gradient" : "";
    // Reference-style compact identity: name + ID + level on one line,
    // then the message below. No legacy chat-bubble metadata is shown.
    div.innerHTML = `
      <div class="activity-pill message-identity-pill">
        <div class="chat-identity-line">
          <span class="chat-user-name${nameClass}">${escapeHtml(msg.userName || "User")}</span>
          ${agencyHtml}
          <span class="chat-user-id">ID: ${escapeHtml(msg.userId || "—")}</span>
          <span class="chat-user-level">LV.${Number(msg.userLevel || 1)}</span>
        </div>
        <div class="chat-message-line">${escapeHtml(msg.message)}</div>
      </div>`;
  }
  if (msg && msg.id != null) div.dataset.msgId = String(msg.id);
  log.appendChild(div);

  while (log.children.length > MAX_VISIBLE_MESSAGES) {
    const oldest = log.firstChild;
    if (oldest && oldest.dataset && oldest.dataset.msgId != null) renderedChatMsgIds.delete(oldest.dataset.msgId);
    log.removeChild(oldest);
  }
  scheduleChatExpiry(div, msg);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

// §12-13: gift activity shares the exact same bottom-up feed/container as
// chat (#chat-log) — same entry animation, same upward stacking, same
// auto-expiry — per spec "gift and chat must share the same flow". This
// never touches the full-screen video-gift-overlay (§14): that overlay is
// a separate, higher-stacked layer (z-index 9999 vs. this feed's 1, see
// style.css) that already fully covers it while a special/video gift is
// playing, so a normal gift notice here can never appear drawn over it.
const GIFT_NOTICE_TTL_MS = 10000;
// Display-only mirror of roomEvents.js's HIGH_VALUE_GIFT_THRESHOLD — used
// here purely to decide whether the chat notice also shows the diamond
// value line (§4 example: small gifts show "sent Rose to Ritu", big gifts
// additionally show "💎 100,000 Diamonds"). This has zero bearing on the
// actual High-Value Gift flyout, which is entirely server-decided and
// delivered separately via the "room-event" socket event below.
const GIFT_NOTICE_VALUE_DISPLAY_THRESHOLD = 100000;
function appendGiftMsg(data) {
  if (!data || !data.gift) return;

  // Premium room-wide gift receive banner. It uses only the live gift event
  // data already emitted by the server — no hardcoded names or screenshot data.
  try {
    const mention = $("room-gift-mention");
    if (mention) {
      const qty = Math.max(1, Number(data.quantity || 1));
      const icon = data.gift.image || data.gift.icon || data.gift.thumbnail || "";
      const unitValue = Math.max(0, Number(data.gift.price || data.gift.value || 0));
      const totalValue = unitValue * qty;
      mention.innerHTML = `
        <div class="room-gift-mention-main">
          <div class="room-gift-mention-userline">
            <strong>${escapeHtml(data.fromName || "User")}</strong>
            <span>sent a gift to</span>
            <b>@${escapeHtml(data.toName || "User")}</b>
          </div>
          <div class="room-gift-mention-idline">ID ${escapeHtml(data.fromUserId || "—")} → ID ${escapeHtml(data.toUserId || "—")}</div>
          <div class="room-gift-mention-giftline">
            ${icon
              ? `<img class="room-gift-mention-icon" src="${escapeHtml(icon)}" alt="">`
              : `<span class="room-gift-mention-icon-fallback">🎁</span>`}
            <span class="room-gift-mention-name">${escapeHtml(data.gift.name || "Gift")}</span>
            <span class="room-gift-mention-qty">×${qty}</span>
            ${totalValue ? `<strong class="room-gift-mention-value">+${totalValue.toLocaleString()}</strong>` : ""}
          </div>
        </div>`;
      mention.classList.remove("hidden");
      mention.classList.remove("show");
      void mention.offsetWidth;
      mention.classList.add("show");
      clearTimeout(window.__roomGiftMentionTimer);
      window.__roomGiftMentionTimer = setTimeout(() => {
        mention.classList.remove("show");
        setTimeout(() => mention.classList.add("hidden"), 180);
      }, 4200);
    }
  } catch (e) { console.error("[gift-mention] render failed", e); }

  // The old gift chat bubble was a second, unrelated gift-flow UI. The
  // dedicated sender→receiver flight + receive card above is now the single
  // normal-gift presentation, so do not append the legacy chat notice.
  return;

  const log = $("chat-log");
  if (!log) return;
  log.classList.remove("empty");
  const div = document.createElement("div");
  div.className = "chat-msg activity-line gift-notice";
  const qty = Number(data.quantity || 1);
  const giftIcon = data.gift.image || data.gift.icon || data.gift.thumbnail || "";
  const iconHtml = giftIcon ? `<img class="gift-notice-icon" src="${escapeHtml(giftIcon)}" alt="">` : `<span class="gift-notice-icon">🎁</span>`;
  // BUG FIX (spec 2026-08-29 §4): gift chat notices previously omitted
  // sender/receiver names entirely, so the room chat gave no way to tell
  // who a gift was sent to even though the transaction itself (coin
  // deduct, diamond credit) was working correctly. Every gift now shows
  // "Sender -> Receiver: Gift" using the .who/.gift-notice-arrow classes
  // that already existed in style.css for exactly this purpose.
  const totalValue = Number(data.gift.price || data.gift.value || 0) * qty;
  const valueHtml = totalValue >= GIFT_NOTICE_VALUE_DISPLAY_THRESHOLD
    ? `<span class="gift-notice-value">💎 ${totalValue.toLocaleString()}</span>`
    : "";
  div.innerHTML = `
    <div class="activity-pill gift-pill">
      <span class="gift-sender">${escapeHtml(data.fromName || "User")}</span>
      <span class="gift-sent-label">sent to</span>
      <span class="who gift-recipient">@${escapeHtml(data.toName || "User")}</span><span class="gift-id-route">ID ${escapeHtml(data.fromUserId || "—")} → ${escapeHtml(data.toUserId || "—")}</span>
      <span class="gift-notice-arrow">•</span>
      ${iconHtml}
      <span class="chat-text">${escapeHtml(data.gift.name || "Gift")}${qty > 1 ? ` ×${qty}` : " ×1"}</span>
      ${valueHtml}
    </div>`;
  log.appendChild(div);
  while (log.children.length > MAX_VISIBLE_MESSAGES) {
    const oldest = log.firstChild;
    if (oldest && oldest.dataset && oldest.dataset.msgId != null) renderedChatMsgIds.delete(oldest.dataset.msgId);
    log.removeChild(oldest);
  }
  scheduleActivityExpiry(div, Date.now(), GIFT_NOTICE_TTL_MS);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

// ===========================================================================
// ROOM EVENT NOTIFICATIONS — High-Value Gift & Big Win flyouts
// (spec 2026-08-29 "PingPong High-Value Gift & Big-Win Room Notification
// System"). Purely presentational: the server has already validated and
// committed the underlying gift/game transaction before this event is
// ever emitted (see server.js send-gift handler / fwResolveSpin). This
// code never trusts anything about amounts/thresholds from the payload
// beyond what to *display* — it doesn't re-derive or enforce them.
// ===========================================================================
const roomEventSeenIds = new Set(); // §11 duplicate-eventId guard
const ROOM_EVENT_SEEN_MAX = 200;
const roomEventQueue = []; // §12 lightweight client-side animation queue
let roomEventShowing = false;

function handleRoomEvent(evt) {
  if (!evt || !evt.eventId || !evt.roomId) return;
  if (roomEventSeenIds.has(evt.eventId)) return; // duplicate delivery — never re-animate
  roomEventSeenIds.add(evt.eventId);
  if (roomEventSeenIds.size > ROOM_EVENT_SEEN_MAX) {
    // Trim oldest half rather than growing unbounded for a long room session.
    const it = roomEventSeenIds.values();
    for (let i = 0; i < ROOM_EVENT_SEEN_MAX / 2; i++) roomEventSeenIds.delete(it.next().value);
  }
  // BIG_WIN is treated as higher priority than HIGH_VALUE_GIFT when both
  // are queued at once (§12 "High-value events-এর priority normal
  // events-এর চেয়ে বেশি"), so it jumps ahead of any already-queued gift
  // flyouts but never interrupts one already on screen.
  if (evt.type === "BIG_WIN") {
    const firstGiftIdx = roomEventQueue.findIndex((q) => q.type !== "BIG_WIN");
    if (firstGiftIdx === -1) roomEventQueue.push(evt); else roomEventQueue.splice(firstGiftIdx, 0, evt);
  } else {
    roomEventQueue.push(evt);
  }
  drainRoomEventQueue();
}

function drainRoomEventQueue() {
  if (roomEventShowing || !roomEventQueue.length) return;
  roomEventShowing = true;
  const evt = roomEventQueue.shift();
  showRoomEventFlyout(evt, () => {
    roomEventShowing = false;
    drainRoomEventQueue();
  });
}

function roomEventFlyoutLayer() {
  let layer = document.getElementById("room-event-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "room-event-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

function showRoomEventFlyout(evt, onDone) {
  const layer = roomEventFlyoutLayer();
  const card = document.createElement("div");
  card.className = "room-event-card " + (evt.type === "BIG_WIN" ? "room-event-bigwin" : "room-event-gift");
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");

  if (evt.type === "BIG_WIN") {
    card.innerHTML = `
      <div class="room-event-title">🏆 BIG WIN</div>
      <div class="room-event-body">${escapeHtml(evt.player && evt.player.name || "Someone")} won <b>${Number(evt.amount || 0).toLocaleString()}</b></div>
      ${evt.roomName ? `<div class="room-event-sub">🎉 in ${escapeHtml(evt.roomName)}</div>` : ""}`;
  } else {
    const iconHtml = evt.gift && evt.gift.icon ? `<img class="room-event-gift-icon" src="${escapeHtml(evt.gift.icon)}" alt="">` : "🎁";
    card.innerHTML = `
      <div class="room-event-title">${iconHtml} Gift Celebration</div>
      <div class="room-event-body">${escapeHtml(evt.sender && evt.sender.name || "")} → ${escapeHtml(evt.receiver && evt.receiver.name || "")}</div>
      <div class="room-event-sub">${escapeHtml(evt.gift && evt.gift.name || "")} · 💎 ${Number(evt.gift && evt.gift.value || 0).toLocaleString()}</div>`;
  }

  const duration = Number(evt.displayDurationMs) > 0 ? Number(evt.displayDurationMs) : 5000;
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    card.classList.add("room-event-exit");
    window.setTimeout(() => { card.remove(); if (onDone) onDone(); }, 260);
  };
  const activate = () => { dismiss(); navigateToRoomEvent(evt); };
  card.addEventListener("click", activate);
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") activate(); });

  layer.appendChild(card);
  window.setTimeout(dismiss, duration);
}

// Notification tap → target room. Target room ID always comes from the
// server-generated event payload (evt.roomId), never hard-coded (§9).
// Reuses the existing joinRoom() flow, which already: no-ops if already
// in that exact room, safely leaves the current room otherwise, and
// carries the existing Agora/voice-SFU lifecycle + auth/session through
// the switch (§3/§7/§15) — no separate navigation path is needed.
async function navigateToRoomEvent(evt) {
  if (!evt || !evt.roomId) return;
  try {
    if (currentRoomId === evt.roomId && joinedRoomId === evt.roomId) {
      showView("view-room");
      return;
    }
    await joinRoom(evt.roomId);
  } catch (e) {
    console.error("room-event: navigation failed", e);
    toast("Couldn't open that room");
  }
}

$("btn-send-chat").addEventListener("click", sendChat);
$("chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
function syncChatSendButton() {
  const input = $("chat-input");
  const bar = document.querySelector("#view-room .room-toolbar");
  if (input && bar) bar.classList.toggle("has-text", !!input.value.trim());
}
$("chat-input").addEventListener("input", syncChatSendButton);
// Keep keyboard/focus on the input when tapping Send so the button is not
// hidden mid-tap (it used to exist only while the input had focus).
$("btn-send-chat").addEventListener("pointerdown", (e) => e.preventDefault());
function sendChat() {
  const input = $("chat-input");
  const message = input.value.trim();
  if (!message) return;
  if (!currentRoomId) { toast("Join a room first"); return; }
  if (!socket || !socket.connected) { toast("Reconnecting… please send again in a moment"); return; }
  socket.emit("send-message", { roomId: currentRoomId, message });
  input.value = "";
  syncChatSendButton();
}


function pushGiftBanner(_text) {
  // Intentionally disabled: gift sends are represented by the animation only.
  const banner = $("gift-banner");
  if (banner) banner.innerHTML = "";
}


// Floating gift animation across the stage — its own absolute layer,
// never touches seat-grid layout/dimensions. Flies from the sender's seat
// to the receiver's seat when both are seated, otherwise falls back to a
// simple center float so it never breaks for un-seated senders/receivers.
function seatCircleRect(userId) {
  const el = document.querySelector(`#seat-grid [data-user-id="${userId}"] .seat-circle`);
  if (!el) return null;
  return el.getBoundingClientRect();
}
// Combo tracking: keys off sender+receiver+gift so repeat-tapping the same
// gift at the same target inside the combo window shows an escalating
// "x2 / x3 / ..." badge instead of just stacking silent icons. Purely a
// presentation layer — doesn't touch the actual send/credit logic at all.
const GIFT_COMBO_WINDOW_MS = 2200;
const giftComboState = new Map();
function trackGiftCombo(gift, fromUserId, toUserId) {
  const key = `${fromUserId}_${toUserId}_${gift.id || gift.name}`;
  const now = Date.now();
  const prev = giftComboState.get(key);
  const count = prev && (now - prev.at) < GIFT_COMBO_WINDOW_MS ? prev.count + 1 : 1;
  giftComboState.set(key, { at: now, count });
  return count;
}
function spawnGiftComboBadge(count, end, layer) {
  if (count < 2) return;
  const badge = document.createElement("div");
  badge.className = "gift-combo-badge";
  badge.textContent = "x" + count;
  badge.style.left = end.x + "%";
  badge.style.top = end.y + "%";
  layer.appendChild(badge);
  setTimeout(() => badge.remove(), 750);
}
function spawnGiftFly(gift, fromUserId, toUserId, fromName, toName) {
  if (!roomEffectPrefs.giftEffect) return;
  const layer = $("gift-fly-layer");
  if (!layer) return;
  const tier = gift.tier || "normal";
  const layerRect = layer.getBoundingClientRect();
  const fromRect = seatCircleRect(fromUserId);
  const toRect = seatCircleRect(toUserId);

  const pct = (rect, fallbackX, fallbackY) => {
    if (!rect || !layerRect.width || !layerRect.height) return { x: fallbackX, y: fallbackY };
    const cx = rect.left + rect.width / 2 - layerRect.left;
    const cy = rect.top + rect.height / 2 - layerRect.top;
    return { x: (cx / layerRect.width) * 100, y: (cy / layerRect.height) * 100 };
  };
  const start = pct(fromRect, 50, 92);
  const end = pct(toRect, 50, 10);

  const qty = Math.max(1, Number(gift.quantity || 1));
  const unitPrice = Math.max(0, Number(gift.price || gift.value || 0));
  const isLargeGift = gift.effectType === "full_screen" || gift.tier === "legend" || unitPrice >= 100000;
  const qtyBurst = qty >= 1717 ? 12 : qty >= 777 ? 10 : qty >= 177 ? 8 : qty >= 77 ? 7 : qty >= 17 ? 5 : qty >= 7 ? 3 : 1;
  const trailCount = Math.max(qtyBurst, isLargeGift ? 4 : tier === "vip" ? 3 : 3);
  // Normal gifts now use the reference-style sender → receiver flight.
  // The old stationary/short pulse animation is intentionally retired.
  const duration = isLargeGift ? 0.92 : tier === "vip" ? 0.72 : 0.82;
  const iconHtml = gift.image ? `<img src="${escapeHtml(gift.image)}" alt="">` : "🎁";

  // A compact route label follows the gift from the sender ID to the receiver
  // ID. It is presentation-only; the server event remains authoritative.
  const meta = document.createElement("div");
  meta.className = "gift-fly-meta";
  meta.innerHTML = `<span>${escapeHtml(fromName || "User")} <small>ID ${escapeHtml(fromUserId || "-")}</small></span><b>→</b><span>${escapeHtml(toName || "User")} <small>ID ${escapeHtml(toUserId || "-")}</small></span>`;
  meta.style.left = ((start.x + end.x) / 2) + "%";
  meta.style.top = Math.max(7, ((start.y + end.y) / 2) - 4) + "%";
  meta.style.animationDuration = Math.min(1.5, Math.max(.9, duration + .25)) + "s";
  layer.appendChild(meta);
  setTimeout(() => meta.remove(), Math.max(900, (duration + .45) * 1000));

  // Staggered gift artwork creates the visible "gift flow"/trail. Each item
  // follows the same curved path, with the first item carrying the full-size
  // gift and the following items reading as a luminous trail.
  for (let i = 0; i < trailCount; i++) {
    const el = document.createElement("div");
    el.className = "gift-fly-item tier-" + tier + (i > 0 ? " gift-fly-trail" : "");
    el.innerHTML = iconHtml;
    el.style.setProperty("--start-x", start.x + "%");
    el.style.setProperty("--start-y", start.y + "%");
    el.style.setProperty("--end-x", end.x + "%");
    el.style.setProperty("--end-y", end.y + "%");
    el.style.animationDuration = duration + "s";
    el.style.animationDelay = (i * 0.075) + "s";
    if (i > 0) el.style.opacity = String(Math.max(0.13, 0.64 - i * 0.07));
    layer.appendChild(el);
    setTimeout(() => el.remove(), (duration + 0.75) * 1000);
  }

  // Golden sparkle/petal burst at the exact receiver position makes the
  // landing unmistakable without changing the seat/frame dimensions.
  const burstDelay = Math.max(120, duration * 1000 - 80);
  setTimeout(() => spawnGiftLandingBurst(end, layer), burstDelay);

  const comboCount = trackGiftCombo(gift, fromUserId, toUserId);
  const displayCount = qty > 1 ? qty : comboCount;
  setTimeout(() => spawnGiftComboBadge(displayCount, end, layer), duration * 1000 * 0.8);

  // Large gifts keep the existing full-screen celebration. Only the normal
  // gift route is replaced by the new flow; premium/full-screen effects are
  // intentionally left intact.
  if (isLargeGift && toUserId === me.userId) {
    spawnFullScreenGiftEffect(gift, { fromUserId, fromName, toUserId, toName });
  }
}

function spawnGiftLandingBurst(end, layer) {
  if (!layer) return;
  const burst = document.createElement("div");
  burst.className = "gift-landing-burst";
  burst.style.left = end.x + "%";
  burst.style.top = end.y + "%";
  const symbols = ["✦", "✧", "•", "✦", "✧", "•", "✦", "✧"];
  symbols.forEach((symbol, i) => {
    const p = document.createElement("span");
    p.textContent = symbol;
    p.style.setProperty("--burst-angle", ((Math.PI * 2 * i) / symbols.length) + "rad");
    p.style.setProperty("--burst-distance", (18 + (i % 3) * 8) + "px");
    burst.appendChild(p);
  });
  layer.appendChild(burst);
  setTimeout(() => burst.remove(), 850);
}

// Full-screen celebration for Full Screen Effect gifts — its own fixed
// overlay, completely separate from the room layout so it never resizes
// anything. Includes a large animation, particles, a flash, a shockwave
// ring, and a light camera shake, per the Gift Manager spec.
//
// Queued (2026-08-18 upgrade): back-to-back full-screen gifts used to share
// one timer, so a second legend/VIP gift landing mid-celebration would just
// cut the first one's animation off early. Now each full-screen gift is
// queued and gets its complete, uninterrupted run before the next one starts.
const legendGiftQueue = [];
let legendGiftPlaying = false;
function spawnFullScreenGiftEffect(gift, route = {}) {
  if (!roomEffectPrefs.giftEffect) return;
  legendGiftQueue.push({ gift, route });
  processLegendGiftQueue();
}
function processLegendGiftQueue() {
  if (legendGiftPlaying) return;
  const entry = legendGiftQueue.shift();
  if (!entry) return;
  const gift = entry.gift || entry;
  const route = entry.route || {};
  legendGiftPlaying = true;

  const overlay = $("legend-gift-overlay");
  if (!overlay) { legendGiftPlaying = false; processLegendGiftQueue(); return; }
  const tier = gift.tier || "legend";
  overlay.classList.toggle("overlay-tier-vip", tier === "vip");
  $("legend-gift-emoji").innerHTML = gift.image ? `<img src="${gift.image}" alt="">` : "🎁";
  const receiverLine = route.toName ? `To ${route.toName} · ID ${route.toUserId || "-"}` : "";
  const senderLine = route.fromName ? `From ${route.fromName} · ID ${route.fromUserId || "-"}` : "";
  $("legend-gift-text").innerHTML = `<strong>${escapeHtml(gift.name)} 🔥</strong><span>${escapeHtml(senderLine)}</span><span>${escapeHtml(receiverLine)}</span>`;

  // Flash — one-shot pulse, removed after its animation finishes.
  const flash = document.createElement("div");
  flash.className = "legend-flash";
  overlay.appendChild(flash);
  setTimeout(() => flash.remove(), 550);

  // Shockwave ring — a single expanding ring on impact, layered under the
  // particle burst for extra visual weight on the top gift tiers.
  const shockwave = document.createElement("div");
  shockwave.className = "legend-shockwave";
  overlay.appendChild(shockwave);
  setTimeout(() => shockwave.remove(), 750);

  // Particles — a small burst radiating outward from center (color themed
  // via .overlay-tier-vip in CSS).
  const particleCount = 18;
  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement("div");
    p.className = "legend-particle";
    const angle = (Math.PI * 2 * i) / particleCount + Math.random() * 0.3;
    const dist = 120 + Math.random() * 140;
    p.style.setProperty("--px", Math.cos(angle) * dist + "px");
    p.style.setProperty("--py", Math.sin(angle) * dist + "px");
    p.style.animationDelay = (Math.random() * 0.15) + "s";
    overlay.appendChild(p);
    setTimeout(() => p.remove(), 1700);
  }

  overlay.classList.remove("hidden");
  overlay.classList.remove("gift-shake");
  void overlay.offsetWidth; // restart the shake animation even on back-to-back gifts
  overlay.classList.add("show", "gift-shake");
  setTimeout(() => {
    overlay.classList.remove("show");
    setTimeout(() => {
      overlay.classList.add("hidden");
      legendGiftPlaying = false;
      processLegendGiftQueue(); // start the next queued gift, if any
    }, 300);
  }, 2400);
}

// Brief glow pulse on the receiver's seat the instant a gift lands.
function flashSeatReceive(userId) {
  const el = document.querySelector(`#seat-grid [data-user-id="${userId}"] .seat-circle`);
  if (!el) return;
  el.classList.add("gift-hit");
  setTimeout(() => el.classList.remove("gift-hit"), 900);
}

// Optional Gift Sound playback. Admin can attach an MP3 to any regular gift.
// We play at most once per logical send request on each client, so an
// All-Users send does not create a wall of duplicate sounds. Browser autoplay
// policy is respected: if playback is blocked, the visual gift flow still
// continues normally.
const playedGiftSoundRequests = new Map();
const GIFT_SOUND_DEDUPE_MS = 1800;
function playGiftSound(gift, requestId) {
  if (!roomEffectPrefs.giftSound) return;
  const url = gift && gift.sound;
  if (!url) return;
  const key = requestId || `${gift.id || gift.name}:${Date.now()}`;
  const now = Date.now();
  const prev = playedGiftSoundRequests.get(key);
  if (prev && now - prev < GIFT_SOUND_DEDUPE_MS) return;
  playedGiftSoundRequests.set(key, now);
  for (const [k, t] of playedGiftSoundRequests) if (now - t > 10000) playedGiftSoundRequests.delete(k);
  try {
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = 0.82;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
    audio.addEventListener("ended", () => { try { audio.remove(); } catch (_) {} }, { once: true });
  } catch (_) {}
}

async function loadGiftBanner(roomId) {
  const r = await api("/api/gifts/history?roomId=" + roomId);
  $("gift-banner").innerHTML = "";
  if (r.success) r.gifts.slice(0, 3).reverse().forEach(g => pushGiftBanner(`${g.fromName} sent 🎁 ${g.gift.name}`));
}

// ---------------- Gifts ----------------
let activeGiftTier = "normal";
let selectedGiftId = null;
let selectedVideoGiftId = null;
let giftSendTapCount = 0;

// Gift Manager gifts carry an admin-uploaded PNG (g.image) instead of the
// old hardcoded emoji. Falls back to a generic gift icon if an admin hasn't
// uploaded an image yet, so the catalog never shows a blank tile.
function giftDiamondAmount(g) {
  if (!g || typeof g !== "object") return 0;
  const candidates = [g.price, g.diamondAmount, g.amount, g.cost, g.diamonds];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return 0;
}
function giftAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch (_) {}
  return "";
}
function giftIconHtml(g) {
  const image = giftAssetUrl(g?.image || g?.icon || "");
  return image
    ? `<img src="${escapeHtml(image)}" class="emoji" style="width:32px;height:32px;object-fit:contain;" loading="lazy" decoding="async">`
    : `<span class="emoji">🎁</span>`;
}
function giftCategory(g) {
  const raw = String(g?.category || "").trim().toLowerCase();
  return ["gift", "lucky", "cp", "svip", "country"].includes(raw) ? raw : null;
}
function updateGiftSendButton() {
  const btn = $("btn-send-gift");
  if (!btn) return;
  const hasSelection = activeGiftTier !== "bag" && (activeGiftTier === "custom" ? !!selectedVideoGiftId : (!!selectedGiftId || !!selectedVideoGiftId));
  btn.disabled = !hasSelection;
  btn.classList.toggle("ready", hasSelection);
}
function selectGiftItem(item, g, isVideo) {
  document.querySelectorAll("#gift-catalog .gift-item").forEach(el => el.classList.remove("selected"));
  item.classList.add("selected");
  if (isVideo) {
    selectedVideoGiftId = g.id;
    selectedGiftId = null;
  } else {
    selectedGiftId = g.id;
    selectedVideoGiftId = null;
  }
  showGiftPreview(g, isVideo);
  updateGiftSendButton();
}
function renderGiftEmptyState(message) {
  const grid = $("gift-catalog");
  grid.innerHTML = `<div class="gift-empty-state"><div class="gift-empty-icon">🎁</div><div>${escapeHtml(message)}</div><small>Gifts added by Admin will appear here.</small></div>`;
}
function renderGiftGrid() {
  const grid = $("gift-catalog");
  grid.innerHTML = "";
  if (activeGiftTier === "custom") {
    renderVideoGiftGrid(grid);
    updateGiftSendButton();
    return;
  }
  if (activeGiftTier === "bag") {
    renderGiftEmptyState("Your Gift Bag is empty");
    updateGiftSendButton();
    return;
  }

  const regularGifts = GIFT_CATALOG_CACHE.gifts.filter(g => giftCategory(g) === activeGiftTier);
  const sectionVideoGifts = VIDEO_GIFT_CATALOG_CACHE.gifts.filter(g => g && g.enabled !== false && g.videoUrl && giftCategory(g) === activeGiftTier);
  const gifts = regularGifts;
  if (!gifts.length && !sectionVideoGifts.length) {
    const labels = { cp: "CP gifts are not added yet", country: "Country gifts are not added yet" };
    renderGiftEmptyState(labels[activeGiftTier] || "No gifts in this category yet");
    updateGiftSendButton();
    return;
  }

  gifts.forEach((g) => {
    const item = document.createElement("div");
    item.className = "gift-item gift-category-" + giftCategory(g) +
      " tier-" + (g.tier || "normal") + (selectedGiftId === g.id ? " selected" : "");
    item.innerHTML = `${giftIconHtml(g)}<span class="gift-name">${escapeHtml(g.name)}</span><span class="price">${giftDiamondAmount(g).toLocaleString()} <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"></span>`;
    item.addEventListener("mouseenter", () => showGiftPreview(g));
    item.addEventListener("touchstart", () => showGiftPreview(g), { passive: true });
    item.addEventListener("click", (ev) => { ev.preventDefault(); selectGiftItem(item, g, false); }, { passive: false });
    grid.appendChild(item);
  });
  // Video Gifts can also live inside a normal Gift/Lucky/CP/SVIP/Country section.
  sectionVideoGifts.forEach((g) => {
    const item = document.createElement("div");
    item.className = "gift-item tier-legend gift-category-" + giftCategory(g) + (selectedVideoGiftId === g.id ? " selected" : "");
    const thumb = g.thumbnail || g.image || g.icon || "";
    item.dataset.giftType = "video";
    item.dataset.giftId = g.id;
    item.innerHTML = `${thumb ? `<img src="${thumb}" class="emoji" style="width:64px;height:64px;object-fit:contain;border-radius:12px;">` : `<span class="emoji">🎬</span>`}<span class="gift-name">${escapeHtml(g.name)}</span><span class="price">${giftDiamondAmount(g).toLocaleString()} <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"></span>`;
    item.addEventListener("mouseenter", () => showGiftPreview(g, true));
    item.addEventListener("touchstart", () => showGiftPreview(g, true), { passive: true });
    item.addEventListener("click", (ev) => { ev.preventDefault(); selectGiftItem(item, g, true); }, { passive: false });
    grid.appendChild(item);
  });
  updateGiftSendButton();
}
// Custom tab — admin-uploaded Video Gifts. Thumbnail instead of emoji,
// price in Diamonds, sent through sendVideoGift().
function renderVideoGiftGrid(grid) {
  const validVideoGifts = VIDEO_GIFT_CATALOG_CACHE.gifts.filter(g => g && g.enabled !== false && g.videoUrl);
  if (!validVideoGifts.length) {
    renderGiftEmptyState("No Customize gifts yet");
    return;
  }
  validVideoGifts.filter(g => String(g.category || "customize").toLowerCase() === "customize").forEach((g) => {
    const item = document.createElement("div");
    item.className = "gift-item tier-legend gift-category-customize";
    const thumb = g.thumbnail || g.image || g.icon || "";
    item.dataset.giftType = "video";
    item.dataset.giftId = g.id;
    item.innerHTML = `${thumb ? `<img src="${thumb}" class="emoji" style="width:64px;height:64px;object-fit:contain;border-radius:12px;">` : `<span class="emoji">🎬</span>`}<span class="gift-name">${escapeHtml(g.name)}</span><span class="price">${giftDiamondAmount(g).toLocaleString()} <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"></span>`;
    item.addEventListener("mouseenter", () => showGiftPreview(g, true));
    item.addEventListener("touchstart", () => showGiftPreview(g, true), { passive: true });
    item.addEventListener("click", (ev) => { ev.preventDefault(); selectGiftItem(item, g, true); }, { passive: false });
    grid.appendChild(item);
  });
}
function showGiftPreview(g, isVideo) {
  const box = $("gift-preview");
  const iconEl = $("gift-preview-emoji");
  if (!box || !iconEl) return;
  if (isVideo) {
    iconEl.innerHTML = g.thumbnail ? `<img src="${g.thumbnail}" style="width:30px;height:30px;object-fit:cover;border-radius:6px;">` : "🎬";
  } else {
    iconEl.innerHTML = g.image ? `<img src="${g.image}" style="width:30px;height:30px;object-fit:contain;">` : "🎁";
  }
  const nameEl = $("gift-preview-name");
  const priceEl = $("gift-preview-price");
  const totalEl = $("gift-preview-total");
  const unitPrice = giftDiamondAmount(g);
  const qty = Math.max(1, Number(giftSendQty || 1));
  const recipientCount = Math.max(1, Number(selectedGiftTargets?.size || 1));
  const total = unitPrice * qty * recipientCount;
  if (nameEl) nameEl.textContent = g.name;
  if (priceEl) priceEl.innerHTML = `This gift: ${unitPrice.toLocaleString()} <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> each`;
  if (totalEl) totalEl.innerHTML = `Send total: ${total.toLocaleString()} <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> · x${qty} · ${recipientCount} user${recipientCount === 1 ? "" : "s"}`;
  box.classList.remove("hidden");
}
function refreshSelectedGiftPreview() {
  let gift = null, isVideo = false;
  if (selectedVideoGiftId) {
    gift = VIDEO_GIFT_CATALOG_CACHE.gifts.find(g => g && g.id === selectedVideoGiftId);
    isVideo = true;
  } else if (selectedGiftId) {
    gift = GIFT_CATALOG_CACHE.gifts.find(g => g && g.id === selectedGiftId);
  }
  if (gift) showGiftPreview(gift, isVideo);
}
$("gift-tabs").addEventListener("click", async (e) => {
  const btn = e.target.closest(".gift-tab");
  if (!btn) return;
  activeGiftTier = btn.dataset.category || btn.dataset.tier || "gift";
  // HTML uses "customize" while the runtime uses "custom". Normalize both
  // names so admin-added Custom/Video Gifts always render in Gift Box.
  if (activeGiftTier === "customize") activeGiftTier = "custom";
  selectedGiftId = null;
  selectedVideoGiftId = null;
  $("gift-tabs").querySelectorAll(".gift-tab").forEach(b => b.classList.toggle("active", b === btn));
  $("gift-preview").classList.add("hidden");

  // Always refresh from the server when a category is opened. This avoids a
  // missed Socket.IO catalog event leaving a newly-admin-added gift invisible
  // until the app is reloaded. The server endpoint is explicitly no-cache.
  if (activeGiftTier === "custom") {
    const r = await api("/api/video-gifts/catalog?ts=" + Date.now());
    if (r.success) VIDEO_GIFT_CATALOG_CACHE.gifts = Array.isArray(r.gifts) ? r.gifts.filter(g => g && g.enabled !== false && g.videoUrl) : [];
    else if (r.networkError) toast("Customize Gift connection is temporarily unavailable. Reconnecting…", true);
  } else if (activeGiftTier !== "bag") {
    const r = await api("/api/gifts/catalog?ts=" + Date.now());
    if (r.success) GIFT_CATALOG_CACHE.gifts = Array.isArray(r.gifts) ? r.gifts.filter(g => giftCategory(g) && giftDiamondAmount(g) > 0) : [];
  }
  renderGiftGrid();
});

// Multi-recipient gift targeting + repeat-send quantity (1 / 7 / 77 / 777).
// selectedGiftTargets holds the userIds currently checked in the modal's
// target list; giftSendQty is the multiplier applied on send (each selected
// recipient receives the gift giftSendQty times).
let selectedGiftTargets = new Set();
let giftSendQty = 1;

// Gift recipient rule (2026-09-25): only users occupying one of the room's
// real 12 seats are eligible recipients. "Select All" therefore means all
// seated users, never every online/lobby user below the seat grid.
function getSeatedGiftUsers() {
  const seats = Array.isArray(currentRoom?.seats) ? currentRoom.seats : [];
  const seatedIds = new Set(seats.filter(Boolean).map(s => String(s.userId)));
  return (currentRoom?.onlineUsers || []).filter(u =>
    seatedIds.has(String(u.userId))
  ).map(u => u.userId === me.userId ? { ...u, userName: `${u.userName || me.name || 'You'} (You — Self Gift)` } : u);
}

function renderGiftTargetList() {
  const list = $("gift-target-list");
  list.innerHTML = "";
  const users = getSeatedGiftUsers();
  if (!users.length) {
    list.innerHTML = '<div class="gift-target-empty">No one else in the room</div>';
    $("gift-target-select-all").checked = false;
    $("gift-target-select-all").disabled = true;
    return;
  }
  $("gift-target-select-all").disabled = false;
  users.forEach((u) => {
    const row = document.createElement("label");
    row.className = "gift-target-row";
    const checked = selectedGiftTargets.has(u.userId) ? "checked" : "";
    row.innerHTML = `<input type="checkbox" data-userid="${u.userId}" ${checked}><span class="gift-target-user"><b>${escapeHtml(u.userName)}</b><small>ID: ${escapeHtml(u.userId)}</small></span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) selectedGiftTargets.add(u.userId);
      else selectedGiftTargets.delete(u.userId);
      syncGiftSelectAllCheckbox(users);
      refreshSelectedGiftPreview();
    });
    list.appendChild(row);
  });
  syncGiftSelectAllCheckbox(users);
}
function syncGiftSelectAllCheckbox(users) {
  const all = users.length > 0 && users.every(u => selectedGiftTargets.has(u.userId));
  $("gift-target-select-all").checked = all;
  updateGiftTargetToggleBadge();
}
// Small corner button (👥) that opens/closes the compact target list —
// the list itself and its selection logic are unchanged, this only
// controls whether the panel is visible.
function updateGiftTargetToggleBadge() {
  const count = selectedGiftTargets.size;
  const countEl = $("gift-target-count");
  const labelEl = $("gift-target-label");
  const summaryEl = $("gift-target-summary");
  const users = (currentRoom?.onlineUsers || []).filter(u => selectedGiftTargets.has(u.userId));
  if (labelEl) labelEl.textContent = count === 0 ? "Select Users" : (count === 1 ? (users[0]?.userName || "1 User") : `${count} Users`);
  if (summaryEl) {
    if (!count) summaryEl.textContent = "Choose recipient";
    else if (count === getSeatedGiftUsers().length) summaryEl.textContent = "All Seated • room-wide";
    else summaryEl.textContent = users.slice(0, 2).map(u => `ID ${u.userId}`).join(" • ") + (count > 2 ? ` • +${count - 2}` : "");
  }
  if (countEl) { countEl.textContent = count; countEl.classList.toggle("hidden", count <= 1); }
}
$("btn-gift-target-toggle").addEventListener("click", () => {
  const panel = $("gift-target-panel");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  $("btn-gift-target-toggle").classList.toggle("active", opening);
});
$("gift-target-select-all").addEventListener("change", (e) => {
  const users = getSeatedGiftUsers();
  if (e.target.checked) users.forEach(u => selectedGiftTargets.add(u.userId));
  else selectedGiftTargets.clear();
  renderGiftTargetList();
  refreshSelectedGiftPreview();
});
$("gift-qty-row").addEventListener("click", (e) => {
  const toggle = e.target.closest("#gift-qty-toggle");
  if (toggle) {
    const menu = $("gift-qty-menu");
    const opening = !menu.classList.contains("open");
    menu.classList.toggle("open", opening);
    toggle.setAttribute("aria-expanded", opening ? "true" : "false");
    toggle.classList.toggle("open", opening);
    return;
  }
  const btn = e.target.closest(".gift-qty-btn");
  if (!btn) return;
  giftSendQty = parseInt(btn.dataset.qty, 10) || 1;
  $("gift-qty-row").querySelectorAll(".gift-qty-btn").forEach(b => {
    const active = b === btn;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  const current = $("gift-qty-current");
  if (current) current.textContent = "x" + giftSendQty;
  const menu = $("gift-qty-menu");
  const toggleBtn = $("gift-qty-toggle");
  menu.classList.remove("open");
  toggleBtn.classList.remove("open");
  toggleBtn.setAttribute("aria-expanded", "false");
  updateGiftSendButton();
  refreshSelectedGiftPreview();
});

document.addEventListener("click", (e) => {
  const row = $("gift-qty-row");
  if (!row || row.contains(e.target)) return;
  const menu = $("gift-qty-menu");
  const toggle = $("gift-qty-toggle");
  if (menu && menu.classList.contains("open")) menu.classList.remove("open");
  if (toggle) { toggle.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); }
});

// Gift Level Progress card (top of Gift Panel) — UI only. Mirrors the
// server's levelFromCoins() formula (Math.floor(coins/200)+1) so the
// badge/progress bar/remaining-text always agree with the real me.level
// the server sends on every wallet-update, without adding any new
// currency or server field. The 💎 icon here is a label only — the
// underlying spend is still Diamonds, exactly as before.
function giftLevelTier(level) { return Math.min(10, Math.max(1, Math.ceil((level || 1) / 10))); }

// Room Level Badge artwork:
// 1-9 = yellow, 10-24 = green, 25-50 = purple, 51-60 = red,
// 61-70 = black, 71-80 = gold, 81-90 = silver, 91+ = rainbow.
// The supplied PNG artwork is used only as the visual shell; the number is
// rendered separately so Lv.11/Lv.26/etc. never reuse a baked-in number.
function roomLevelTierStart(level) {
  const n = Math.max(1, Number(level) || 1);
  if (n <= 9) return 1;
  if (n <= 24) return 10;
  if (n <= 50) return 25;
  if (n <= 60) return 51;
  if (n <= 70) return 61;
  if (n <= 80) return 71;
  if (n <= 90) return 81;
  return 91;
}
// Fills an EXISTING <span class="room-level-badge"> element (e.g. the
// profile-sheet level chip) with the tier artwork + live number, the same
// visual the level badge used to show under the seat. Level is now shown
// only here (profile, tap-to-view) — not floating under every seat.
function applyProfileNameEffect(el, userOrEffect) {
  if (!el) return;
  const effect = typeof userOrEffect === "string" ? userOrEffect : (userOrEffect && userOrEffect.nameEffect);
  el.classList.remove("name-fx-premium-gradient");
  if (effect === "premium_gradient") el.classList.add("name-fx-premium-gradient");
}

function applyLevelBadge(el, level) {
  if (!el) return;
  const n = Math.max(1, Number(level) || 1);
  el.className = el.className.replace(/\btier-\d+\b/g, "").trim();
  el.classList.add("tier-" + roomLevelTierStart(n));
  el.setAttribute("aria-label", "Level " + n);
  el.innerHTML = "";
  const img = document.createElement("img");
  img.src = "/images/level-badges/level-tier-" + roomLevelTierStart(n) + ".png";
  img.alt = "";
  img.draggable = false;
  const text = document.createElement("span");
  text.className = "room-level-badge-text";
  text.textContent = "LV" + n;
  el.appendChild(img);
  el.appendChild(text);
}
// Owner/Admin room-role tag — shown ONLY on the profile sheet now (tap the
// avatar), not floating under the seat. Small pill styled like the other
// item/tag badges in the sheet-badge-row (see .room-role-badge in CSS).
function applyRoomRoleBadge(el, role) {
  if (!el) return;
  if (role !== "owner" && role !== "admin") {
    el.classList.add("hidden");
    el.textContent = "";
    el.className = "room-role-badge hidden";
    return;
  }
  el.className = "room-role-badge role-" + role;
  el.textContent = role === "owner" ? "👑 Owner" : "🛡️ Admin";
  el.classList.remove("hidden");
}
function renderGiftLevelCard() {
  const badge = $("gift-level-badge");
  if (!badge) return;
  // Gift level progress is based on Diamonds spent on room gifts, never the
  // retired Diamonds balance. Using Diamonds here made the Gift Box show stale/zero
  // progress even when the Wallet and gift sender had the correct Diamonds.
  const diamonds = Math.max(0, Math.floor(Number(me.diamonds || 0)));
  const level = me.level || Math.max(1, Math.floor(diamonds / 200) + 1);
  const currentFloor = (level - 1) * 200;
  const nextTarget = level * 200;
  const remaining = Math.max(0, nextTarget - diamonds);
  const progressPct = Math.min(100, Math.max(0, Math.round(((diamonds - currentFloor) / 200) * 100)));
  badge.className = "level-badge gift-level-badge lvl-tier-" + giftLevelTier(level);
  $("gift-level-badge-text").textContent = "Lv." + level;
  $("gift-level-progress-fill").style.width = progressPct + "%";
  $("gift-level-remaining").innerHTML = `Need ${remaining.toLocaleString()} <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> more to reach Lv.${level + 1}`;
}

async function openGiftModal(preselectUserId) {
  closeAllPanels("modal-gift");
  {
    const ts = Date.now();
    const [regular, video] = await Promise.all([
      api("/api/gifts/catalog?ts=" + ts),
      api("/api/video-gifts/catalog?ts=" + ts)
    ]);
    if (regular.success) GIFT_CATALOG_CACHE.gifts = Array.isArray(regular.gifts) ? regular.gifts.filter(g => giftCategory(g) && giftDiamondAmount(g) > 0) : [];
    if (video.success) VIDEO_GIFT_CATALOG_CACHE.gifts = Array.isArray(video.gifts) ? video.gifts.filter(g => g && g.enabled !== false && g.videoUrl) : [];
  }
  // Fix (2026-09-20): refresh both Gift Box catalogs on every open so an
  // admin-added Video Gift is available immediately in Gift Box → Customize,
  // even if the socket catalog broadcast was missed while the user was
  // offline/backgrounded.
  // Fix (2026-08-04): every time the modal opened, the target list reset
  // to empty and the user had to tap "Select All" again before sending —
  // even though they almost always want to gift everyone currently in the
  // room. Default to everyone (mirrors what tapping Select All would do)
  // instead of an empty set; a specific seat/user tap (preselectUserId)
  // still overrides this and picks just that one person, unchanged.
  if (preselectUserId) {
    selectedGiftTargets = new Set([preselectUserId]);
  } else {
    const roomUsers = getSeatedGiftUsers();
    selectedGiftTargets = new Set(roomUsers.map(u => u.userId));
  }
  giftSendQty = 1;
  const qtyCurrent = $("gift-qty-current");
  if (qtyCurrent) qtyCurrent.textContent = "x1";
  const qtyMenu = $("gift-qty-menu");
  if (qtyMenu) qtyMenu.classList.remove("open");
  const qtyToggle = $("gift-qty-toggle");
  if (qtyToggle) { qtyToggle.classList.remove("open"); qtyToggle.setAttribute("aria-expanded", "false"); }
  selectedGiftId = null;
  selectedVideoGiftId = null;
  activeGiftTier = "gift";
  $("gift-tabs").querySelectorAll(".gift-tab").forEach(b => b.classList.toggle("active", b.dataset.category === "gift"));
  giftSendTapCount = 0;
  const giftSendCountEl = $("gift-send-count");
  if (giftSendCountEl) giftSendCountEl.textContent = "0";
  $("gift-qty-row").querySelectorAll(".gift-qty-btn").forEach(b => b.classList.toggle("active", b.dataset.qty === "1"));
  $("gift-target-panel").classList.add("hidden");
  $("btn-gift-target-toggle").classList.remove("active");
  renderGiftTargetList();
  // Always refresh the authoritative wallet before opening the Gift Box.
  // This prevents a stale session snapshot from showing 0 Diamonds after a
  // Beans -> Diamonds exchange performed in the embedded Wallet.
  try {
    if (me.mobile) {
      const fresh = await api("/api/user/" + encodeURIComponent(me.mobile));
      if (fresh && fresh.success && fresh.user) {
        me = { ...me, ...fresh.user };
        saveSession();
      }
    }
  } catch (e) { console.warn("gift-box wallet refresh failed; using live session", e); }
  $("gift-modal-diamonds").textContent = Math.max(0, Math.floor(Number(me.diamonds || 0)));
  renderGiftLevelCard();
  $("gift-preview").classList.add("hidden");
  renderGiftGrid();
  const modal = $("modal-gift");
  modal.classList.remove("hidden");
  modal.querySelector(".gift-modal-card").classList.remove("gift-modal-open");
  requestAnimationFrame(() => modal.querySelector(".gift-modal-card").classList.add("gift-modal-open"));
}
$("btn-open-gift").addEventListener("click", () => openGiftModal());
$("btn-close-gift").addEventListener("click", () => $("modal-gift").classList.add("hidden"));
$("modal-gift").addEventListener("click", (e) => {
  if (e.target === $("modal-gift")) $("modal-gift").classList.add("hidden");
});
// Premium Gift Box footer Recharge button — reuses the exact same
// openWallet() the sidebar Wallet menu and the FOODWHEEL_BUY_COINS path
// already call; no new wallet/coin-center flow is created.
$("btn-gift-recharge").addEventListener("click", () => {
  $("modal-gift").classList.add("hidden");
  openWallet();
});
$("btn-send-gift").addEventListener("click", () => {
  if (selectedVideoGiftId) {
    sendVideoGift(selectedVideoGiftId);
  } else if (activeGiftTier !== "bag" && selectedGiftId) {
    sendGift(selectedGiftId);
  }
});
function sendGift(giftId) {
  const seatedIds = new Set(getSeatedGiftUsers().map(u => String(u.userId)));
  const targetUserIds = Array.from(selectedGiftTargets).filter(id => seatedIds.has(String(id)));
  if (!targetUserIds.length) { toast("Choose a seated user"); return; }
  // Server remains authoritative for the real balance. Keep the Gift Box open
  // after a successful tap so the same selected gift/recipient can be sent
  // repeatedly without reopening the box. Every tap gets a unique requestId,
  // so rapid taps are independent transactions rather than replayed retries.
  if (!me.diamonds) { toast("Not enough Diamonds, check your Wallet"); return; }
  const requestId = `gift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // Close immediately on send so the room remains visible while the server
  // broadcasts the gift animation. The selected quantity is sent in one
  // transaction (e.g. x77 is one server request, not 77 client taps).
  $("modal-gift")?.classList.add("hidden");
  document.body.classList.remove("gift-sheet-open");
  socket.emit("send-gift", { roomId: currentRoomId, targetUserIds, giftId, quantity: giftSendQty, requestId });
  giftSendTapCount += 1;
  const countEl = $("gift-send-count");
  if (countEl) countEl.textContent = String(giftSendTapCount);
  const btn = $("btn-send-gift");
  if (btn) {
    btn.classList.remove("gift-send-pop");
    void btn.offsetWidth;
    btn.classList.add("gift-send-pop");
  }
}
// Video Gift send — spends Diamonds (changed from Diamonds on request), requires
// at least 100,000. Server has the final say; this is just a snappy
// client-side pre-check.
function sendVideoGift(videoGiftId) {
  const seatedIds = new Set(getSeatedGiftUsers().map(u => String(u.userId)));
  const targetUserIds = Array.from(selectedGiftTargets).filter(id => seatedIds.has(String(id)));
  if (!targetUserIds.length) { toast("Choose a seated user"); return; }
  const gift = VIDEO_GIFT_CATALOG_CACHE.gifts.find(g => g.id === videoGiftId);
  if (gift && (me.diamonds || 0) < gift.price * giftSendQty * targetUserIds.length) { toast("Not enough Diamonds"); return; }
  const requestId = `videogift-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  socket.emit("send-video-gift", { roomId: currentRoomId, targetUserIds, videoGiftId, quantity: giftSendQty, requestId });
  $("modal-gift").classList.add("hidden");
}

// Plays the full-screen Video Gift queue one clip at a time. Each clip:
// shows the overlay, plays the video (with its own audio), then hides
// itself and moves to the next queued gift the moment it ends — so a late
// joiner who never received the original event simply never sees it, and
// a burst of gifts never plays two clips on top of each other.
function playNextVideoGift() {
  if (!roomEffectPrefs.giftEffect) { videoGiftQueue.length = 0; return; }
  if (videoGiftPlaying || !videoGiftQueue.length) return;
  videoGiftPlaying = true;
  const data = videoGiftQueue.shift();
  const overlay = $("video-gift-overlay");
  const video = $("video-gift-player");
  let finished = false;
  let fallbackTimer = null;
  const finishClip = () => {
    if (finished) return;
    finished = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    overlay.classList.add("hidden");
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.onended = null;
    video.onerror = null;
    video.onstalled = null;
    video.onwaiting = null;
    videoGiftPlaying = false;
    setTimeout(playNextVideoGift, 0);
  };

  const durationMs = Math.max(6000, Math.min(12000, Number(data.gift.duration || 8) * 1000 + 1200));
  fallbackTimer = setTimeout(finishClip, durationMs);

  overlay.classList.remove("hidden");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.preload = "auto";
  video.controls = false;
  video.muted = false;
  video.src = data.gift.videoUrl;
  video.currentTime = 0;

  video.onerror = () => {
    console.warn("[VIDEO GIFT] media load failed", data.gift.videoUrl, video.error);
    if (!video.muted) {
      video.muted = true;
      try { video.load(); } catch (_) {}
      video.play().catch(() => finishClip());
    } else {
      finishClip();
    }
  };
  video.onstalled = () => console.warn("[VIDEO GIFT] playback stalled");
  video.onwaiting = () => console.warn("[VIDEO GIFT] playback waiting for data");
  video.onended = finishClip;

  const startPlayback = () => {
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => finishClip());
    });
  };

  try {
    video.load();
    if (video.readyState >= 2) startPlayback();
    else video.addEventListener("canplay", startPlayback, { once: true });
  } catch (_) {
    finishClip();
  }
  toast(`🎬 ${data.fromName} sent ${data.gift.name}`);
}

// Plays the full-screen Vehicle Entry queue one clip at a time — same
// one-at-a-time pattern as playNextVideoGift above, kept in its own queue
// so it never competes with a Video Gift for the screen. The entry video
// plays with its own audio; an optional Background Music and/or Entry
// Sound Effect (admin-uploaded, both optional) layer on top if present.
function playNextVehicleEntry() {
  if (!roomEffectPrefs.entryAnimation) { vehicleEntryQueue.length = 0; return; }
  if (vehicleEntryPlaying || !vehicleEntryQueue.length) return;
  vehicleEntryPlaying = true;
  const data = vehicleEntryQueue.shift();
  const overlay = $("vehicle-entry-overlay");
  const video = $("vehicle-entry-player");
  const music = $("vehicle-entry-music");
  const sound = $("vehicle-entry-sound");
  let finished = false;
  const finishClip = () => {
    if (finished) return;
    finished = true;
    overlay.classList.add("hidden");
    video.pause(); video.removeAttribute("src"); video.load(); video.onended = null;
    music.pause(); music.removeAttribute("src");
    sound.pause(); sound.removeAttribute("src");
    vehicleEntryPlaying = false;
    playNextVehicleEntry();
  };
  video.onended = finishClip;
  // Safety net: never let the overlay get stuck if playback stalls.
  setTimeout(finishClip, ((data.vehicle.durationSeconds || 5) * 1000) + 800);
  overlay.classList.remove("hidden");
  video.src = data.vehicle.videoUrl;
  video.currentTime = 0;
  video.muted = false;
  video.play().catch(() => { video.muted = true; video.play().catch(() => finishClip()); });
  if (data.vehicle.musicUrl) { music.src = data.vehicle.musicUrl; music.currentTime = 0; music.play().catch(() => {}); }
  if (data.vehicle.soundUrl) { sound.src = data.vehicle.soundUrl; sound.currentTime = 0; sound.play().catch(() => {}); }
  toast(`🚗 ${data.userName} entered with ${data.vehicle.name}`);
}

// ---------------- Music ----------------
function renderMusicPlaylist() {
  const wrap = $("music-playlist-list");
  if (!wrap) return;
  const list = Array.isArray(currentRoom?.musicPlaylist) ? currentRoom.musicPlaylist : [];
  if (!list.length) { wrap.innerHTML = '<div class="gift-target-empty">Playlist is empty</div>'; return; }
  const currentIndex = Number(currentRoom?.music?.currentIndex);
  wrap.innerHTML = list.map((item, idx) => `
    <div class="music-playlist-row${idx === currentIndex ? " playing" : ""}">
      <div class="music-playlist-name">🎵 ${escapeHtml(item.name || "Song")}</div>
      <div class="music-playlist-actions">
        <button class="music-pl-btn music-pl-play" data-id="${escapeHtml(item.id)}">${idx === currentIndex && currentRoom?.music?.playing ? "⏸️" : "▶️"}</button>
        <button class="music-pl-btn music-pl-del" data-id="${escapeHtml(item.id)}">🗑️</button>
      </div>
    </div>`).join("");
  wrap.querySelectorAll(".music-pl-play").forEach(btn => btn.addEventListener("click", () => {
    const item = list.find(x => x.id === btn.dataset.id); if (!item) return;
    const idx = list.findIndex(x => x.id === item.id);
    if (idx === currentIndex && currentRoom?.music?.playing) socket.emit("music-update", { roomId: currentRoomId, url:item.url, name:item.name, playing:false, currentIndex:idx });
    else socket.emit("music-play", { roomId: currentRoomId, musicItemId:item.id, index:idx });
  }));
  wrap.querySelectorAll(".music-pl-del").forEach(btn => btn.addEventListener("click", () => socket.emit("music-remove", { roomId: currentRoomId, musicItemId: btn.dataset.id })));
}

$("btn-open-music").addEventListener("click", () => { closeAllPanels("modal-music"); renderMusicPlaylist(); $("modal-music").classList.remove("hidden"); });
$("btn-close-music").addEventListener("click", () => $("modal-music").classList.add("hidden"));
$("btn-music-add").addEventListener("click", () => $("music-file-input").click());
$("music-file-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData(); fd.append("music", file);
  const r = await apiUpload("/api/music/upload", fd);
  if (r.success) {
    socket.emit("music-add", { roomId: currentRoomId, url:r.url, name:r.name });
    e.target.value = "";
  } else toast(r.message || "Upload failed");
});
// ---------------------------------------------------------------------------
// ROOM MEDIA AUDIO UNLOCK — Android Chrome/WebView autoplay-safe
// ---------------------------------------------------------------------------
let roomMediaUnlockInstalled = false;
function resumeRoomMediaFromGesture() {
  const audio = $("room-audio");
  if (audio && currentRoom?.music?.url && currentRoom.music.playing && audio.paused) audio.play().catch(() => {});
  if (ytPlayer && ytPlayerState?.mode && ytPlayerState?.isPlaying) {
    try { ytPlayer.unMute(); ytPlayer.setVolume(100); ytPlayer.playVideo(); } catch (_) {}
  }
}
function installRoomMediaAudioUnlock() {
  if (roomMediaUnlockInstalled) return; roomMediaUnlockInstalled = true;
  const unlock = () => resumeRoomMediaFromGesture();
  document.addEventListener("pointerdown", unlock, { passive:true });
  document.addEventListener("touchstart", unlock, { passive:true });
  document.addEventListener("click", unlock, { passive:true });
}
installRoomMediaAudioUnlock();

$("btn-music-playpause").addEventListener("click", () => {
  const audio = $("room-audio");
  const music = currentRoom?.music;
  if (!music?.url) return;
  const idx = Number(music.currentIndex);
  if (music.playing) socket.emit("music-update", { roomId:currentRoomId, url:music.url, name:music.name, playing:false, currentIndex:idx });
  else {
    if (audio.src !== location.origin + music.url) audio.src = music.url;
    audio.play().catch(() => {});
    socket.emit("music-play", { roomId:currentRoomId, index:idx });
  }
});
$("btn-music-close-song").addEventListener("click", () => {
  const music = currentRoom?.music; if (!music?.url) return;
  socket.emit("music-update", { roomId:currentRoomId, url:music.url, name:music.name, playing:false, currentIndex:Number(music.currentIndex) });
});
function setMusicUI(music) {
  currentRoom = currentRoom || {}; currentRoom.music = music || {url:"",name:"",playing:false,currentIndex:-1};
  const audio = $("room-audio");
  $("music-now-playing").textContent = music?.name ? ("🎵 " + music.name) : "No song playing";
  if (!music?.url) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  else {
    if (audio.src !== location.origin + music.url) { audio.src = music.url; audio.load(); }
    if (music.playing) audio.play().catch(() => {}); else audio.pause();
  }
  $("btn-open-music").classList.toggle("active", !!music?.playing);
  renderMusicPlaylist();
}
$("room-audio").addEventListener("ended", () => { if (currentRoom?.music?.playing) socket.emit("music-ended", { roomId:currentRoomId }); });

// ===========================================================================
// YOUTUBE ROOM PLAYER
// Purely additive: its own DOM (#yt-player-wrap is a full-width 16:9 block
// between the room header and #seat-grid, see index.html — normal document
// flow, so it naturally pushes the seat grid down while visible and never
// covers it), its own socket events, its own state. Never touches seat
// rendering/voice/gifts/admin code. Server is the single source of truth
// for playlist + playback state; this module only (a) renders what the
// server last broadcast, and (b) for the owner/admin, drives the actual
// YT.Player and reports control actions.
// ===========================================================================

// (2026-07-27, video layout) — #yt-player-wrap now sizes itself purely via
// CSS (width:100%, aspect-ratio:16/9), so no header-class bookkeeping is
// needed any more. Kept as a no-op-safe helper (some call sites still call
// it) in case anything elsewhere depends on the function existing.
function syncYtHeaderClass() {}

// (2026-07-27, video layout) — the player's own box is now a true 16:9
// box (width:100%, aspect-ratio:16/9 in CSS), matching the vast majority of
// YouTube uploads, and object-fit:contain on the iframe (see style.css)
// guarantees the video is never cropped or stretched. This only needs to
// fill the iframe to the container's own size — no oversizing/cropping.
function ensureYtCoverFit() {
  const frame = $("yt-player-frame");
  const iframe = frame && frame.querySelector("iframe");
  if (!frame || !iframe) return;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
}
window.addEventListener("resize", () => { if (ytPlayer) ensureYtCoverFit(); });

// AUDIT FIX (2026-07-27, video layout) — "hide all playback controls...
// only show controls after user taps the video; controls disappear again
// automatically after a few seconds." Tap-to-reveal is layered independently
// of the existing item-based hidden/visible logic elsewhere in this file
// (which controls whether controls exist for the current content at all) —
// this only controls whether they're currently ON SCREEN.
let ytControlsHideTimer = null;
function showYtOverlayControls() {
  $("yt-player-wrap").classList.add("yt-controls-visible");
  if (ytControlsHideTimer) clearTimeout(ytControlsHideTimer);
  ytControlsHideTimer = setTimeout(() => {
    // Don't hide mid-interaction with the ⋮ menu.
    if (!$("yt-more-menu").classList.contains("hidden")) return;
    $("yt-player-wrap").classList.remove("yt-controls-visible");
  }, 3000);
}
$("yt-player-frame").addEventListener("click", showYtOverlayControls);
// Any tap within the revealed control bar itself should reset the auto-hide
// clock too, instead of it disappearing mid-tap on a slow double-action.
$("yt-overlay-controls").addEventListener("click", showYtOverlayControls);
// Dedicated small permanent close button (top-right) — same behavior as the
// existing "✕ Close" item in the ⋮ menu (owner ends it for everyone;
// viewers just dismiss it locally), just reachable without tapping first.
$("btn-yt-mini-close").addEventListener("click", () => $("btn-yt-close").click());

// The IFrame API calls this global exactly once, whenever the <script
// src="https://www.youtube.com/iframe_api"> tag finishes loading — which
// can happen before OR after this file has run, so we just flip a flag and
// flush anything that was waiting on it.
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (ytPendingLoad) {
    const p = ytPendingLoad; ytPendingLoad = null;
    ensureYtPlayer(p);
  }
};

function scheduleYtPlayerRetry(request, delay = 900) {
  if (ytPlayerRetryTimer) clearTimeout(ytPlayerRetryTimer);
  ytPlayerLastRequest = request;
  ytPlayerRetryTimer = setTimeout(() => {
    ytPlayerRetryTimer = null;
    if (!ytPlayerState.mode || !ytPlayerLastRequest) return;
    ensureYtPlayer(ytPlayerLastRequest, true);
  }, delay);
}

function destroyYtPlayerForRetry() {
  try { if (ytPlayer && typeof ytPlayer.destroy === "function") ytPlayer.destroy(); } catch (_) {}
  ytPlayer = null;
  ytLoadedVideoId = null;
  ytPlayerRequestSeq++;
  const mount = $("yt-player-mount");
  if (mount) mount.innerHTML = "";
}

function ensureYtPlayer({ videoId, position, isPlaying }, isRetry = false) {
  const request = { videoId: String(videoId || ""), position: Number(position) || 0, isPlaying: !!isPlaying };
  const seq = ++ytPlayerRequestSeq;
  ytPlayerLastRequest = request;
  if (!ytApiReady || typeof YT === "undefined" || !YT.Player) { ytPendingLoad = request; return; }
  if (!/^[A-Za-z0-9_-]{11}$/.test(request.videoId)) return;
  if (!ytPlayer) {
    $("yt-player-loading").classList.remove("hidden");
    const mount = $("yt-player-mount");
    if (mount) mount.innerHTML = "";
    try {
      ytPlayer = new YT.Player("yt-player-mount", {
        width:"100%", height:"100%", videoId:request.videoId,
        playerVars:{playsinline:1,controls:0,rel:0,modestbranding:1,iv_load_policy:3,fs:0,disablekb:1,enablejsapi:1,autoplay:0,start:Math.floor(request.position),origin:location.origin},
        events:{
          onReady:() => {
            if (seq !== ytPlayerRequestSeq || !ytPlayer) return;
            ytPlayerRetryCount=0; ytLoadedVideoId=request.videoId; $("yt-player-loading").classList.add("hidden"); ensureYtCoverFit();
            try { ytPlayer.seekTo(Math.max(0,request.position),true); } catch(_){}
            if (request.isPlaying) {
              try { ytPlayer.mute(); ytPlayer.playVideo(); } catch(_){}
              setTimeout(()=>{ if(seq!==ytPlayerRequestSeq||!ytPlayer)return; try{ if(ytPlayerState.mode&&ytPlayerState.isPlaying){ytPlayer.unMute();ytPlayer.setVolume(100);ytPlayer.playVideo();} }catch(_){} },500);
            } else { try{ytPlayer.pauseVideo();}catch(_){} }
          },
          onStateChange:onYtPlayerStateChange,
          onError:(e)=>{
            if (seq !== ytPlayerRequestSeq) return;
            console.warn("[YOUTUBE] player error",e?.data,request.videoId);
            $("yt-player-loading").classList.add("hidden");
            if (ytPlayerState.mode && ytPlayerRetryCount < 4) { ytPlayerRetryCount++; destroyYtPlayerForRetry(); scheduleYtPlayerRetry(request,700*ytPlayerRetryCount); }
          }
        }
      });
    } catch(e) {
      console.warn("[YOUTUBE] player creation failed",e); destroyYtPlayerForRetry();
      if(ytPlayerRetryCount<4){ytPlayerRetryCount++;scheduleYtPlayerRetry(request,800*ytPlayerRetryCount);}
    }
  } else {
    loadYtVideo(request.videoId,request.position,request.isPlaying);
  }
}

function loadYtVideo(videoId, position, isPlaying) {
  const id=String(videoId||"");
  const request={videoId:id,position:Number(position)||0,isPlaying:!!isPlaying};
  ytPlayerLastRequest=request; const seq=++ytPlayerRequestSeq;
  if(!ytPlayer||typeof ytPlayer.loadVideoById!=="function"){ensureYtPlayer(request);return;}
  ytSuppressEvents=true;
  try {
    const loaded=(typeof ytPlayer.getVideoData==="function"&&ytPlayer.getVideoData().video_id)||ytLoadedVideoId;
    ytPlayerRetryCount=0;
    if(loaded!==id){
      // cue first, then explicitly start; this avoids the intermittent
      // second-video stall seen on Android/WebView when loadVideoById is
      // called immediately after an ended iframe state.
      ytPlayer.cueVideoById(id,Math.max(0,request.position));
      ytLoadedVideoId=id;
      setTimeout(()=>{
        if(seq!==ytPlayerRequestSeq||!ytPlayer)return;
        try{ytPlayer.seekTo(Math.max(0,request.position),true);}catch(_){}
        if(request.isPlaying){try{ytPlayer.mute();ytPlayer.playVideo();}catch(_){} setTimeout(()=>{if(seq!==ytPlayerRequestSeq||!ytPlayer)return;try{if(ytPlayerState.mode&&ytPlayerState.isPlaying){ytPlayer.unMute();ytPlayer.setVolume(100);ytPlayer.playVideo();}}catch(_){}},450);}
      },250);
    } else {
      try{ytPlayer.seekTo(Math.max(0,request.position),true);}catch(_){}
      if(request.isPlaying){try{ytPlayer.mute();ytPlayer.playVideo();}catch(_){} setTimeout(()=>{if(seq!==ytPlayerRequestSeq||!ytPlayer)return;try{if(ytPlayerState.mode&&ytPlayerState.isPlaying){ytPlayer.unMute();ytPlayer.setVolume(100);ytPlayer.playVideo();}}catch(_){}},350);}
      else {try{ytPlayer.pauseVideo();}catch(_){} }
    }
  } catch(e) {
    console.warn("[YOUTUBE] video switch failed",e); destroyYtPlayerForRetry();
    if(ytPlayerRetryCount<4){ytPlayerRetryCount++;scheduleYtPlayerRetry(request,700*ytPlayerRetryCount);}
  }
  setTimeout(()=>{if(seq===ytPlayerRequestSeq)ytSuppressEvents=false;},900);
}

// Only the owner/admin's own client reports state changes back to the
// server (via yt-ended for the one case that needs auto-advance). Everyone
// else's player is purely a receiver, driven entirely by yt-player-update —
// this keeps a single "true" playback timeline instead of every client's
// player fighting to be the source of truth.
function onYtPlayerStateChange(e) {
  if (ytSuppressEvents) return;
  if (e.data === YT.PlayerState.ENDED) {
    const item = ytCurrentPlaylist[ytPlayerState.currentIndex];
    ytLastEndedVideoId = item?.videoId ? String(item.videoId) : null;
    if (canControlYt) socket.emit("yt-ended", { roomId: currentRoomId });
  }
}

// Applies a server-broadcast player state to the UI + (for the controller)
// the actual YT.Player. Also used on initial room-state hydration.
function applyYtPlayerState(state) {
  const prevIndex = ytPlayerState ? ytPlayerState.currentIndex : -1;
  ytPlayerState = state || ytPlayerState;
  const item = ytCurrentPlaylist[ytPlayerState.currentIndex] || null;
  renderYtPlaylist(); // refresh "now playing" highlight

  // Clear a viewer-local "hide for me" only when a genuinely new video
  // starts — NOT on every broadcast, since the owner's drift-correction
  // ping (manageYtDriftTimer, every 4s while playing) also re-broadcasts
  // yt-player-update and would otherwise instantly un-hide it again.
  if (ytPlayerState.currentIndex !== prevIndex) ytLocallyDismissed = false;
  if (ytLocallyDismissed) return;

  $("btn-yt-playpause").textContent = ytPlayerState.isPlaying ? "⏸️" : "▶️";
  $("yt-player-controls").classList.toggle("hidden", !item);
  $("btn-yt-prev").classList.toggle("hidden", !canControlYt);
  $("btn-yt-playpause").classList.toggle("hidden", !canControlYt);
  $("btn-yt-next").classList.toggle("hidden", !canControlYt);

  if (!item) {
    $("yt-player-title").textContent = "No video playing";
    $("yt-player-sub").textContent = "";
    $("yt-player-thumb").removeAttribute("src");
    $("yt-player-poster").classList.add("hidden");
    $("yt-player-poster").removeAttribute("src");
    $("yt-player-empty").classList.remove("hidden");
    return;
  }
  $("yt-player-empty").classList.add("hidden");
  $("yt-player-title").textContent = item.title || "YouTube Video";
  $("yt-player-sub").textContent = "Added by " + (item.addedByUsername || "—");
  $("yt-player-thumb").src = item.thumbnail || "";
  // Big poster thumbnail behind the mount — shown until the real player
  // actually starts playing, then simply sits behind it (harmless either way).
  if (item.thumbnail) {
    $("yt-player-poster").src = item.thumbnail;
    $("yt-player-poster").classList.toggle("hidden", ytPlayerState.isPlaying);
  }

  // Only actually spin up / drive the real IFrame player while Video Mode
  // is on — no point loading YouTube in the background when it's hidden.
  if (!ytPlayerState.mode) return;
  if (!ytPlayer && !ytPendingLoad) {
    ensureYtPlayer({ videoId: item.videoId, position: ytPlayerState.position, isPlaying: ytPlayerState.isPlaying });
  } else if (ytPlayer) {
    const loadedId = (typeof ytPlayer.getVideoData === "function" && ytPlayer.getVideoData().video_id) || null;
    if (loadedId !== item.videoId) {
      loadYtVideo(item.videoId, ytPlayerState.position, ytPlayerState.isPlaying);
    } else {
      // Same video — just correct drift/play-state without a jarring reload.
      const cur = typeof ytPlayer.getCurrentTime === "function" ? ytPlayer.getCurrentTime() : 0;
      if (Math.abs(cur - (ytPlayerState.position || 0)) > 2.5) ytPlayer.seekTo(ytPlayerState.position || 0, true);
      if (ytPlayerState.isPlaying) ytPlayer.playVideo(); else ytPlayer.pauseVideo();
    }
    ensureYtCoverFit();
  }
  manageYtDriftTimer();
}

// Owner/admin's client nudges the server with the real playback position
// every few seconds while playing, so late joiners land close to the
// actual timestamp instead of drifting. Non-controllers never do this.
function manageYtDriftTimer() {
  clearInterval(ytDriftTimer); ytDriftTimer = null;
  if (!canControlYt || !ytPlayerState.isPlaying || !ytPlayer) return;
  ytDriftTimer = setInterval(() => {
    if (!ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;
    socket.emit("yt-seek", { roomId: currentRoomId, position: ytPlayer.getCurrentTime() });
  }, 4000);
}

function setYtModeUI(on, skipDom) {
  if (on) ytLocallyDismissed = false; // mode turning on for real always overrides a stale local hide
  $("yt-player-wrap").classList.toggle("hidden", !on || ytLocallyDismissed);
  syncYtHeaderClass();
  $("btn-toggle-yt").classList.toggle("active", on);
  if (on) {
    // Controls always start hidden — the user has to tap the video first.
    $("yt-player-wrap").classList.remove("yt-controls-visible");
    if (ytControlsHideTimer) { clearTimeout(ytControlsHideTimer); ytControlsHideTimer = null; }
  }
  if (!on) {
    clearInterval(ytDriftTimer); ytDriftTimer = null;
    if (ytPlayerRetryTimer) { clearTimeout(ytPlayerRetryTimer); ytPlayerRetryTimer = null; }
    ytPlayerLastRequest = null;
    ytPlayerRetryCount = 0;
    if (ytPlayer && typeof ytPlayer.pauseVideo === "function") { try { ytPlayer.pauseVideo(); } catch (_) {} }
  } else if (!skipDom) {
    applyYtPlayerState(ytPlayerState);
  }
}

function renderYtPlaylist() {
  const wrap = $("yt-playlist-list");
  $("yt-add-row").classList.toggle("hidden", !canControlYt);
  if (!ytCurrentPlaylist.length) {
    wrap.innerHTML = '<div class="gift-target-empty">Playlist is empty</div>';
    return;
  }
  wrap.innerHTML = "";
  ytCurrentPlaylist.forEach((item, idx) => {
    const isPlaying = idx === ytPlayerState.currentIndex;
    const row = document.createElement("div");
    row.className = "yt-playlist-row" + (isPlaying ? " playing" : "");
    row.innerHTML = `
      <img class="yt-playlist-thumb" src="${escapeHtml(item.thumbnail || "")}" alt="">
      <div class="yt-playlist-meta">
        <div class="yt-pl-title">${escapeHtml(item.title || "YouTube Video")}</div>
        <div class="yt-pl-sub">Added by ${escapeHtml(item.addedByUsername || "—")}</div>
      </div>
      <div class="yt-playlist-actions">
        ${canControlYt ? `<button class="yt-pl-play-btn${isPlaying ? " playing" : ""}" data-id="${item.id}">${isPlaying ? "⏸️" : "▶️"}</button>` : ""}
        ${canControlYt ? `<button class="yt-pl-del-btn" data-id="${item.id}">🗑️</button>` : ""}
      </div>`;
    wrap.appendChild(row);
  });
  wrap.querySelectorAll(".yt-pl-play-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const idx = ytCurrentPlaylist.findIndex((v) => v.id === id);
      if (idx === ytPlayerState.currentIndex && ytPlayerState.isPlaying) {
        socket.emit("yt-pause", { roomId: currentRoomId });
      } else {
        socket.emit("yt-play", { roomId: currentRoomId, videoItemId: id });
      }
    });
  });
  wrap.querySelectorAll(".yt-pl-del-btn").forEach((btn) => {
    btn.addEventListener("click", () => socket.emit("yt-remove-video", { roomId: currentRoomId, videoItemId: btn.dataset.id }));
  });
}

$("btn-toggle-yt").addEventListener("click", () => {
  if (!canControlYt) return;
  socket.emit("yt-toggle-mode", { roomId: currentRoomId, on: !ytPlayerState.mode });
});

$("btn-open-yt-playlist").addEventListener("click", () => {
  closeAllPanels("modal-yt-playlist");
  renderYtPlaylist();
  $("modal-yt-playlist").classList.remove("hidden");
  // Re-engaging with the playlist is a clear signal the viewer wants the
  // player back, so undo a previous local-only Close.
  if (ytLocallyDismissed && ytPlayerState.mode) {
    ytLocallyDismissed = false;
    $("yt-player-wrap").classList.remove("hidden");
    syncYtHeaderClass();
    applyYtPlayerState(ytPlayerState);
  }
});
$("btn-close-yt-playlist").addEventListener("click", () => $("modal-yt-playlist").classList.add("hidden"));

$("btn-yt-add").addEventListener("click", () => {
  const input = $("yt-link-input");
  const url = (input.value || "").trim();
  if (!url) return;
  socket.emit("yt-add-video", { roomId: currentRoomId, url });
  input.value = "";
});

$("btn-yt-playpause").addEventListener("click", () => {
  if (!canControlYt) return;
  if (ytPlayerState.isPlaying) socket.emit("yt-pause", { roomId: currentRoomId });
  else socket.emit("yt-play", { roomId: currentRoomId });
});
$("btn-yt-next").addEventListener("click", () => { if (canControlYt) socket.emit("yt-next", { roomId: currentRoomId }); });
$("btn-yt-prev").addEventListener("click", () => { if (canControlYt) socket.emit("yt-prev", { roomId: currentRoomId }); });

// ---------------------------------------------------------------------------
// YouTube Player — compact ⋮ menu (Playlist, Share, Refresh, Voice, Close).
// All purely additive on top of the existing state machine above: none of
// these emit new server events except Close (which reuses yt-toggle-mode,
// exactly like the existing 📺 toolbar button already does), so no new
// server-side logic is needed and nothing else changes. Available to every
// viewer, not just the owner/admin — Prev/Play/Next remain controller-only.
// ---------------------------------------------------------------------------
let ytLocallyDismissed = false; // viewer-only "hide for me" when they can't control the room
let ytMuted = false;

function closeYtMoreMenu() { $("yt-more-menu").classList.add("hidden"); }

$("btn-yt-close").addEventListener("click", () => {
  closeYtMoreMenu();
  if (canControlYt) {
    socket.emit("yt-toggle-mode", { roomId: currentRoomId, on: false });
  } else {
    // Non-controllers can't end video mode for everyone — just hide it
    // locally; it comes back automatically next time the server broadcasts
    // an update (new video, mode re-enabled, etc.) so it never desyncs.
    ytLocallyDismissed = true;
    $("yt-player-wrap").classList.add("hidden");
    syncYtHeaderClass();
    if (ytPlayer && typeof ytPlayer.pauseVideo === "function") { try { ytPlayer.pauseVideo(); } catch (_) {} }
  }
});

$("btn-yt-refresh").addEventListener("click", () => {
  closeYtMoreMenu();
  const item = ytCurrentPlaylist[ytPlayerState.currentIndex];
  if (!item) { toast("No video playing"); return; }
  if (ytPlayer && typeof ytPlayer.seekTo === "function") {
    ytSuppressEvents = true;
    ytPlayer.seekTo(ytPlayerState.position || 0, true);
    if (ytPlayerState.isPlaying) ytPlayer.playVideo();
    setTimeout(() => { ytSuppressEvents = false; }, 400);
  } else {
    applyYtPlayerState(ytPlayerState);
  }
  toast("Refreshed");
});

$("btn-yt-voice").addEventListener("click", () => {
  // Local-only mute of the video's own audio — does not touch room mic /
  // WebRTC voice chat at all, and does not affect other viewers.
  ytMuted = !ytMuted;
  if (ytPlayer) {
    if (ytMuted && typeof ytPlayer.mute === "function") ytPlayer.mute();
    else if (!ytMuted && typeof ytPlayer.unMute === "function") { ytPlayer.unMute(); try { ytPlayer.setVolume(100); } catch (_) {} }
  }
  $("btn-yt-voice").textContent = ytMuted ? "🔇 Sound Off" : "🔊 Sound On";
});

$("btn-open-yt-playlist-2").addEventListener("click", () => { closeYtMoreMenu(); $("btn-open-yt-playlist").click(); });

function currentYtShareUrl() {
  const item = ytCurrentPlaylist[ytPlayerState.currentIndex];
  return item ? `https://youtu.be/${item.videoId}` : location.href;
}
async function shareYtVideo() {
  closeYtMoreMenu();
  const url = currentYtShareUrl();
  const item = ytCurrentPlaylist[ytPlayerState.currentIndex];
  const title = item ? item.title : "PingPong Room";
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch (_) { /* cancelled — fall through silently */ }
  } else if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(url); toast("Link copied"); return; } catch (_) {}
  }
}
$("btn-yt-share").addEventListener("click", shareYtVideo);
$("btn-yt-copy-link").addEventListener("click", async () => {
  closeYtMoreMenu();
  try { await navigator.clipboard.writeText(currentYtShareUrl()); toast("Link copied"); }
  catch (_) { toast(currentYtShareUrl()); }
});
$("btn-yt-open-external").addEventListener("click", () => {
  closeYtMoreMenu();
  window.open(currentYtShareUrl(), "_blank");
});
$("btn-yt-more").addEventListener("click", (e) => {
  e.stopPropagation();
  $("yt-more-menu").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!$("yt-more-menu").classList.contains("hidden") && !$("yt-more-wrap").contains(e.target)) {
    closeYtMoreMenu();
  }
});

// ===========================================================================
// WEBRTC VOICE — stream, real-time speaking detection, auto-reconnect
// ===========================================================================
// Explicit rather than relying on implicit `audio: true` defaults, which
// vary by browser/OS — this guarantees echo cancellation, noise
// suppression, and auto gain control are actually requested everywhere the
// mic is opened (room voice and 1-1 calls alike).
const VOICE_AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 };
const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Fallback TURN relay — STUN alone can't traverse symmetric / carrier-grade
    // NAT (common on mobile data), which is what makes voice sound "far"/choppy
    // or fail to connect for some users. A TURN relay gives those connections
    // an actual path instead of silently failing. For production scale, swap
    // this public relay for a dedicated TURN service (see README).
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  ]
};

// ICE CONFIG UNIFICATION (voice stability pass, 2026-08-04): room voice used
// to always use the hardcoded list above, while 1-1 calls fetched
// operator-configured servers from /api/calls/ice-servers (STUN_URL /
// TURN_URL env vars) — two different ICE configs for the same kind of media.
// This primes room voice with that same endpoint/cache (getIceServers(),
// defined below — function declarations are hoisted so this is safe to call
// from up here) and merges it with the existing hardcoded fallback, so an
// operator's TURN_URL now covers both paths, and reliability never regresses
// if those env vars aren't set. No new endpoint, no API change — same call
// callSignaling.js already exposes.
let roomIceServersResolved = null;
async function primeRoomIceServers() {
  if (roomIceServersResolved) return roomIceServersResolved;
  try {
    const fetched = await getIceServers();
    const seen = new Set();
    roomIceServersResolved = [...fetched, ...ICE_SERVERS.iceServers].filter((s) => {
      const key = JSON.stringify(s.urls);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (e) {
    roomIceServersResolved = ICE_SERVERS.iceServers;
  }
  return roomIceServersResolved;
}

// Additive audio-quality tweak (voice smoothness pass, 2026-08-04): turns on
// Opus in-band FEC (forward error correction) on every offer/answer we send,
// for both room voice and 1-1 calls. With FEC on, a handful of lost packets
// (normal on mobile data / weak Wi-Fi) get reconstructed from redundancy
// already riding in the next packet instead of being heard as a click/gap —
// this is what "choppy" voice usually is. Pure SDP text edit right before
// setLocalDescription; touches nothing about signaling, ICE, or the
// reconnect/restart logic elsewhere in this file. No-op if Opus isn't
// present in the SDP (never throws either way).
// Extended in the voice stability pass to also enable Opus DTX (discontinuous
// transmission — stops sending packets during silence instead of padding
// audio, which lowers bandwidth/CPU without touching perceived quality during
// speech) and to set a floor/ceiling bitrate rather than leaving it fully
// unbounded. maxaveragebitrate defaults to 32000 (32kbps) — a normal-to-good
// voice-quality Opus bitrate, at or above what browsers typically negotiate
// on their own — so this is a floor, not a cut. Actual dynamic scaling
// (raising/lowering with measured network conditions) happens separately via
// RTCRtpSender.setParameters() in applyAdaptiveBitrate(), which doesn't
// require renegotiation. Same function name/signature as before — every
// existing call site (room voice + 1-1 calls, offer + answer) keeps working
// unchanged; only the SDP it produces is richer.
function applyOpusFEC(desc, maxAverageBitrate) {
  try {
    if (!desc || !desc.sdp) return desc;
    const opusMatch = desc.sdp.match(/a=rtpmap:(\d+) opus\/48000/);
    if (!opusMatch) return desc;
    const payload = opusMatch[1];
    const bitrate = maxAverageBitrate || 32000;
    const fmtpRe = new RegExp(`a=fmtp:${payload} ([^\r\n]*)`);
    if (fmtpRe.test(desc.sdp)) {
      desc.sdp = desc.sdp.replace(fmtpRe, (full, params) => {
        let p = params;
        if (!/useinbandfec=/.test(p)) p += ";useinbandfec=1";
        if (!/usedtx=/.test(p)) p += ";usedtx=1";
        if (!/maxaveragebitrate=/.test(p)) p += `;maxaveragebitrate=${bitrate}`;
        return `a=fmtp:${payload} ${p}`;
      });
    } else {
      desc.sdp = desc.sdp.replace(opusMatch[0], `${opusMatch[0]}\r\na=fmtp:${payload} useinbandfec=1;usedtx=1;maxaveragebitrate=${bitrate}`);
    }
  } catch (e) { /* never let an audio-quality tweak break call setup */ }
  return desc;
}

// Dynamic bitrate (item 8 of the spec): raises/lowers the already-negotiated
// audio sender's bitrate live via setParameters() — no renegotiation, no SDP
// round-trip, nothing visible to the signaling flow. Bounded so it can only
// ever move within a normal voice range (16-32kbps), never below what
// sounds acceptable and never used to silently degrade quality on a good
// connection.
function applyAdaptiveBitrate(pc, kbps) {
  try {
    const sender = pc.getSenders && pc.getSenders().find((s) => s.track && s.track.kind === "audio");
    if (!sender) return;
    const clamped = Math.max(16, Math.min(32, kbps));
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = clamped * 1000;
    const p = sender.setParameters(params);
    if (p && typeof p.catch === "function") p.catch(() => {});
  } catch (e) { /* setParameters unsupported/mid-negotiation — leave bitrate as-is */ }
}

// Phase 1 / Tier A: resolve a room-voice peer's socketId back to their
// userId so voice-stats reports can be tied to a person server-side (see
// voice-health.js). seatMap is already kept current for the UI; this just
// reads it, no new state.
function userIdForSocketId(sid) {
  const entry = Object.values(seatMap).find((s) => s && s.socketId === sid);
  return entry ? entry.userId : null;
}

// Connection diagnostics (item 6): periodic getStats() poll, console-only —
// never surfaced in UI. Feeds packet loss into applyAdaptiveBitrate so poor
// links get a lower ceiling and good links get headroom back automatically.
// Phase 1 / Tier A also feeds a lightweight summary to the server's Voice
// Health Monitor (see voice-health.js) every ~5s for room-voice peers only
// (private calls use their own "call" label and aren't reported here —
// per-call quality wasn't in scope for this phase).
function startConnectionDiagnostics(pc, label) {
  let lastPacketsLost = null, lastTimestamp = null, lastStatsEmit = 0;
  const timer = setInterval(async () => {
    if (!pc || pc.connectionState === "closed") { clearInterval(timer); return; }
    try {
      const stats = await pc.getStats();
      let rtt = null, jitter = null, packetsLost = null, packetsReceived = null, relay = false;
      let localCandidateId = null, usedCandidateType = null;
      const candidateTypesById = {};
      stats.forEach((r) => {
        if (r.type === "candidate-pair" && r.state === "succeeded" && (r.nominated || r.selected)) {
          rtt = r.currentRoundTripTime;
          localCandidateId = r.localCandidateId;
        }
        if (r.type === "remote-candidate" && r.candidateType === "relay") relay = true;
        if (r.type === "local-candidate" && r.candidateType === "relay") relay = true;
        if (r.type === "local-candidate") candidateTypesById[r.id] = r.candidateType;
        if (r.type === "inbound-rtp" && r.kind === "audio") {
          jitter = r.jitter;
          packetsLost = r.packetsLost;
          packetsReceived = r.packetsReceived;
        }
      });
      // TURN diagnostics (console only, no UI): identify which candidate
      // type the active connection actually settled on so "TURN configured"
      // vs "TURN actually used" can be told apart in the logs.
      if (localCandidateId && candidateTypesById[localCandidateId]) {
        usedCandidateType = candidateTypesById[localCandidateId];
        if (usedCandidateType !== pc._lastLoggedCandidateType) {
          pc._lastLoggedCandidateType = usedCandidateType;
          const label = usedCandidateType === "relay" ? "Relay Candidate Used"
            : usedCandidateType === "srflx" ? "srflx Candidate Used"
            : usedCandidateType === "host" ? "Host Candidate Used"
            : `${usedCandidateType} Candidate Used`;
          console.log(`[ice-config] ${label}`);
        }
      }
      let lossRatio = 0;
      if (packetsLost != null && lastPacketsLost != null && lastTimestamp != null) {
        const deltaLost = Math.max(0, packetsLost - lastPacketsLost);
        const deltaRecv = Math.max(0, (packetsReceived || 0) - lastTimestamp);
        lossRatio = deltaRecv > 0 ? deltaLost / (deltaLost + deltaRecv) : 0;
        const targetKbps = lossRatio > 0.08 ? 16 : lossRatio > 0.03 ? 24 : 32;
        applyAdaptiveBitrate(pc, targetKbps);
      }
      lastPacketsLost = packetsLost;
      lastTimestamp = packetsReceived;
      console.debug(`[voice-diag] ${label} ice=${pc.iceConnectionState} conn=${pc.connectionState} rtt=${rtt} jitter=${jitter} lost=${packetsLost} relay=${relay}`);

      // Phase 1 / Tier A: report to voice-health.js, room-peer connections
      // only, throttled to ~5s (matches the server's per-user rate limit).
      const now = Date.now();
      if (label.startsWith("room-peer:") && socket && socket.connected && now - lastStatsEmit >= 5000) {
        const remoteSocketId = label.slice("room-peer:".length);
        const peerUserId = userIdForSocketId(remoteSocketId);
        if (peerUserId && packetsLost != null) {
          socket.emit("voice-stats", {
            peerUserId,
            packetLossPercent: lossRatio * 100,
            jitterMs: jitter != null ? jitter * 1000 : 0,
            rttMs: rtt != null ? rtt * 1000 : 0
          });
          lastStatsEmit = now;
        }
      }
    } catch (e) { /* stats unavailable this tick — skip */ }
  }, 4000);
  return timer;
}

async function initMicIfNeeded() {
  if (localStream || !mySeatNumber) return;
  // Phase 3 / Step 3.3: everything below this line is the ORIGINAL mesh
  // implementation, byte-for-byte unchanged. In SFU mode it is skipped
  // entirely in favor of initSfuMicIfNeeded() (see the WEBRTC VOICE SFU
  // section further down) so there is exactly one code path active for
  // any given VOICE_MODE, never both at once (that would double-publish
  // audio / cause echo).
  if (voiceMode === "sfu") { await initSfuMicIfNeeded(); return; }
  if (voiceMode === "agora") {
    if (!window.PingPongVoiceAgora) throw new Error("Agora voice module unavailable");
    await window.PingPongVoiceAgora.connect({ room: currentRoomId, publish: true });
    return;
  }
  // IMPORTANT: getUserMedia is only allowed in a "secure context" — https://,
  // or http://localhost specifically. Opening the app on a phone via
  // http://192.168.x.x:3000 (a plain LAN IP, as the README's basic testing
  // instructions describe) is NOT secure, so the browser blocks microphone
  // access outright before any of our code even runs — often with no
  // visible error, or navigator.mediaDevices being undefined entirely. This
  // silently produces exactly "voice doesn't work, nobody can hear anyone"
  // on every real phone, regardless of any signaling fix. Use ngrok /
  // Cloudflare Tunnel (both already mentioned in the README) or deploy
  // behind real HTTPS to test across devices.
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error("[voice] blocked: not a secure context (need https:// or http://localhost). Current origin:", location.origin);
    toast("HTTPS is required for voice — the mic won't work on phones over http://IP:3000, use ngrok/Cloudflare Tunnel instead");
    return;
  }
  await primeRoomIceServers(); // load operator TURN credentials before any peer is created
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS });
    localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    startVoiceActivityDetection();
  } catch (e) {
    console.error("[voice] getUserMedia failed:", e.name, e.message);
    toast("Microphone permission required");
  }
}

// Safety net for the seat/mic race: a peer connection can end up created
// (e.g. because we just received an incoming offer) before our own
// getUserMedia() resolves, so it goes out with zero local audio tracks —
// the other side gets silence from us even though the connection looks
// "connected". Whenever localStream becomes available/changes, walk every
// existing peer connection and, if it has no outgoing audio track yet, add
// one and renegotiate.
async function ensureLocalTracksSent() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0] || null;
  const publishing = mySeatNumber !== null && mySeatNumber !== undefined && !!audioTrack;

  // A room member who is not seated is a LISTENER, not a publisher. Keep the
  // RTCPeerConnection alive, but detach the local audio track from every
  // sender. replaceTrack(null) is deliberately used instead of destroying
  // the peer: this lets the same transport continue receiving audio and makes
  // seat -> audience -> seat transitions cheap and race-resistant.
  await Promise.all(Object.entries(peerConnections).map(async ([sid, pc]) => {
    try {
      const sender = pc._ppVoiceAudioTransceiver?.sender || pc.getSenders().find(s => s._ppVoiceAudioSender || (s.track && s.track.kind === "audio"));
      if (!publishing) {
        if (sender && sender.track) await sender.replaceTrack(null);
        return;
      }
      // getOrCreatePeer() reserves the single audio sender before either side
      // creates an offer. Reuse it rather than addTrack(), which would create
      // a second audio transceiver/media section.
      if (!sender) throw new Error("Room audio transceiver is missing");
      if (sender.track !== audioTrack || sender.track?.readyState === "ended") {
        await sender.replaceTrack(audioTrack);
        // replaceTrack normally does not need renegotiation. A forced ICE
        // restart is only attempted if the transport itself is unhealthy.
        if (pc.iceConnectionState === "failed") await connectToPeer(sid, true);
      }
    } catch (e) {
      console.warn("[voice] local audio track sync failed:", sid, e && e.message);
      closePeer(sid);
      if (isCurrentRoomMember()) connectToPeer(sid, true);
    }
  }));
}

$("btn-mic-toggle").addEventListener("click", async () => {
  // PHASE 3, STEP 3.6 — audience members must never publish. LiveKit
  // itself already refuses the publish server-side (their token has
  // canPublish:false — see provider.js), so this can never actually be
  // bypassed by removing this check; it only avoids a pointless mic
  // permission prompt followed by a silent server-side rejection.
  // Mesh mode is intentionally left exactly as it was — this guard only
  // applies when voiceMode === "sfu".
  if (mySeatNumber === null) {
    toast("Take a seat to talk");
    return;
  }
  if (voiceMode === "agora") {
    try {
      if (!window.PingPongVoiceAgora) throw new Error("Agora voice module unavailable");
      if (!window.PingPongVoiceAgora.isConnected()) await window.PingPongVoiceAgora.connect({ room: currentRoomId, publish: true });
      micEnabled = !micEnabled;
      await window.PingPongVoiceAgora.setPublishing(micEnabled);
      updateMicButtonUi();
      if (!micEnabled) $("btn-mic-toggle").classList.remove("mic-live");
      return;
    } catch (e) { console.error("[agora] mic toggle failed:", e); toast(e.message || "Voice connection failed"); return; }
  }
  if (!localStream) {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error("[voice] blocked: not a secure context. Current origin:", location.origin);
      toast("HTTPS is required for voice — the mic won't work on phones over http://IP:3000, use ngrok/Cloudflare Tunnel instead");
      return;
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS });
      startVoiceActivityDetection();
      // Phase 3 / Step 3.3: this handler covers the edge case where the mic
      // was never requested via initMicIfNeeded() (e.g. mic permission was
      // denied earlier, then the user retries by tapping the mic button
      // directly). ensureLocalTracksSent() is mesh-only (it walks
      // peerConnections, which stays empty in SFU mode); the SFU
      // equivalent is connecting to the already-joined LiveKit room.
      if (voiceMode === "sfu") { await connectSfuRoom(); } else { ensureLocalTracksSent(); }
    } catch (e) { console.error("[voice] getUserMedia failed:", e.name, e.message); toast("Microphone permission required"); return; }
  }
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  updateMicButtonUi();
  // Mic switched off — immediately drop the live-signal animation instead
  // of waiting for tickVoiceActivity's silence timeout to catch up.
  if (!micEnabled) $("btn-mic-toggle").classList.remove("mic-live");
});

// --- Real-time mic-level analysis: turns actual speaking (not just being
//     seated) into the "speaking" ring, and broadcasts it to the room. ---
let voiceCtx = null, voiceAnalyser = null, voiceDataArray = null, voiceRafId = null;
let lastSpeakingState = false, loudSince = 0, quietSince = 0;

function startVoiceActivityDetection() {
  if (voiceAnalyser || !localStream) return;
  try {
    voiceCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = voiceCtx.createMediaStreamSource(localStream);
    voiceAnalyser = voiceCtx.createAnalyser();
    voiceAnalyser.fftSize = 512;
    source.connect(voiceAnalyser);
    voiceDataArray = new Uint8Array(voiceAnalyser.frequencyBinCount);
    tickVoiceActivity();
  } catch (e) { /* Web Audio unsupported — seat ring just won't be mic-driven */ }
}
function tickVoiceActivity() {
  if (!voiceAnalyser) return;
  voiceAnalyser.getByteFrequencyData(voiceDataArray);
  let sum = 0;
  for (let i = 0; i < voiceDataArray.length; i++) sum += voiceDataArray[i];
  const avg = sum / voiceDataArray.length;
  const level = Math.max(0, Math.min(1, (avg - 8) / 70));
  const now = Date.now();
  voiceLevels.set(String(me.userId), micEnabled ? level : 0);
  if (mySeatNumber && currentRoomId && now - lastVoiceLevelEmitAt >= 90) {
    lastVoiceLevelEmitAt = now;
    socket.volatile.emit("voice-level", { roomId: currentRoomId, level: micEnabled ? Number(level.toFixed(3)) : 0 });
  }
  updateSeatVoiceEffects();
  const isLoud = micEnabled && avg > 12;
  if (isLoud) { quietSince = 0; if (!loudSince) loudSince = now; }
  else { loudSince = 0; if (!quietSince) quietSince = now; }
  const shouldSpeak = isLoud && loudSince && (now - loudSince > 80);
  const shouldStop = !isLoud && quietSince && (now - quietSince > 350);
  if (shouldSpeak && !lastSpeakingState) {
    lastSpeakingState = true;
    if (mySeatNumber && currentRoomId) socket.emit("voice-activity", { roomId: currentRoomId, speaking: true });
    speakingUsers.add(me.userId);
    if (currentRoom) renderSeats(seatsFromMap());
    // Drive the mic-toggle button's live signal-ring animation from the
    // same real mic-level detection as the seat ring, so the toolbar mic
    // icon only "lights up" while the person is actually talking.
    $("btn-mic-toggle")?.classList.add("mic-live");
  } else if (shouldStop && lastSpeakingState) {
    lastSpeakingState = false;
    if (mySeatNumber && currentRoomId) socket.emit("voice-activity", { roomId: currentRoomId, speaking: false });
    speakingUsers.delete(me.userId);
    if (currentRoom) renderSeats(seatsFromMap());
    $("btn-mic-toggle")?.classList.remove("mic-live");
  }
  voiceRafId = requestAnimationFrame(tickVoiceActivity);
}
function stopVoiceActivityDetection() {
  if (voiceRafId) cancelAnimationFrame(voiceRafId);
  voiceRafId = null; voiceAnalyser = null; lastSpeakingState = false;
  if (me?.userId) voiceLevels.set(String(me.userId), 0);
  updateSeatVoiceEffects();
  loudSince = 0; quietSince = 0;
  $("btn-mic-toggle")?.classList.remove("mic-live");
  if (voiceCtx) { voiceCtx.close().catch(() => {}); voiceCtx = null; }
}

function isCurrentRoomMember() {
  if (!me || !currentRoomId || !currentRoom) return false;
  return Array.isArray(currentRoom.onlineUsers) && currentRoom.onlineUsers.some((u) => u && u.userId === me.userId);
}

function ensureRoomAudioTransceiver(pc) {
  // Always negotiate an audio m-line, even when the audience member is the
  // initial offerer and has no microphone stream. Reuse the existing audio
  // transceiver so seat/audience transitions never create duplicate m-lines.
  let transceiver = pc._ppVoiceAudioTransceiver || pc.getTransceivers().find((item) => item.receiver && item.receiver.track && item.receiver.track.kind === "audio");
  if (!transceiver) transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
  if (transceiver.direction !== "sendrecv") transceiver.direction = "sendrecv";
  transceiver.sender._ppVoiceAudioSender = true;
  pc._ppVoiceAudioTransceiver = transceiver;
  return transceiver;
}

function getOrCreatePeer(remoteSocketId) {
  if (peerConnections[remoteSocketId]) return peerConnections[remoteSocketId];
  const pc = new RTCPeerConnection({ iceServers: roomIceServersResolved || ICE_SERVERS.iceServers, bundlePolicy: "max-bundle", rtcpMuxPolicy: "require", iceCandidatePoolSize: 4 });
  // BUG FIX (glare / "can't hear each other"): both sides could end up
  // calling connectToPeer() on each other at close to the same moment (e.g.
  // two people take seats around the same time, or the seat-take fix above
  // now has the new seat *and* the existing seats both connecting to one
  // another). Without a tie-breaker, both sides send an "offer" into the
  // same RTCPeerConnection back-to-back — setRemoteDescription(offer) then
  // throws on whichever side is mid-negotiation, that promise rejection was
  // unhandled, and the connection was left half-negotiated: it can look
  // "connected" at the ICE layer while no audio ever actually flows.
  // `polite` gives every pair a consistent, deterministic winner (compare
  // socket ids) so exactly one side backs off (rolls back its own offer)
  // instead of both throwing.
  pc.polite = socket.id > remoteSocketId;
  pc.makingOffer = false;
  const audioTransceiver = ensureRoomAudioTransceiver(pc);
  if (localStream && mySeatNumber !== null && mySeatNumber !== undefined) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) audioTransceiver.sender.replaceTrack(audioTrack).catch((e) => console.warn("[voice] initial audio track attach failed:", e && e.message));
  }
  const sentCandidates = new Set(); // dedup: candidate exchange only needs each unique candidate once
  const pendingRemoteCandidates = [];
  pc._pendingRemoteCandidates = pendingRemoteCandidates;
  pc._iceRecoveryTimer = null;
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const key = e.candidate.candidate;
    if (sentCandidates.has(key)) return;
    sentCandidates.add(key);
    socket.emit("voice-candidate", { target: remoteSocketId, targetUserId: userIdForSocketId(remoteSocketId), candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    let audioEl = remoteAudioEls[remoteSocketId];
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.controls = false;
      audioEl.preload = "auto";
      audioEl.volume = roomSpeakerOn ? 1 : 0;
      audioEl.muted = !roomSpeakerOn;
      audioEl.setAttribute("playsinline", "");
      audioEl.setAttribute("autoplay", "");
      document.body.appendChild(audioEl);
      remoteAudioEls[remoteSocketId] = audioEl;
    }
    audioEl.srcObject = e.streams[0];
    audioEl.muted = !roomSpeakerOn; audioEl.volume = roomSpeakerOn ? 1 : 0;
    const playRemote = () => { try { const p=audioEl.play(); if(p?.catch)p.catch(()=>{}); } catch(_){} };
    playRemote();
    document.addEventListener("pointerdown", playRemote, { once:true, passive:true });
    audioEl.addEventListener("canplay", playRemote, { once:false });
    setTimeout(playRemote, 300); setTimeout(playRemote, 1200);
  };
  // Production ICE recovery: disconnected can be transient on mobile. Do
  // not tear down a healthy media graph after a 900ms blip. Try one ICE
  // restart first; rebuild only after a bounded recovery window. ICE restart
  // is specifically designed to gather a new candidate set without throwing
  // away the existing media session.
  let iceRestartTried = false;
  let recoveryTimer = null;
  const scheduleRecovery = (delay, forceRestart) => {
    if (recoveryTimer) return;
    recoveryTimer = setTimeout(async () => {
      recoveryTimer = null;
      if (peerConnections[remoteSocketId] !== pc) return;
      const bad = pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected" || pc.connectionState === "failed";
      if (!bad) return;
      if (forceRestart && !iceRestartTried && pc.signalingState === "stable") {
        iceRestartTried = true;
        try { await connectToPeer(remoteSocketId, true); return; } catch (_) {}
      }
      // If the remote Socket.IO session is inside the server's grace window,
      // do NOT tear down the media graph yet. The remote client may only be
      // changing network/transport and will announce a resumed socket shortly.
      // Rebuilding against the old socket during that window is wasteful and
      // can produce duplicate peers when the new socket arrives.
      const remoteUserId = userIdForSocketId(remoteSocketId);
      if (remoteUserId && reconnectingPeerUserIds.has(String(remoteUserId))) {
        scheduleRecovery(3000, false);
        return;
      }
      if (pc.iceConnectionState === "failed" || pc.connectionState === "failed") {
        closePeer(remoteSocketId);
        if (isCurrentRoomMember()) connectToPeer(remoteSocketId, true);
      } else {
        // A transient disconnected state gets one longer grace period before
        // rebuilding. Audience listeners are included; they must recover too.
        scheduleRecovery(2500, false);
      }
    }, delay);
  };
  pc._recoveryTimer = () => { if (recoveryTimer) clearTimeout(recoveryTimer); recoveryTimer = null; };
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === "connected" || state === "completed") {
      iceRestartTried = false;
      if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
      return;
    }
    if (state === "disconnected") scheduleRecovery(2500, true);
    else if (state === "failed") scheduleRecovery(250, true);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      iceRestartTried = false;
      if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
    } else if (pc.connectionState === "failed") {
      scheduleRecovery(250, true);
    }
  };
  pc._diagTimer = startConnectionDiagnostics(pc, `room-peer:${remoteSocketId}`);
  peerConnections[remoteSocketId] = pc;
  return pc;
}

async function connectToPeer(remoteSocketId, iceRestart) {
  if (!remoteSocketId || remoteSocketId === socket.id) return;
  const pc = getOrCreatePeer(remoteSocketId);
  // Deterministic offerer for a brand-new pair: only the lexicographically
  // lower socket id starts the initial negotiation. This sharply reduces
  // three-way join glare while preserving perfect-negotiation handling for
  // reconnects and ICE restarts.
  if (!iceRestart && socket.id > remoteSocketId && pc.signalingState === "stable" && !pc.makingOffer) return;
  // Don't stack a second offer on top of one we're already sending, and
  // don't offer mid-negotiation unless this is a forced ICE restart.
  if (pc.makingOffer || (pc.signalingState !== "stable" && !iceRestart)) return;
  try {
    pc.makingOffer = true;
    const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await pc.setLocalDescription(applyOpusFEC(offer));
    socket.emit("voice-offer", { target: remoteSocketId, targetUserId: userIdForSocketId(remoteSocketId), offer: pc.localDescription });
  } finally {
    pc.makingOffer = false;
  }
}

function closePeer(remoteSocketId) {
  const pc = peerConnections[remoteSocketId];
  if (pc) {
    if (pc._diagTimer) clearInterval(pc._diagTimer);
    if (pc._recoveryTimer) pc._recoveryTimer();
    pc._pendingRemoteCandidates = [];
    pc.onicecandidate = null; pc.ontrack = null; pc.oniceconnectionstatechange = null; pc.onconnectionstatechange = null;
    pc.close();
    delete peerConnections[remoteSocketId];
  }
  const audioEl = remoteAudioEls[remoteSocketId];
  if (audioEl) { audioEl.remove(); delete remoteAudioEls[remoteSocketId]; }
}

// PHASE 3 item #4 fix (2026-08-11) — bridges into the Android wrapper's
// VoiceForegroundService (see MainActivity.kt/VoiceForegroundService.kt)
// so the OS keeps this app's process at foreground priority for exactly
// as long as the user is actually in a voice room (seated or listening),
// not for the app's whole open/backgrounded lifetime. `window.AndroidVoiceBridge`
// only exists inside the Android WebView wrapper (added via
// addJavascriptInterface) — on a plain desktop/mobile browser it's
// undefined, so this is a silent no-op there, same "additive, zero effect
// outside its own platform" pattern as public/voice-sfu.js's own CDN-load
// guard. Wrapped in try/catch as an extra safety net: a JS bridge call
// throwing here must never be able to break room join/leave itself.
function notifyAndroidVoiceSession(active) {
  try {
    if (!window.AndroidVoiceBridge) return;
    if (active) { if (typeof window.AndroidVoiceBridge.onVoiceSessionStart === "function") window.AndroidVoiceBridge.onVoiceSessionStart(); }
    else { if (typeof window.AndroidVoiceBridge.onVoiceSessionEnd === "function") window.AndroidVoiceBridge.onVoiceSessionEnd(); }
  } catch (e) { console.error("[voice] AndroidVoiceBridge call failed:", e && e.message); }
}

function teardownVoice() {
  // Phase 3 / Step 3.3: mesh cleanup below is unchanged and harmless to run
  // even in SFU mode (peerConnections is simply always empty there, so
  // this loop is a no-op). SFU-specific cleanup (LiveKit disconnect +
  // /api/voice-sfu/leave) is fired alongside it, not instead of it.
  if (voiceMode === "sfu") teardownSfuVoice();
  if (voiceMode === "agora") window.PingPongVoiceAgora?.disconnect().catch(() => {});
  Object.keys(peerConnections).forEach(closePeer);
  stopVoiceActivityDetection();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  micEnabled = false;
  updateMicButtonUi();
  mySeatNumber = null;
  speakingUsers.clear(); musicUsers.clear(); voiceLevels.clear();
  notifyAndroidVoiceSession(false); // PHASE 3 item #4 fix
}

// ===========================================================================
// WEBRTC VOICE — SFU (Phase 3 / Step 3.3, additive)
// ===========================================================================
// Everything in this section only ever runs when voiceMode === "sfu" (set
// by refreshVoiceMode(), which itself only ever returns "sfu" when the
// SERVER reports VOICE_MODE=sfu — see /api/voice-sfu/mode in
// voice_sfu/index.js). None of the functions above this section call into
// here except through that guard, and nothing here calls into the mesh
// functions above (connectToPeer, getOrCreatePeer, closePeer) — the two
// transports never mix for a single voice session.

// Mirrors initMicIfNeeded()'s mesh branch as closely as possible: same
// secure-context check, same VOICE_AUDIO_CONSTRAINTS, same
// startVoiceActivityDetection() call so the speaking ring / socket
// "voice-activity" broadcast work identically regardless of transport.
// The only difference is what happens with the resulting localStream once
// we have it: connectSfuRoom() publishes it to LiveKit instead of adding
// it as a track on a set of RTCPeerConnections.
async function initSfuMicIfNeeded() {
  sfuVoiceLeaving = false;
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.error("[voice-sfu] blocked: not a secure context (need https:// or http://localhost). Current origin:", location.origin);
    toast("HTTPS is required for voice — the mic won't work on phones over http://IP:3000, use ngrok/Cloudflare Tunnel instead");
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS });
    localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    startVoiceActivityDetection();
  } catch (e) {
    console.error("[voice-sfu] getUserMedia failed:", e.name, e.message);
    toast("Microphone permission required");
    return;
  }
  await connectSfuRoom();
}

// Mints a LiveKit token via POST /api/voice-sfu/join (seat-checked
// server-side, see roomManager.isUserSeatedInRoom in voice_sfu/index.js)
// and hands it to public/voice-sfu.js to actually connect. Idempotent —
// safe to call again while already connected (sfuConnected guards it) or
// from more than one call site (initSfuMicIfNeeded() and the mic-toggle
// retry path both reach this).
let sfuRecoveryTimer = null;
let sfuRecoveryAttempt = 0;
let sfuRecoveryRunning = false;
let sfuVoiceLeaving = false;

function cancelSfuRecovery() {
  if (sfuRecoveryTimer) { clearTimeout(sfuRecoveryTimer); sfuRecoveryTimer = null; }
  sfuRecoveryAttempt = 0;
  sfuRecoveryRunning = false;
}

// ROOT-CAUSE FIX (2026-09-26, "audience can't hear seated user"): "healthy"
// for a seated publisher means the Room is connected AND the mic is actually
// publishing — not just Room-connected. isConnected() alone was true for a
// seated user stuck in the seat-publish-permission race (see
// voice-sfu.js's isMicPublished() comment), which made every check below
// (the early-exit guard, the post-attempt cancelSfuRecovery() check, and the
// finally-block "still broken, retry" check) wrongly treat that user as
// already fixed. A single helper keeps all three checks in sync.
function sfuIsHealthy() {
  const seated = mySeatNumber !== null && mySeatNumber !== undefined;
  if (!window.PingPongVoiceSFU.isConnected()) return false;
  return seated ? window.PingPongVoiceSFU.isMicPublished() : true;
}

function scheduleSfuRecovery(reason = "unknown") {
  if (sfuVoiceLeaving || voiceMode !== "sfu" || !currentRoomId || !me) return;
  if (sfuRecoveryTimer || sfuRecoveryRunning) return;
  const delay = Math.min(30000, Math.max(500, 500 * Math.pow(2, Math.min(sfuRecoveryAttempt, 6))));
  sfuRecoveryAttempt++;
  sfuRecoveryTimer = setTimeout(async () => {
    sfuRecoveryTimer = null;
    if (sfuVoiceLeaving || !currentRoomId || !me || sfuIsHealthy()) return;
    sfuRecoveryRunning = true;
    try {
      // Rebuild the local microphone only when this user is seated. Audience
      // listeners reconnect without requesting microphone permission.
      if (mySeatNumber !== null && mySeatNumber !== undefined) {
        if (!localStream) {
          await initSfuMicIfNeeded();
        } else {
          await connectSfuRoom();
        }
      } else {
        await connectSfuAsAudience();
      }
      if (sfuIsHealthy()) cancelSfuRecovery();
    } catch (e) {
      console.warn("[voice-sfu] recovery attempt failed:", reason, e && e.message);
    } finally {
      sfuRecoveryRunning = false;
      if (!sfuIsHealthy() && !sfuVoiceLeaving) scheduleSfuRecovery("retry");
    }
  }, delay);
}

async function recoverSfuAfterDisconnect(reason) {
  if (reason === "reconnecting" || reason === "reconnected") return;
  sfuConnected = false;
  scheduleSfuRecovery(reason || "disconnected");
}

async function connectSfuRoom() {
  if (!currentRoomId || !me || !localStream) return;
  // PHASE 3, STEP 3.6 — audience -> seat upgrade path. If we're already
  // connected to the LiveKit room (as a subscribe-only audience listener,
  // see connectSfuAsAudience below), publish the mic onto that SAME
  // connection instead of disconnecting and reconnecting — the design
  // this step's spec calls for ("no unnecessary reconnect if the SDK
  // allows it"). Server-side publish permission for our identity is
  // granted independently by voice_sfu/sync.js's onSeatChanged, fired by
  // the very same take-seat/mod-move-seat event that led here — this
  // block never grants itself permission, it only attempts the publish.
  if (window.PingPongVoiceSFU.isConnected()) {
    const micTrack = localStream.getAudioTracks()[0];
    if (!micTrack) { sfuConnected = false; scheduleSfuRecovery("seat-no-mic-track"); return; }
    try {
      const ok = await window.PingPongVoiceSFU.publishMicTrack(micTrack);
      if (!ok) throw new Error("LiveKit did not confirm microphone publication");
    } catch (e) {
      // Known race, documented in PHASE3_STEP36_REPORT.md: sync.js's
      // onSeatChanged is fire-and-forget on the server, so the LiveKit-
      // side permission grant may not have landed yet when we tried to
      // publish. One short retry covers the normal case; if it still
      // fails, the mic-toggle button lets the person retry manually
      // (spec requirement: never crash the room over this).
      console.error("[voice-sfu] publish (upgrade) failed; retrying with bounded backoff:", e && e.message);
      let published = false;
      for (const delay of [400, 800, 1600, 3000]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try { await window.PingPongVoiceSFU.publishMicTrack(micTrack); published = true; break; }
        catch (e2) { console.warn("[voice-sfu] publish retry failed:", e2 && e2.message); }
      }
      if (!published) { sfuConnected = false; scheduleSfuRecovery("seat-publish-permission"); return; }
    }
    sfuConnected = true;
    cancelSfuRecovery();
    return;
  }
  if (sfuConnected) return; // defensive: sfuConnected true but no live Room reference (e.g. mid-teardown) — avoid a duplicate join attempt
  try {
    const res = await fetch("/api/voice-sfu/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: currentRoomId, userId: me.userId, userName: me.name })
    });
    const data = await res.json();
    if (!data || !data.success) {
      console.error("[voice-sfu] /api/voice-sfu/join failed:", data && data.message);
      return; // spec requirement #9: never crash the room — just stay without SFU audio this session
    }
    if (data.mode !== "sfu") return; // server flipped back to mesh between our mode-check and this join — nothing to connect to here, mesh path was never touched anyway
    const micTrack = localStream.getAudioTracks()[0];
    await window.PingPongVoiceSFU.connect({
      url: data.livekitUrl,
      token: data.token,
      micTrack,
      onSpeakingChanged: (userId, speaking) => {
        if (!userId || (me && userId === me.userId)) return; // our own speaking already reaches everyone via the existing socket "voice-activity" broadcast
        if (speaking) speakingUsers.add(userId); else speakingUsers.delete(userId);
        if (currentRoom) renderSeats(seatsFromMap());
      },
      onDisconnected: (state) => {
        if (state === "reconnecting" || state === "reconnected") return;
        recoverSfuAfterDisconnect(state || "disconnected");
      }
    });
    sfuConnected = true;
  } catch (e) {
    // spec requirement #9: LiveKit connection failure must fall back
    // gracefully and never crash the room. Known, documented limitation
    // (see PHASE3_STEP33_REPORT.md): this does not re-route to mesh
    // mid-session — the user keeps their mic/VAD/UI working normally, but
    // won't exchange SFU audio with others until a fresh room join
    // succeeds in connecting.
    console.error("[voice-sfu] connect failed:", e && e.message);
    sfuConnected = false;
  }
}

// PHASE 3, STEP 3.6 addition — audience (non-seated) SFU listening.
// Joins the mapped LiveKit room as a subscribe-only participant: no
// getUserMedia call, no mic permission prompt, canPublish:false baked
// into the token server-side (see provider.js). Idempotent — guarded by
// window.PingPongVoiceSFU.isConnected(), so it's safe to call on every
// room-state sync (join, reconnect, refresh) without ever double-
// connecting a seated user who's already publishing.
async function connectSfuAsAudience() {
  sfuVoiceLeaving = false;
  if (!currentRoomId || !me || voiceMode !== "sfu") return;
  if (window.PingPongVoiceSFU.isConnected()) return;
  try {
    const res = await fetch("/api/voice-sfu/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: currentRoomId, userId: me.userId, userName: me.name })
    });
    const data = await res.json();
    if (!data || !data.success || data.mode !== "sfu") return; // never crash the room — silently stay without SFU audio this session, same fallback posture as connectSfuRoom
    await window.PingPongVoiceSFU.connect({
      url: data.livekitUrl,
      token: data.token,
      // no micTrack — audience never publishes
      onSpeakingChanged: (userId, speaking) => {
        if (!userId || (me && userId === me.userId)) return;
        if (speaking) speakingUsers.add(userId); else speakingUsers.delete(userId);
        if (currentRoom) renderSeats(seatsFromMap());
      },
      onDisconnected: (state) => {
        if (state === "reconnecting" || state === "reconnected") return;
        recoverSfuAfterDisconnect(state || "disconnected");
      }
    });
    sfuConnected = true;
  } catch (e) {
    console.error("[voice-sfu] audience connect failed:", e && e.message);
    sfuConnected = false;
  }
}

// PHASE 3, STEP 3.6 addition — the seat -> audience counterpart. Stops
// publishing (unpublishes the LiveKit track AND releases the actual mic
// hardware — the stronger of the two guarantees, so the browser's mic-
// in-use indicator turns off, not just a server-side permission flag)
// while KEEPING the LiveKit Room connected so the user keeps hearing
// seated speakers as an audience member. This is the client-side half of
// the exact same transition voice_sfu/sync.js's onSeatChanged already
// performs server-side (revoking the LiveKit publish grant).
async function downgradeSfuToAudience() {
  if (voiceMode !== "sfu") return;
  if (window.PingPongVoiceSFU.isConnected()) {
    try { await window.PingPongVoiceSFU.unpublishMicTrack(); }
    catch (e) { console.error("[voice-sfu] unpublish on downgrade failed:", e && e.message); }
  }
  stopVoiceActivityDetection();
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  micEnabled = false;
  updateMicButtonUi();
}

async function teardownSfuVoice() {
  sfuVoiceLeaving = true;
  cancelSfuRecovery();
  if (sfuConnected) {
    try { await window.PingPongVoiceSFU.disconnect(); } catch (e) { /* already gone — safe to ignore */ }
    sfuConnected = false;
  }
  if (currentRoomId && me) {
    // Best-effort bookkeeping only (see voice_sfu/roomManager.js) — fire
    // and forget, same as the rest of this app's non-critical POSTs.
    fetch("/api/voice-sfu/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: currentRoomId, userId: me.userId })
    }).catch(() => {});
  }
}

// ===========================================================================
// SVIP CENTER — cumulative Diamond recharge + gated privilege controls
// ===========================================================================
let svipCenterStatus = null;
let svipCenterConfig = null;
const SVIP_FEATURE_LABELS = {
  visitorDetails: "Visitor details",
  hideLastOnline: "Hide Last Online",
  antiTracking: "Anti-Tracking",
  hideOnlineStatus: "Hide Online Status",
  unbanAccount: "Unban Account",
  sid: "SID",
  anonymousRanking: "Anonymous Ranking",
  banAccount: "Ban Account",
  roomSecretLord: "Room Secret Lord"
};
function svipMoney(n){ return Number(n||0).toLocaleString(); }
function svipProgress(status){
  const total=Number(status?.rechargeTotal||0), level=Number(status?.level||0);
  const next=Number(status?.nextTarget||0);
  if(!next) return 100;
  const current=level>0?Number(status?.thresholds?.[`SVIP${level}`]||0):0;
  return Math.max(0,Math.min(100,Math.round(((total-current)/(next-current||1))*100)));
}
async function openSvipCenter(){
  if(!me?.userId) return;
  showView("view-svip-center");
  const r=await api(`/api/svip/privileges/${encodeURIComponent(me.userId)}`);
  if(!r.success){ toast(r.message||"Could not load SVIP"); return; }
  svipCenterStatus=r;
  renderSvipCenter();
}
function renderSvipCenter(){
  const s=svipCenterStatus; if(!s) return;
  const levelEl=$("svip-center-level"), totalEl=$("svip-center-total"), nextEl=$("svip-center-next"), bar=$("svip-center-progress-bar"), remain=$("svip-center-remaining"), exp=$("svip-center-expiry");
  if(levelEl) levelEl.textContent=s.level?`SVIP${s.level}`:"SVIP 0";
  if(totalEl) totalEl.innerHTML=`${svipMoney(s.rechargeTotal)} <span><img src="/images/icons/icon-diamond-premium.png" class="svip-inline-diamond" alt=""> cumulative recharge</span>`;
  if(nextEl) nextEl.innerHTML=s.nextTarget?`Next: ${svipMoney(s.nextTarget)} <img src="/images/icons/icon-diamond-premium.png" class="svip-inline-diamond" alt="">`:`SVIP12 reached`;
  if(remain) remain.innerHTML=s.nextTarget?`${svipMoney(s.remainingToNext)} <img src="/images/icons/icon-diamond-premium.png" class="svip-inline-diamond" alt=""> remaining to next level`:`Maximum level reached`;
  if(bar) bar.style.width=svipProgress(s)+"%";
  if(exp) exp.textContent=s.expireAt?`Active until ${new Date(s.expireAt).toLocaleString()}`:"No active SVIP entitlement";
  const list=$("svip-feature-list"); if(!list) return; list.innerHTML="";
  Object.entries(s.features||{}).forEach(([key,f])=>{
    const row=document.createElement("div"); row.className="svip-feature-row";
    const unlocked=!!f.unlocked;
    row.innerHTML=`<div class="svip-feature-copy"><b>${escapeHtml(SVIP_FEATURE_LABELS[key]||f.label)}</b><small>SVIP${f.minLevel}${unlocked?" · Unlocked":" · Locked"}</small></div><label class="pp-switch"><input type="checkbox" data-svip-feature="${key}" ${f.enabled?"checked":""} ${unlocked?"":"disabled"}><i></i></label>`;
    list.appendChild(row);
  });
  list.querySelectorAll("input[data-svip-feature]").forEach(input=>input.addEventListener("change",async()=>{
    const key=input.getAttribute("data-svip-feature"); input.disabled=true;
    const r=await api(`/api/svip/privileges/${encodeURIComponent(key)}/toggle`,"POST",{enabled:input.checked});
    if(!r.success){ input.checked=!input.checked; toast(r.message||"SVIP privilege update failed"); }
    else { svipCenterStatus=r.status; renderSvipCenter(); }
  }));
  const banInfo=$("svip-ban-quota"), unbanInfo=$("svip-unban-quota");
  if(banInfo) banInfo.textContent=`${s.usage?.banCount||0} / ${s.usage?.banQuota||0} Ban actions this month`;
  if(unbanInfo) unbanInfo.textContent=`${s.usage?.unbanCount||0} / ${s.usage?.unbanQuota||0} Unban applications this month`;
  const sidCurrent=$("svip-sid-current"); if(sidCurrent) sidCurrent.textContent=s.sid?.customId||"Not set";
}
async function submitSvipUnban(){
  const id=$("svip-unban-user-id")?.value.trim(); if(!id) return toast("Enter the target User ID");
  const reason=prompt("Reason for the unban application (optional):","")||"";
  const r=await api("/api/svip/unban-application","POST",{targetUserId:id,reason});
  toast(r.success?"Unban application submitted":(r.message||"Could not submit application")); if(r.success){svipCenterStatus=r.status;renderSvipCenter();}
}
async function submitSvipBan(){
  const id=$("svip-ban-user-id")?.value.trim(); if(!id) return toast("Enter the target User ID");
  const reason=prompt("Reason for the 24-hour SVIP ban:","Community rule violation")||"Community rule violation";
  if(!confirm(`Apply a 24-hour SVIP ban to User ID ${id}?`)) return;
  const r=await api("/api/svip/ban-account","POST",{targetUserId:id,reason});
  toast(r.success?"Account banned for 24 hours":(r.message||"Could not ban account")); if(r.success){svipCenterStatus=r.status;renderSvipCenter();}
}
async function submitSvipSid(){
  const sid=$("svip-sid-input")?.value.trim(); if(!sid) return toast("Enter a numeric SID");
  const r=await api("/api/svip/sid-application","POST",{sid});
  toast(r.success?"SID application submitted":(r.message||"Could not submit SID")); if(r.success){svipCenterStatus=r.status;renderSvipCenter();}
}

// ===========================================================================
// PROFILE
// ===========================================================================


async function openProfileVisitors() {
  if (!me) return;
  const modal = $("modal-profile-visitors");
  const list = $("profile-visitors-list");
  const countEl = $("profile-visitors-count");
  const avatars = $("profile-visitors-avatars");
  const lock = $("profile-visitors-lock");
  if (!modal || !list) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  list.innerHTML = '<span class="pp-gifts-empty">Loading visitors…</span>';
  if (avatars) avatars.innerHTML = "";
  if (lock) lock.classList.add("hidden");
  if (countEl) countEl.textContent = "Visitors";
  try {
    const r = await api("/api/user/" + encodeURIComponent(me.userId) + "/visitors");
    const visitors = Array.isArray(r.visitors) ? r.visitors : [];
    const total = Number(r.total || me.visitors || 0);
    if (countEl) countEl.textContent = `${total} Visitor${total === 1 ? "" : "s"}`;

    // Normal users keep the visitor counter but cannot see identities. There
    // is intentionally no broken/interactive "Enable SVIP1" button here.
    if (r.svipRequired) {
      if (avatars) avatars.innerHTML = '<div class="pp-visitors-avatar-placeholder">•••</div>';
      if (lock) lock.classList.remove("hidden");
      list.innerHTML = "";
      return;
    }

    if (!r.success || !visitors.length) {
      list.innerHTML = '<span class="pp-gifts-empty">No visitors recorded yet.</span>';
      return;
    }

    if (avatars) {
      visitors.slice(0, 6).forEach(v => {
        const img = document.createElement("img");
        img.className = "pp-visitors-avatar";
        img.src = v.photo || placeholderAvatar(v.name || "User");
        img.alt = v.name || "Visitor";
        img.title = v.name || "Visitor";
        img.addEventListener("click", () => { closeProfileVisitors(); openOtherProfile(v.userId); });
        avatars.appendChild(img);
      });
      if (visitors.length > 6) {
        const more = document.createElement("div");
        more.className = "pp-visitors-avatar-more";
        more.textContent = "•••";
        avatars.appendChild(more);
      }
    }

    list.innerHTML = "";
    visitors.forEach(v => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "pp-visitor-row";
      const roomText = v.inRoom && v.roomName ? `In room: ${v.roomName}` : (v.online ? "Online · not in a room" : "Offline");
      const seenText = v.visitedAt ? new Date(v.visitedAt).toLocaleString() : "";
      row.innerHTML = `<img src="${escapeHtml(v.photo || placeholderAvatar(v.name || "User"))}" alt=""><span><b>${escapeHtml(v.name || "User")}</b><small>ID: ${escapeHtml(v.userId || "")}</small><small>${escapeHtml(roomText)}${seenText ? " · " + escapeHtml(seenText) : ""}</small></span><strong>›</strong>`;
      row.addEventListener("click", () => {
        closeProfileVisitors();
        openOtherProfile(v.userId);
      });
      list.appendChild(row);
    });
  } catch (_) {
    list.innerHTML = '<span class="pp-gifts-empty">Could not load visitors.</span>';
  }
}
function closeProfileVisitors() {
  const modal = $("modal-profile-visitors");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}
function closeProfileVisitorsToHome() {
  closeProfileVisitors();
  // Visitors is a profile sub-screen, so both the visible back/close control
  // and Android/browser back must return to the Home view instead of leaving
  // the SPA at localhost or doing nothing.
  try { showView("view-home"); } catch (_) {}
  try { loadRoomList(); } catch (_) {}
}

$("btn-close-profile-visitors")?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeProfileVisitorsToHome();
}, true);
$("modal-profile-visitors")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeProfileVisitorsToHome();
});

// Mobile/webview hardening: some Android WebViews can route taps through a
// fixed overlay layer. Keep a capture-phase delegated listener as a second
// path so the Visitors back button always closes.
document.addEventListener("click", (e) => {
  const target = e.target?.closest?.("#btn-close-profile-visitors");
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  closeProfileVisitorsToHome();
}, true);

$("profile-visitors")?.closest(".pp-stat")?.addEventListener("click", openProfileVisitors);

// Android/browser system-back support for the Visitors full-screen panel.
window.addEventListener("popstate", () => {
  const modal = $("modal-profile-visitors");
  if (modal && !modal.classList.contains("hidden")) closeProfileVisitorsToHome();
});

async function openOwnProfile() {
  const r = await api("/api/user/" + me.mobile);
  if (r.success) { me = r.user; saveSession(); }
  clearCpProfileComposite("profile-avatar-frame");
  $("profile-avatar").src = me.photo || placeholderAvatar(me.name);
  applyOwnProfileBackground();
  $("profile-name-display").textContent = me.name;
  applyProfileNameEffect($("profile-name-display"), me);
  $("profile-name-input").value = me.name;
  $("profile-bio-input").value = me.bio || "";
  applyIdDisplay($("profile-userid"), me);
  // Country badge must always reflect this account's actual ISO country.
  // The HTML has a legacy India placeholder, so refresh it from the freshly
  // loaded profile every time the own-profile page opens.
  applyCountryFlag($("pp-country-badge"), me);
  $("profile-visitors").textContent = me.visitors || 0;
  $("profile-followers").textContent = me.followers;
  $("profile-following").textContent = me.following;
  $("menu-wallet-diamonds").textContent = me.diamonds;
  $("menu-wallet-beans").textContent = me.beans || 0;
  applyVipBadge($("profile-vip-badge"), me.vipLevel);
  applyLevelBadge($("profile-level-badge"), me.level || 1);
  applyCustomTag($("profile-tag-badge"), me.customTag);
  applyFrameRing($("profile-avatar-frame"), me.vipLevel);
  applyCustomFrame($("profile-avatar-frame"), me.activeFrame);
  refreshMySvipTag();
  refreshSellerTagFor(me.userId, $("profile-seller-badge"));
  applySellerOfficialTags($("profile-seller-tag"), $("profile-official-tag"), me.activeBadges, $("profile-agency-tag"));
      applyMerchantTag($("profile-merchant-tag"), me.activeBadges);
  $("profile-edit-panel").classList.add("hidden");
  checkAgencyMenu();
  // IMPORTANT: the main Me/Profile page is intentionally CP-neutral.
  // CP pairing visuals belong only to the room/profile sheets. Do not load
  // the CP Center here and do not place a second profile/ID on this page.
showView("view-profile");
}

$("btn-copy-id").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(me.userId);
    const btn = $("btn-copy-id");
    btn.classList.add("copied");
    toast("ID copied");
    setTimeout(() => btn.classList.remove("copied"), 1500);
  } catch (e) { toast("Could not copy"); }
});

$("menu-edit-profile").addEventListener("click", () => {
  const panel = $("profile-edit-panel");
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (opening) {
    $("profile-name-input").value = me?.name || "";
    $("profile-bio-input").value = me?.bio || "";
    $("profile-name-input").focus();
  }
});

$("btn-save-profile").addEventListener("click", async () => {
  const name = $("profile-name-input").value.trim();
  const bio = $("profile-bio-input").value.trim();
  if (!name) { toast("Enter your name"); $("profile-name-input").focus(); return; }
  if (name.length > 40) { toast("Name must be 40 characters or fewer"); return; }
  if (bio.length > 160) { toast("Bio must be 160 characters or fewer"); return; }
  const btn = $("btn-save-profile");
  btn.disabled = true;
  try {
    const r = await api("/api/user/update-profile", "POST", { name, bio });
    if (r.success) {
      // Name/Bio-only editor must preserve and immediately re-render existing
      // account preferences (country/language are not edited here).
      me = r.user; saveSession(); applyLanguage(me.language); applyCountryFlag($("pp-country-badge"), me); fillHomeProfile();
      $("profile-edit-panel").classList.add("hidden");
      toast("Profile updated");
    } else toast(r.message || "Something went wrong");
  } catch (e) { toast("Could not update profile. Please try again."); }
  finally { btn.disabled = false; }
});

$("profile-photo-input").addEventListener("change", async (e) => {
  const input = e.target;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) throw new Error("Choose a JPG, PNG, WEBP or GIF image.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Profile photo must be 10MB or smaller.");
    // Normalize to a centered square before upload to prevent oversized/orientation-odd avatars.
    // The server still performs authoritative type/size validation.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - side) / 2), sy = Math.floor((bitmap.height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Image crop is not supported on this device.");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, 512, 512);
    bitmap.close?.();
    const cropped = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not process this image.")), "image/jpeg", 0.88));
    const fd = new FormData();
    fd.append("photo", cropped, "profile-crop.jpg");
    const r = await apiUpload("/api/user/upload-photo", fd);
    if (r.success) {
      me.photo = r.url; saveSession();
      $("profile-avatar").src = r.url;
      fillHomeProfile();
      toast("Profile photo updated");
    } else toast(r.message || "Upload failed");
  } catch (err) { toast(err.message || "Could not crop this image"); }
  finally { input.value = ""; }
});

// Prevent accidental dragging/saving gestures on decorative UI icons. This is a
// usability guard only; actual asset confidentiality must be enforced server-side.
document.addEventListener("dragstart", e => {
  if (e.target instanceof HTMLImageElement && (e.target.closest(".nav-btn, .icon-btn, .agency-stat-icon, .agency-badge-image") || /\/icons\//.test(e.target.src))) e.preventDefault();
});
document.addEventListener("contextmenu", e => {
  if (e.target instanceof HTMLImageElement && (e.target.closest(".nav-btn, .icon-btn, .agency-stat-icon, .agency-badge-image") || /\/icons\//.test(e.target.src))) e.preventDefault();
});

$("profile-background-input")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!/^image\//i.test(file.type)) { toast("Please select an image"); e.target.value = ""; return; }
  if (file.size > 10 * 1024 * 1024) { toast("Background must be 10MB or smaller"); e.target.value = ""; return; }
  const fd = new FormData();
  fd.append("background", file);
  const r = await apiUpload("/api/user/upload-profile-background", fd);
  if (r.success) {
    me.profileBackground = r.url;
    saveSession();
    applyOwnProfileBackground();
    toast("Profile background updated");
  } else toast(r.message || "Background upload failed");
  e.target.value = "";
});

function applyOwnProfileBackground() {
  const hero = $("view-profile")?.querySelector(".pp-profile-hero");
  if (!hero) return;
  hero.classList.toggle("has-custom-profile-bg", !!me?.profileBackground);
  if (me?.profileBackground) hero.style.setProperty("--profile-bg-image", `url("${String(me.profileBackground).replace(/["\\]/g, "")}")`);
  else hero.style.removeProperty("--profile-bg-image");
}

document.querySelectorAll("[data-follow-list]").forEach((btn) => {
  btn.addEventListener("click", () => openFollowList(btn.getAttribute("data-follow-list")));
});

let followListUsers = [];
function renderFollowListUsers() {
  const wrap = $("follow-list-items");
  const query = String($("follow-list-search")?.value || "").trim().toLowerCase();
  const filtered = followListUsers.filter(u => `${u.name || ""} ${u.userId || ""} ${u.customId || ""}`.toLowerCase().includes(query));
  wrap.innerHTML = "";
  $("follow-list-count").textContent = `${filtered.length} ${followListMode === "followers" ? "Followers" : "Following"}`;
  $("follow-list-empty").classList.toggle("hidden", followListUsers.length > 0);
  $("follow-list-no-results").classList.toggle("hidden", followListUsers.length === 0 || filtered.length > 0);
  $("follow-list-search-clear")?.classList.toggle("hidden", !query);
  filtered.forEach((u) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "user-row pp-follow-user-card";
    row.setAttribute("aria-label", `View ${u.name || "user"} profile`);
    const photo = u.photo || placeholderAvatar(u.name);
    row.innerHTML = `<span class="pp-follow-avatar-wrap"><img class="avatar avatar-sm pp-follow-avatar" src="${escapeHtml(photo)}" alt="${escapeHtml(u.name || "User")}" loading="lazy"><span class="pp-follow-avatar-shine"></span></span><span class="user-row-body"><span class="name">${escapeHtml(u.name || "User")}</span><span class="sub">ID: ${escapeHtml(u.customId || u.userId || "—")}</span><span class="pp-follow-card-hint">View profile <span aria-hidden="true">›</span></span></span><span class="pp-follow-chevron" aria-hidden="true">›</span>`;
    row.addEventListener("click", () => openOtherProfile(u.userId));
    wrap.appendChild(row);
  });
}
async function openFollowList(mode) {
  followListMode = mode;
  $("follow-list-title").textContent = mode === "followers" ? "Followers" : "Following";
  if ($("follow-list-search")) $("follow-list-search").value = "";
  const r = await api(`/api/user/${me.mobile}/${mode}`);
  followListUsers = r.success ? (r[mode] || []) : [];
  renderFollowListUsers();
  showView("view-follow-list");
}
$("follow-list-search")?.addEventListener("input", renderFollowListUsers);
$("follow-list-search-clear")?.addEventListener("click", () => { $("follow-list-search").value = ""; renderFollowListUsers(); $("follow-list-search").focus(); });

$("btn-back-follow-list").addEventListener("click", openOwnProfile);

let otherProfileUser = null;
async function openOtherProfile(userId) {
  const r = await api("/api/user/by-id/" + encodeURIComponent(userId) + "?viewerId=" + encodeURIComponent(me?.userId || ""));
  if (!r.success) { toast(r.message || "User not found"); return; }
  otherProfileUser = r.user;
  clearCpProfileComposite("other-avatar-frame");
  $("other-avatar").src = otherProfileUser.photo || placeholderAvatar(otherProfileUser.name);
  $("other-name").textContent = otherProfileUser.name;
  applyProfileNameEffect($("other-name"), otherProfileUser);
  applyIdDisplay($("other-userid"), otherProfileUser);
  $("other-followers").textContent = otherProfileUser.followers;
  $("other-following").textContent = otherProfileUser.following;
  $("other-level").textContent = otherProfileUser.level || 1;
  applyVipBadge($("other-vip-badge"), otherProfileUser.vipLevel);
  applyCountryFlag($("other-country-badge"), otherProfileUser);
  applyCustomTag($("other-tag-badge"), otherProfileUser.customTag);
  renderAgencyBadge($("other-agency-badge"), otherProfileUser.agencyBadge);
  applyFrameRing($("other-avatar-frame"), otherProfileUser.vipLevel);
  applyCustomFrame($("other-avatar-frame"), otherProfileUser.activeFrame);
  applyBlueBadge($("other-blue-badge"), otherProfileUser.activeBadges);
  refreshSvipTagFor(otherProfileUser.userId, $("other-svip-tag"));
  refreshSellerTagFor(otherProfileUser.userId, $("other-seller-badge"));
  applySellerOfficialTags($("other-seller-tag"), $("other-official-tag"), otherProfileUser.activeBadges, $("other-agency-tag"));
      applyMerchantTag($("other-merchant-tag"), otherProfileUser.activeBadges);
  const presenceEl = $("other-presence");
  if (presenceEl) {
    const p = otherProfileUser.presence || {};
    presenceEl.textContent = p.inRoom ? `In room${p.roomName ? ": " + p.roomName : ""}` : (p.online ? "Online" : (p.lastOnlineAt ? `Last seen ${new Date(p.lastOnlineAt).toLocaleString()}` : "Offline"));
    presenceEl.classList.toggle("online", !!p.online); presenceEl.classList.toggle("room", !!p.inRoom);
  }
  const amFollowing = (me.followingList || []).includes(otherProfileUser.userId);
  $("btn-follow-toggle").textContent = amFollowing ? "Unfollow" : "Follow";
  chApplyCallButtonVisibility(otherProfileUser.userId);
  await loadOtherRelationshipStatus(otherProfileUser.userId);
  const br = await api("/api/safety/blocked");
  const isBlocked = !!(br.success && Array.isArray(br.blockedUserIds) && br.blockedUserIds.includes(otherProfileUser.userId));
  $("btn-user-block").textContent = isBlocked ? "Unblock" : "Block";
showView("view-other-profile");
}
$("btn-back-other-profile").addEventListener("click", () => showView("view-home"));

$("btn-follow-toggle").addEventListener("click", async () => {
  if (!otherProfileUser) return;
  const amFollowing = (me.followingList || []).includes(otherProfileUser.userId);
  const endpoint = amFollowing ? "/api/user/unfollow" : "/api/user/follow";
  const r = await api(endpoint, "POST", { mobile: me.mobile, targetUserId: otherProfileUser.userId });
  if (r.success) {
    me = r.user; saveSession();
    $("btn-follow-toggle").textContent = (me.followingList || []).includes(otherProfileUser.userId) ? "Unfollow" : "Follow";
  } else toast(r.message || "Something went wrong");
});

$("btn-message-user").addEventListener("click", () => {
  if (!otherProfileUser) return;
  openThread(otherProfileUser.userId, otherProfileUser.name);
});
$("btn-user-block")?.addEventListener("click", async()=>{
  if (!otherProfileUser) return;
  const r0 = await api("/api/safety/blocked");
  const blocked = !!(r0.success && Array.isArray(r0.blockedUserIds) && r0.blockedUserIds.includes(otherProfileUser.userId));
  if (!blocked && !confirm("Block this user? They will not be able to message or audio-call you.")) return;
  const action = blocked ? "unblock" : "block";
  const r = await api("/api/safety/" + action, "POST", {targetUserId: otherProfileUser.userId});
  if (!r.success) return toast(r.message || "Could not update block");
  $("btn-user-block").textContent = blocked ? "Block" : "Unblock";
  toast(blocked ? "User unblocked" : "User blocked");
  if (threadPeerId === otherProfileUser.userId) refreshThreadSafetyActions();
});
$("btn-user-report")?.addEventListener("click",async()=>{if(!otherProfileUser)return;const reason=prompt("Report reason","Harassment or abusive behavior");if(!reason)return;const details=prompt("Additional details (optional)","")||"";const r=await api("/api/safety/report","POST",{targetUserId:otherProfileUser.userId,reason,details});toast(r.success?"Report submitted":(r.message||"Could not submit report"));});

// ===========================================================================
// USER PROFILE BOTTOM SHEET — tapping a seat (or an Online Members row)
// slides this up instead of leaving the room. All data below is read from
// live room state (currentRoom) + the real /api/user/by-id lookup, no demo
// data. Permissions mirror exactly what the server already enforces for
// each action (isOwnerOrAdmin for moderation, hostId-only for admin grant).
// ===========================================================================
function seatNumberForUser(userId) {
  const seats = currentRoom?.seats || [];
  for (let i = 0; i < seats.length; i++) {
    if (seats[i] && seats[i].userId === userId) return i + 1;
  }
  return null;
}

let sheetTargetUserId = null;
let sheetPrimaryUser = null;
let sheetRelationshipStatus = null;
let currentRelationshipLinks = [];
function closeProfileSheet() {
  $("sheet-user-profile").classList.remove("sheet-open");
  setTimeout(() => $("sheet-user-profile").classList.add("hidden"), 220);
}
function openProfileSheetEl() {
  const sheet = $("sheet-user-profile");
  sheet.classList.remove("hidden");
  requestAnimationFrame(() => sheet.classList.add("sheet-open"));
}

function clearCpProfileComposite(frameId) {
  const frame = $(frameId);
  if (!frame) return;
  const composite = frame.querySelector(".cp-profile-composite");
  if (composite) { composite.classList.add("hidden"); composite.setAttribute("aria-hidden", "true"); }
  frame.classList.remove("has-cp-profile");
  const header = frame.closest(".sheet-profile-header");
  if (header) header.classList.remove("has-cp-profile");
  if (frameId === "profile-avatar-frame") {
    const main = frame.closest(".pp-profile-main");
    if (main) main.classList.remove("has-cp-profile");
  }
}

function renderCpProfileComposite(frameId, primaryUser, partnerUser) {
  const frame = $(frameId);
  if (!frame) return;
  const composite = frame.querySelector(".cp-profile-composite");
  const primaryImg = frame.querySelector(".cp-profile-primary-avatar");
  const partnerImg = frame.querySelector(".cp-profile-partner-avatar");
  if (!composite || !primaryImg || !partnerImg || !partnerUser) { clearCpProfileComposite(frameId); return; }

  const existingPrimary = frame.querySelector("#sheet-avatar, #profile-avatar, #other-avatar");
  const primaryPhoto = primaryUser?.photo || existingPrimary?.currentSrc || existingPrimary?.src || "";
  const primaryName = primaryUser?.name || existingPrimary?.alt || "Profile";
  primaryImg.src = primaryPhoto || placeholderAvatar(primaryName);
  primaryImg.alt = primaryName ? `${primaryName} profile photo` : "Profile photo";
  partnerImg.src = partnerUser.photo || placeholderAvatar(partnerUser.name || "CP");
  partnerImg.alt = partnerUser.name ? `${partnerUser.name} CP partner` : "CP partner";

  composite.classList.remove("hidden");
  composite.setAttribute("aria-hidden", "false");
  frame.classList.add("has-cp-profile");
  const header = frame.closest(".sheet-profile-header");
  if (header) header.classList.add("has-cp-profile");
  if (frameId === "profile-avatar-frame") {
    const main = frame.closest(".pp-profile-main");
    if (main) main.classList.add("has-cp-profile");
  }
}

async function renderCpProfileCompositeFromRelationship(frameId, primaryUser, relationship) {
  if (!relationship || relationship.type !== "cp" || relationship.status !== "accepted") {
    clearCpProfileComposite(frameId);
    return;
  }
  const currentId = String(primaryUser?.userId || "");
  const partnerId = String(relationship.userA) === currentId ? relationship.userB : relationship.userA;
  if (!partnerId) { clearCpProfileComposite(frameId); return; }
  try {
    const r = await api(`/api/user/by-id/${encodeURIComponent(partnerId)}?viewerId=${encodeURIComponent(me?.userId || "")}`);
    if (r.success && r.user) renderCpProfileComposite(frameId, primaryUser, r.user);
    else clearCpProfileComposite(frameId);
  } catch (_) { clearCpProfileComposite(frameId); }
}

async function openSeatProfileSheet(userId, seatNumber) {
  if (!currentRoom) return;
  sheetTargetUserId = userId;
  sheetPrimaryUser = null;
  clearCpProfileComposite("sheet-avatar-frame");
  const isMe = userId === me.userId;

  if (isMe) {
    sheetPrimaryUser = me;
    $("sheet-avatar").src = me.photo || placeholderAvatar(me.name);
    $("sheet-name").textContent = me.name;
    applyIdDisplay($("sheet-userid"), me);
    applyLevelBadge($("sheet-level-chip"), me.level || 1);
    applyRoomRoleBadge($("sheet-role-badge"), currentRoom.hostId === me.userId ? "owner" : (currentRoom.adminIds || []).includes(me.userId) ? "admin" : null);
    applyVipBadge($("sheet-vip-badge"), me.vipLevel);
    $("sheet-vip-badge").classList.remove("hidden");
    applyCustomTag($("sheet-tag-badge"), me.customTag);
    renderAgencyBadge($("sheet-agency-badge"), me.agencyBadge, true);
    refreshSvipTagFor(me.userId, $("sheet-svip-tag"));
    refreshSellerTagFor(me.userId, $("sheet-seller-badge"));
    applySellerOfficialTags($("sheet-seller-tag"), $("sheet-official-tag"), me.activeBadges, $("sheet-agency-tag"));
      applyMerchantTag($("sheet-merchant-tag"), me.activeBadges);
    applyFrameRing($("sheet-avatar-frame"), me.vipLevel);
    applyCustomFrame($("sheet-avatar-frame"), me.activeFrame);
    $("sheet-followers-row").classList.add("hidden");
    if (me.bio) { $("sheet-bio").textContent = me.bio; $("sheet-bio").classList.remove("hidden"); }
    else $("sheet-bio").classList.add("hidden");

    $("sheet-quick-actions").querySelectorAll("button").forEach(b => b.classList.add("hidden"));
    $("sheet-btn-profile").classList.remove("hidden");
    $("sheet-admin-section").classList.add("hidden");
    $("sheet-bottom-actions").classList.add("hidden");
    $("sheet-own-actions").classList.toggle("hidden", mySeatNumber === null);
  } else {
    const r = await api("/api/user/by-id/" + userId + "?viewerId=" + me.userId);
    if (!r.success) { toast(r.message || "User not found"); return; }
    const u = r.user;
    sheetPrimaryUser = u;
    $("sheet-avatar").src = u.photo || placeholderAvatar(u.name);
    $("sheet-name").textContent = u.name;
    applyIdDisplay($("sheet-userid"), u);
    applyLevelBadge($("sheet-level-chip"), u.level || 1);
    applyRoomRoleBadge($("sheet-role-badge"), currentRoom.hostId === u.userId ? "owner" : (currentRoom.adminIds || []).includes(u.userId) ? "admin" : null);
    applyVipBadge($("sheet-vip-badge"), u.vipLevel);
    $("sheet-vip-badge").classList.remove("hidden");
    applyCustomTag($("sheet-tag-badge"), u.customTag);
    renderAgencyBadge($("sheet-agency-badge"), u.agencyBadge, true);
    refreshSvipTagFor(u.userId, $("sheet-svip-tag"));
    refreshSellerTagFor(u.userId, $("sheet-seller-badge"));
    applySellerOfficialTags($("sheet-seller-tag"), $("sheet-official-tag"), u.activeBadges, $("sheet-agency-tag"));
    applyFrameRing($("sheet-avatar-frame"), u.vipLevel);
    applyCustomFrame($("sheet-avatar-frame"), u.activeFrame);
    $("sheet-followers-row").classList.remove("hidden");
    $("sheet-followers").textContent = u.followers || 0;
    if (u.bio) { $("sheet-bio").textContent = u.bio; $("sheet-bio").classList.remove("hidden"); }
    else $("sheet-bio").classList.add("hidden");

    $("sheet-quick-actions").querySelectorAll("button").forEach(b => b.classList.remove("hidden"));
    const amFollowing = (me.followingList || []).includes(u.userId);
    $("sheet-btn-follow").textContent = amFollowing ? "Unfollow" : "Follow";
    $("sheet-bottom-actions").classList.remove("hidden");
    $("sheet-own-actions").classList.add("hidden");

    const isOwner = currentRoom.hostId === me.userId;
    const isAdmin = (currentRoom.adminIds || []).includes(me.userId);
    const canModerate = (isOwner || isAdmin || !!me?.can_manage_all) && (userId !== currentRoom.hostId || !!me?.can_manage_all);
    $("sheet-admin-section").classList.toggle("hidden", !canModerate);
    if (canModerate) buildSheetAdminControls(u, seatNumber, isOwner);
  }
  await loadSheetRelationshipStatus(userId);
  openProfileSheetEl();
}

async function fetchRelationshipStatus(targetUserId) {
  if (!targetUserId || targetUserId === me.userId) return null;
  const r = await api("/api/relationships/status/" + targetUserId);
  return r.success ? r : null;
}

function relationshipPairText(rel) {
  if (!rel) return "";
  const ids = [rel.userA, rel.userB].sort();
  return `CP • ID ${ids[0]}  ×  ID ${ids[1]}`;
}

function renderRelationshipControlButtons(containerId, status, targetUserId) {
  const wrap = $(containerId);
  if (!wrap) return;
  const friendship = wrap.querySelector(containerId === "sheet-relationship-actions" ? "#sheet-btn-friendship" : "#btn-other-friendship");
  const unfriend = wrap.querySelector(containerId === "sheet-relationship-actions" ? "#sheet-btn-unfriend" : "#btn-other-unfriend");
  const cp = wrap.querySelector(containerId === "sheet-relationship-actions" ? "#sheet-btn-cp" : "#btn-other-cp");
  const uncp = wrap.querySelector(containerId === "sheet-relationship-actions" ? "#sheet-btn-uncp" : "#btn-other-uncp");
  if (!friendship || !cp) return;
  const rel = status && status.relationship;
  const pending = status && status.pending;
  const set = (btn, label, disabled) => { btn.textContent = label; btn.disabled = !!disabled; };
  if (unfriend) unfriend.classList.add("hidden");
  if (uncp) uncp.classList.add("hidden");
  if (rel) {
    const isFriendship = rel.type === "friendship";
    const isCp = rel.type === "cp";
    set(friendship, isFriendship ? "🤝 Friendship Active" : "🤝 Friendship", isFriendship || !!pending);
    set(cp, isCp ? "💞 CP Active" : "💞 CP", isCp || !!pending);
    if (unfriend && isFriendship) {
      unfriend.classList.remove("hidden");
      unfriend.disabled = false;
      unfriend.textContent = `💔 Unfriend • ${(Math.floor((status.friendshipCost || 20000) / 2)).toLocaleString()} Refund`;
    }
    if (uncp && isCp) {
      uncp.classList.remove("hidden");
      uncp.disabled = false;
      uncp.textContent = `💔 UnCP • ${(Math.floor((status.cpCost || 100000) / 2)).toLocaleString()} Refund`;
    }
    return;
  }
  if (pending) {
    const outgoing = pending.fromUserId === me.userId;
    if (pending.type === "friendship") set(friendship, outgoing ? "🤝 Friendship Sent" : "🤝 Friendship Pending", true);
    else set(friendship, "🤝 Friendship", true);
    if (pending.type === "cp") set(cp, outgoing ? "💞 CP Sent" : "💞 CP Pending", true);
    else set(cp, "💞 CP", true);
    return;
  }
  set(friendship, `🤝 Friendship • ${(status.friendshipCost || 20000).toLocaleString()} Diamonds`, false);
  set(cp, `💞 CP • ${(status.cpCost || 100000).toLocaleString()} Diamonds`, false);
}

async function unfriendRelationship(targetUserId, context) {
  const status = await fetchRelationshipStatus(targetUserId);
  if (!status || !status.relationship || status.relationship.type !== "friendship") {
    toast("Active Friendship not found");
    return;
  }
  const refund = Math.floor((status.friendshipCost || 20000) / 2);
  if (!confirm(`Unfriend this user? The original Friendship payer will receive ${refund.toLocaleString()} Diamonds back.`)) return;
  const r = await api("/api/relationships/unfriend", "POST", { targetUserId });
  if (!r.success) { toast(r.message || "Could not end Friendship"); return; }
  if (r.refundDiamonds && r.refundedUserId === me.userId) {
    me.diamonds = Math.max(0, (me.diamonds || 0) + r.refundDiamonds);
    saveSession();
    fillHomeProfile();
  }
  toast(`💔 Friendship ended${r.refundDiamonds && r.refundedUserId === me.userId ? ` • ${r.refundDiamonds.toLocaleString()} Diamonds refunded` : ""}`);
  if (context === "sheet") await loadSheetRelationshipStatus(targetUserId);
  else await loadOtherRelationshipStatus(targetUserId);
}

async function uncpRelationship(targetUserId, context) {
  const status = await fetchRelationshipStatus(targetUserId);
  if (!status || !status.relationship || status.relationship.type !== "cp") {
    toast("Active CP not found");
    return;
  }
  const refund = Math.floor((status.cpCost || 100000) / 2);
  if (!confirm(`End this CP? The original CP payer will receive ${refund.toLocaleString()} Diamonds back.`)) return;
  const r = await api("/api/relationships/uncp", "POST", { targetUserId });
  if (!r.success) { toast(r.message || "Could not end CP"); return; }
  if (r.refundDiamonds && r.refundedUserId === me.userId) {
    me.diamonds = Math.max(0, (me.diamonds || 0) + r.refundDiamonds);
    saveSession();
    fillHomeProfile();
  }
  toast(`💔 CP ended${r.refundDiamonds && r.refundedUserId === me.userId ? ` • ${r.refundDiamonds.toLocaleString()} Diamonds refunded` : ""}`);
  if (context === "sheet") await loadSheetRelationshipStatus(targetUserId);
  else if (context === "cp-center") await loadCpCenterRelationship();
  else await loadOtherRelationshipStatus(targetUserId);
}

function renderRelationshipProfileStatus(elId, status, targetUserId) {
  const el = $(elId);
  if (!el) return;
  const rel = status && status.relationship;
  if (rel && rel.type === "cp") {
    el.innerHTML = `<span class="relationship-cp-pair">${escapeHtml(relationshipPairText(rel))}</span>`;
    el.classList.remove("hidden");
    return;
  }
  // Friendship is intentionally not displayed as a profile relationship.
  el.innerHTML = "";
  el.classList.add("hidden");
}

async function renderSheetCpPerson(container, user, role) {
  if (!container || !user) return;
  container.innerHTML = "";

  const frame = document.createElement("div");
  frame.className = "avatar-frame-wrap sheet-cp-avatar-frame";
  const avatar = document.createElement("img");
  avatar.className = "avatar sheet-cp-avatar";
  avatar.src = user.photo || placeholderAvatar(user.name || "Profile");
  avatar.alt = user.name ? `${user.name} profile photo` : "Profile photo";
  frame.appendChild(avatar);

  // The frame is a transparent overlay around the real avatar. It never
  // replaces the photo and never composites the partner into this avatar.
  applyFrameRing(frame, user.vipLevel);
  applyCustomFrame(frame, user.activeFrame);

  const name = document.createElement("div");
  name.className = "sheet-cp-name";
  name.textContent = user.name || "Unknown";
  applyProfileNameEffect(name, user);

  const id = document.createElement("div");
  id.className = "sheet-cp-id";
  const idLabel = document.createElement("span");
  idLabel.textContent = "ID: ";
  id.appendChild(idLabel);
  const idValue = document.createElement("span");
  applyIdDisplay(idValue, user);
  id.appendChild(idValue);

  const meta = document.createElement("div");
  meta.className = "sheet-cp-meta";
  const level = document.createElement("span");
  level.className = "room-level-badge room-level-badge-inline sheet-cp-level";
  applyLevelBadge(level, user.level || 1);
  meta.appendChild(level);
  const followers = document.createElement("span");
  followers.className = "sheet-cp-followers";
  followers.textContent = `👥 ${Number(user.followers || 0).toLocaleString()} Followers`;
  meta.appendChild(followers);

  const tags = document.createElement("div");
  tags.className = "sheet-cp-tags";

  if (role === "owner" || role === "admin") {
    const roleTag = document.createElement("span");
    applyRoomRoleBadge(roleTag, role);
    tags.appendChild(roleTag);
  }
  const vip = document.createElement("span");
  applyVipBadge(vip, user.vipLevel);
  tags.appendChild(vip);

  const custom = document.createElement("span");
  applyCustomTag(custom, user.customTag, true);
  if (!custom.classList.contains("hidden")) tags.appendChild(custom);

  const agency = document.createElement("span");
  renderAgencyBadge(agency, user.agencyBadge, true);
  if (!agency.classList.contains("hidden")) tags.appendChild(agency);

  for (const [badgeId, label] of [["agency_tag","Agency"],["seller_tag","Seller"],["official_tag","Official"],["merchant_tag","Merchant"]]) {
    const img = document.createElement("img");
    img.className = "svip-tag-img sheet-cp-tag-img hidden";
    img.alt = label;
    applyExtraBadgeTag(img, user.activeBadges, badgeId);
    if (!img.classList.contains("hidden")) tags.appendChild(img);
  }

  const svip = document.createElement("img");
  svip.className = "svip-tag-img sheet-cp-tag-img hidden";
  svip.alt = "SVIP";
  tags.appendChild(svip);
  refreshSvipTagFor(user.userId, svip).catch(() => {});

  const seller = document.createElement("span");
  seller.className = "seller-badge hidden";
  seller.textContent = "Seller";
  tags.appendChild(seller);
  refreshSellerTagFor(user.userId, seller).catch(() => {});

  container.append(frame, name, id, meta, tags);
}

async function renderSheetCpPair(primaryUser, relationship) {
  const pair = $("sheet-cp-pair");
  const normal = $("sheet-normal-profile-header");
  if (!pair || !normal) return;

  if (!relationship || relationship.type !== "cp" || relationship.status !== "accepted" || !primaryUser) {
    pair.classList.add("hidden");
    pair.setAttribute("aria-hidden", "true");
    normal.classList.remove("hidden");
    return;
  }

  const currentId = String(primaryUser.userId || "");
  const partnerId = String(relationship.userA) === currentId ? relationship.userB : relationship.userA;
  if (!partnerId) {
    pair.classList.add("hidden");
    pair.setAttribute("aria-hidden", "true");
    normal.classList.remove("hidden");
    return;
  }

  try {
    const r = await api(`/api/user/by-id/${encodeURIComponent(partnerId)}?viewerId=${encodeURIComponent(me?.userId || "")}`);
    if (!r.success || !r.user) throw new Error("CP partner not found");
    const partner = r.user;

    const leftRole = currentRoom?.hostId === primaryUser.userId ? "owner" : (currentRoom?.adminIds || []).includes(primaryUser.userId) ? "admin" : null;
    const rightRole = currentRoom?.hostId === partner.userId ? "owner" : (currentRoom?.adminIds || []).includes(partner.userId) ? "admin" : null;
    await Promise.all([
      renderSheetCpPerson($("sheet-cp-left-person"), primaryUser, leftRole),
      renderSheetCpPerson($("sheet-cp-right-person"), partner, rightRole)
    ]);

    pair.classList.remove("hidden");
    pair.setAttribute("aria-hidden", "false");
    normal.classList.add("hidden");
  } catch (_) {
    pair.classList.add("hidden");
    pair.setAttribute("aria-hidden", "true");
    normal.classList.remove("hidden");
  }
}

async function loadSheetRelationshipStatus(targetUserId) {
  const pair = $("sheet-cp-pair");
  const normal = $("sheet-normal-profile-header");
  if (pair) { pair.classList.add("hidden"); pair.setAttribute("aria-hidden", "true"); }
  if (normal) normal.classList.remove("hidden");

  if (!targetUserId) {
    clearCpProfileComposite("sheet-avatar-frame");
    $("sheet-relationship-actions").classList.add("hidden");
    $("sheet-relationship-status").classList.add("hidden");
    sheetRelationshipStatus = null;
    return;
  }

  if (targetUserId === me.userId) {
    try {
      const r = await api(`/api/relationships/mine/${encodeURIComponent(me.userId)}`);
      const rel = r.success ? (r.relationships || []).find(x => x.type === "cp" && x.status === "accepted") : null;
      sheetRelationshipStatus = rel ? { relationship: rel } : null;
      if (rel) await renderSheetCpPair(me, rel);
      else clearCpProfileComposite("sheet-avatar-frame");
    } catch (_) {
      sheetRelationshipStatus = null;
      clearCpProfileComposite("sheet-avatar-frame");
    }
    $("sheet-relationship-actions").classList.add("hidden");
    $("sheet-relationship-status").classList.add("hidden");
    return;
  }

  const status = await fetchRelationshipStatus(targetUserId);
  sheetRelationshipStatus = status;
  if (!status) {
    clearCpProfileComposite("sheet-avatar-frame");
    $("sheet-relationship-actions").classList.add("hidden");
    return;
  }
  if (status.relationship?.type === "cp" && status.relationship.status === "accepted") {
    await renderSheetCpPair(sheetPrimaryUser, status.relationship);
  } else {
    clearCpProfileComposite("sheet-avatar-frame");
  }
  $("sheet-relationship-actions").classList.remove("hidden");
  renderRelationshipControlButtons("sheet-relationship-actions", status, targetUserId);
  renderRelationshipProfileStatus("sheet-relationship-status", status, targetUserId);
}

async function loadOtherRelationshipStatus(targetUserId) {
  const status = await fetchRelationshipStatus(targetUserId);
  if (!status) {
    clearCpProfileComposite("other-avatar-frame");
    $("other-relationship-actions").classList.add("hidden");
    $("other-relationship-status").classList.add("hidden");
    return;
  }
  await renderCpProfileCompositeFromRelationship("other-avatar-frame", otherProfileUser, status.relationship);
  $("other-relationship-actions").classList.remove("hidden");
  renderRelationshipControlButtons("other-relationship-actions", status, targetUserId);
  renderRelationshipProfileStatus("other-relationship-status", status, targetUserId);
}

async function sendRelationshipRequest(targetUserId, type, context) {
  const status = await fetchRelationshipStatus(targetUserId);
  if (!status) return;
  if (status.relationship || status.pending) {
    toast("A relationship or request is already active");
    return;
  }
  const cost = type === "cp" ? status.cpCost : status.friendshipCost;
  const label = type === "cp" ? "CP" : "Friendship";
  if ((me.diamonds || 0) < cost) { toast(`Not enough Diamonds — ${cost.toLocaleString()} Diamonds required`); return; }
  if (!confirm(`Send ${label} request for ${cost.toLocaleString()} Diamonds?`)) return;
  const r = await api("/api/relationships/request", "POST", { targetUserId, type });
  if (!r.success) { toast(r.message || "Could not send request"); return; }
  if (r.request) {
    me.diamonds = Math.max(0, me.diamonds - cost);
    saveSession();
    fillHomeProfile();
  }
  if (context === "sheet") await loadSheetRelationshipStatus(targetUserId);
  else if (context === "cp-center") {
    await loadCpCenterRelationship();
    await loadCpCenterFollowing();
  } else await loadOtherRelationshipStatus(targetUserId);
}

function buildSheetAdminControls(target, seatNumber, isOwner) {
  const godPower = !!me?.can_manage_all;
  const grid = $("sheet-admin-grid");
  grid.innerHTML = "";
  const addBtn = (label, onClick, active) => {
    const b = document.createElement("button");
    b.className = "btn btn-ghost" + (active ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", onClick);
    grid.appendChild(b);
  };

  if (seatNumber) {
    const isLocked = (currentRoom.lockedSeats || []).includes(seatNumber);
    addBtn(isLocked ? "🔓 Seat Unlock" : "🔒 Seat Lock", () => {
      socket.emit("lock-seat", { roomId: currentRoomId, seatNumber, locked: !isLocked });
      closeProfileSheet();
    }, isLocked);

    const seat = (currentRoom.seats || [])[seatNumber - 1];
    const micMuted = !!(seat && seat.micMuted);
    addBtn(micMuted ? "🔊 Mic Unmute" : "🔇 Mic Mute", () => {
      socket.emit("mod-mute-users", { roomId: currentRoomId, targetUserIds: [target.userId], minutes: micMuted ? 0 : 15 });
      toast(micMuted ? "Mic unmuted" : "Mic muted for 15 minutes");
    }, micMuted);

    addBtn("⬇️ Remove From Seat", () => {
      socket.emit("mod-move-to-audience", { roomId: currentRoomId, targetUserIds: [target.userId] });
      closeProfileSheet();
    });

    // Feature: Owner/Admin "Move Mic" — pick an empty seat and move this
    // user straight there in one tap, instead of Remove From Seat + a
    // separate Invite To Seat (and waiting for them to accept).
    addBtn("🔄 Move Mic", () => {
      closeProfileSheet();
      openMoveMicPopup(target.userId, target.name);
    });
  } else {
    addBtn("💺 Invite to Seat", () => {
      socket.emit("mod-invite-to-seat", { roomId: currentRoomId, targetUserIds: [target.userId] });
      toast("Seat invite sent");
    });
  }

  const chatBanned = (currentRoom.chatBannedIds || []).includes(target.userId);
  addBtn(chatBanned ? "💬 Chat Unban" : "🚫 Ban Chat", () => {
    socket.emit("mod-chat-ban", { roomId: currentRoomId, targetUserId: target.userId, banned: !chatBanned });
    toast(chatBanned ? "Unbanned from chat" : "Banned from chat");
  }, chatBanned);

  addBtn("❌ Kick User", () => {
    if (!confirm(target.name + " from the room?")) return;
    socket.emit("kick-user", { roomId: currentRoomId, targetUserId: target.userId });
    closeProfileSheet();
  });

  if (godPower) {
    addBtn("⛔ Ban Account", () => {
      if (!confirm(`Ban ${target.name} (${target.userId}) from PingPong?`)) return;
      const reason = window.prompt("Ban reason (optional):", "God Power moderation") || "God Power moderation";
      socket.emit("god-ban-user", { roomId: currentRoomId, targetUserId: target.userId, reason });
      closeProfileSheet();
    });
  }

  if (isOwner || godPower) {
    const isAdmin = (currentRoom.adminIds || []).includes(target.userId);
    addBtn(isAdmin ? "🛡️ Remove Admin" : "🛡️ Make Room Admin", () => {
      socket.emit("set-admin", { roomId: currentRoomId, targetUserId: target.userId, isAdmin: !isAdmin });
      toast(isAdmin ? "Admin removed" : "Made Admin");
      closeProfileSheet();
    }, isAdmin);
  }
}

// Move Mic — one-tap seat picker used by the "🔄 Move Mic" admin action
// above. Lists every currently empty, unlocked seat; tapping one moves the
// target user there immediately via "mod-move-seat" (atomic on the server —
// see server.js — so the user is never briefly stuck in audience).
function openMoveMicPopup(targetUserId, targetName) {
  if (!currentRoom) return;
  const existing = $("sheet-move-mic");
  if (existing) existing.remove();

  const lockedSeats = currentRoom.lockedSeats || [];
  const openSeats = (currentRoom.seats || [])
    .map((s, i) => (!s && !lockedSeats.includes(i + 1) ? i + 1 : null))
    .filter((n) => n !== null);

  const overlay = document.createElement("div");
  overlay.id = "sheet-move-mic";
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet-card">
      <div class="sheet-handle"></div>
      <p class="field-label">${escapeHtml(targetName)} to which seat?</p>
      <div class="sheet-admin-grid" id="move-mic-grid"></div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.classList.remove("sheet-open"); setTimeout(() => overlay.remove(), 220); };

  const grid = overlay.querySelector("#move-mic-grid");
  if (!openSeats.length) {
    const p = document.createElement("p");
    p.className = "field-label";
    p.textContent = "No empty seat available";
    grid.appendChild(p);
  }
  openSeats.forEach((n) => {
    const b = document.createElement("button");
    b.className = "btn btn-ghost";
    b.textContent = "No." + n;
    b.addEventListener("click", () => {
      socket.emit("mod-move-seat", { roomId: currentRoomId, targetUserId: targetUserId, seatNumber: n });
      toast(targetName + " to No." + n + " seat");
      close();
    });
    grid.appendChild(b);
  });

  overlay.querySelector(".sheet-backdrop").addEventListener("click", close);
  requestAnimationFrame(() => overlay.classList.add("sheet-open"));
}

// ---------------------------------------------------------------------
// Empty-seat management popup (Touch-based Room Management System).
// Host/admin tapping an empty seat gets Lock/Unlock/Invite (+ Sit Here)
// instead of silently taking the seat. Built as a lightweight, throwaway
// sheet reusing the existing .sheet-overlay/.sheet-card styling so it
// matches the seat/ID-tap popups visually without new CSS.
// ---------------------------------------------------------------------
function openEmptySeatManagePopup(seatNumber) {
  if (!currentRoom) return;
  const existing = $("sheet-empty-seat");
  if (existing) existing.remove();

  const isLocked = (currentRoom.lockedSeats || []).includes(seatNumber);
  const overlay = document.createElement("div");
  overlay.id = "sheet-empty-seat";
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet-card">
      <div class="sheet-handle"></div>
      <p class="field-label">Seat #${seatNumber}</p>
      <div class="sheet-admin-grid" id="empty-seat-grid"></div>
    </div>`;
  document.body.appendChild(overlay);

  const grid = overlay.querySelector("#empty-seat-grid");
  const addBtn = (label, onClick) => {
    const b = document.createElement("button");
    b.className = "btn btn-ghost";
    b.textContent = label;
    b.addEventListener("click", () => { closeEmptySeatPopup(); onClick(); });
    grid.appendChild(b);
  };
  // FIX (2026-08-22, "owner/admin must leave seat first to move"): this
  // button used to be hidden whenever mySeatNumber !== null, so an
  // already-seated Owner/Admin tapping a different empty seat only ever
  // saw Lock/Invite — no way to just move there, forcing a manual
  // leave-seat first. performTakeSeat() on the server already vacates
  // whatever seat this user currently holds and seats them here in the
  // same operation (see server.js: `room.seats.forEach(... room.seats[i]
  // = null)` before placing them in the new seat), and the client's
  // "take" seat-update handler already preserves the live mic/voice
  // connection across that move (no leave/rejoin teardown) — so there is
  // no reason to gate this on being unseated. Always offer it; just
  // relabel it when it's really a seat-to-seat move.
  addBtn(mySeatNumber === null ? "💺 Sit Here" : "🔄 Move Here", () => socket.emit("take-seat", { roomId: currentRoomId, seatNumber }));
  addBtn(isLocked ? "🔓 Seat Unlock" : "🔒 Seat Lock", () => {
    socket.emit("lock-seat", { roomId: currentRoomId, seatNumber, locked: !isLocked });
  });
  addBtn("📩 Invite User", () => openOnlineMembersForSeatInvite(seatNumber));

  overlay.querySelector(".sheet-backdrop").addEventListener("click", closeEmptySeatPopup);
  requestAnimationFrame(() => overlay.classList.add("sheet-open"));
}
function closeEmptySeatPopup() {
  const overlay = $("sheet-empty-seat");
  if (!overlay) return;
  overlay.classList.remove("sheet-open");
  setTimeout(() => overlay.remove(), 220);
}
function openOnlineMembersForSeatInvite(seatNumber) {
  // Reuse the existing Online Members list — picking someone there sends
  // the same "invite to seat" action already used from the ID Tap popup.
  $("room-online-count").click();
  toast("Choose who to invite to seat #" + seatNumber + "");
}

$("sheet-backdrop").addEventListener("click", closeProfileSheet);
$("sheet-btn-friendship").addEventListener("click", () => sendRelationshipRequest(sheetTargetUserId, "friendship", "sheet"));
$("sheet-btn-unfriend").addEventListener("click", () => unfriendRelationship(sheetTargetUserId, "sheet"));
$("sheet-btn-cp").addEventListener("click", () => sendRelationshipRequest(sheetTargetUserId, "cp", "sheet"));
$("sheet-btn-uncp").addEventListener("click", () => uncpRelationship(sheetTargetUserId, "sheet"));
$("btn-other-friendship").addEventListener("click", () => otherProfileUser && sendRelationshipRequest(otherProfileUser.userId, "friendship", "profile"));
$("btn-other-unfriend").addEventListener("click", () => otherProfileUser && unfriendRelationship(otherProfileUser.userId, "profile"));
$("btn-other-cp").addEventListener("click", () => otherProfileUser && sendRelationshipRequest(otherProfileUser.userId, "cp", "profile"));
$("btn-other-uncp").addEventListener("click", () => otherProfileUser && uncpRelationship(otherProfileUser.userId, "profile"));
$("sheet-btn-profile").addEventListener("click", () => {
  closeProfileSheet();
  if (sheetTargetUserId === me.userId) openOwnProfile();
  else openOtherProfile(sheetTargetUserId);
});
$("sheet-btn-chat").addEventListener("click", async () => {
  const r = await api("/api/user/by-id/" + sheetTargetUserId);
  closeProfileSheet();
  if (r.success) openThread(sheetTargetUserId, r.user.name);
});
$("sheet-btn-mention").addEventListener("click", async () => {
  const r = await api("/api/user/by-id/" + sheetTargetUserId);
  closeProfileSheet();
  if (r.success) {
    const input = $("chat-input");
    input.value = (input.value ? input.value + " " : "") + "@" + r.user.name + " ";
    input.focus();
  }
});
$("sheet-btn-follow").addEventListener("click", async () => {
  const amFollowing = (me.followingList || []).includes(sheetTargetUserId);
  const endpoint = amFollowing ? "/api/user/unfollow" : "/api/user/follow";
  const r = await api(endpoint, "POST", { mobile: me.mobile, targetUserId: sheetTargetUserId });
  if (r.success) {
    me = r.user; saveSession();
    $("sheet-btn-follow").textContent = (me.followingList || []).includes(sheetTargetUserId) ? "Unfollow" : "Follow";
  } else toast(r.message || "Something went wrong");
});
$("sheet-btn-gift").addEventListener("click", () => {
  const targetId = sheetTargetUserId;
  closeProfileSheet();
  openGiftModal(targetId);
});
$("sheet-btn-leave-seat").addEventListener("click", () => {
  if (mySeatNumber === null) { closeProfileSheet(); return; }
  socket.emit("leave-seat", { roomId: currentRoomId });
  closeProfileSheet();
});

// ===========================================================================
// PRIVATE MESSAGES
// ===========================================================================

// ---------------------------------------------------------------------------
// ROOM-ONLY PRIVATE MESSAGE WINDOW
// ---------------------------------------------------------------------------
let roomPrivateActivePeerId = null;
let roomPrivateOpen = false;
let roomPrivateRenderedIds = new Set();

function roomPrivateFormatTime(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function roomPrivateSetListMode() {
  roomPrivateActivePeerId = null;
  roomPrivateRenderedIds = new Set();
  $("room-private-thread")?.classList.add("hidden");
  $("room-private-conversation-list")?.classList.remove("hidden");
  $("room-private-empty")?.classList.add("hidden");
  $("room-private-back")?.classList.add("hidden");
  if ($("room-private-title")) $("room-private-title").textContent = "Messages";
  if ($("room-private-subtitle")) $("room-private-subtitle").textContent = "Room messages";
}
function roomPrivateRenderConversations(conversations) {
  const list = $("room-private-conversation-list"), empty = $("room-private-empty");
  if (!list || !empty) return;
  list.innerHTML = "";
  const rows = Array.isArray(conversations) ? conversations : [];
  empty.classList.toggle("hidden", rows.length > 0);
  rows.forEach((c) => {
    const unread = Number(c.unreadCount || 0);
    const row = document.createElement("div");
    row.className = "room-private-conversation-row" + (unread > 0 ? " unread" : "");
    const avatar = c.otherPhoto || placeholderAvatar(c.otherName || "User");
    const time = c.lastMessageTime || c.updatedAt || c.time || "";
    row.innerHTML = `<img class="room-private-avatar" src="${escapeHtml(avatar)}" alt="">
      <div class="room-private-row-main"><div class="room-private-row-top">
      <span class="room-private-row-name">${escapeHtml(c.otherName || "User")}</span>
      ${unread > 0 ? `<span class="room-private-unread">${unread > 99 ? "99+" : unread}</span>` : ""}
      <span class="room-private-row-time">${escapeHtml(roomPrivateFormatTime(time))}</span></div>
      <div class="room-private-row-message">${escapeHtml(c.lastMessage || "New message")}</div></div>`;
    row.addEventListener("click", () => roomPrivateOpenThread(c.otherUserId, c.otherName, c.otherPhoto, c));
    list.appendChild(row);
  });
}
async function roomPrivateRefreshList() {
  if (!me?.userId) return;
  try {
    const r = await api("/api/messages/inbox/" + me.userId + "?roomOnly=false&ts=" + Date.now());
    if (!r.success) return;
    roomPrivateRenderConversations(r.conversations || []);
    (r.conversations || []).forEach(c => {
      if (Number(c.unreadCount || 0) > 0) setPrivateUnread(c.otherUserId, c.unreadCount);
    });
  } catch (e) { console.warn("[ROOM PRIVATE] inbox refresh failed", e); }
}
async function roomPrivateOpenThread(userId, userName, userPhoto, presenceHint) {
  if (!userId || !me?.userId) return;
  roomPrivateActivePeerId = String(userId);
  roomPrivateRenderedIds = new Set();
  $("room-private-conversation-list")?.classList.add("hidden");
  $("room-private-empty")?.classList.add("hidden");
  $("room-private-thread")?.classList.remove("hidden");
  $("room-private-back")?.classList.remove("hidden");
  if ($("room-private-title")) $("room-private-title").textContent = userName || "Message";
  if ($("room-private-subtitle")) $("room-private-subtitle").textContent =
    presenceHint?.inRoom ? "In this room" : (presenceHint?.online ? "Online" : "Private message");
  await markThreadRead(userId);
  try {
    const r = await api(`/api/messages/thread/${me.userId}/${userId}?ts=${Date.now()}`);
    const log = $("room-private-thread-log");
    if (!log) return;
    log.innerHTML = "";
    const messages = r.success && Array.isArray(r.messages) ? r.messages : [];
    messages.forEach(roomPrivateAppendMessage);
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  } catch (e) { console.warn("[ROOM PRIVATE] thread load failed", e); }
}
function roomPrivateAppendMessage(msg) {
  if (!msg) return;
  const id = msg.id != null ? String(msg.id) : null;
  if (id && roomPrivateRenderedIds.has(id)) return;
  if (id) roomPrivateRenderedIds.add(id);
  const log = $("room-private-thread-log");
  if (!log) return;
  const div = document.createElement("div");
  const out = String(msg.from) === String(me?.userId);
  div.className = "room-private-mini-msg " + (out ? "out" : "in");
  const textValue = msg.message || (msg.type === "image" ? "📷 Photo" : "Message");
  div.innerHTML = `${escapeHtml(textValue)}<span class="room-private-mini-time">${escapeHtml(roomPrivateFormatTime(msg.time || msg.createdAt))}</span>`;
  log.appendChild(div);
  while (log.children.length > 80) log.removeChild(log.firstChild);
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}
async function roomPrivateSendMessage() {
  const input = $("room-private-input");
  const message = input?.value.trim();
  if (!message || !roomPrivateActivePeerId || !me?.userId) return;
  const sendBtn = $("room-private-send");
  if (sendBtn) sendBtn.disabled = true;
  try {
    const r = await api("/api/messages/send", "POST", {
      fromUserId: me.userId, toUserId: roomPrivateActivePeerId, message
    });
    if (r.success) {
      roomPrivateAppendMessage(r.message);
      input.value = "";
      input.focus();
      await roomPrivateRefreshList();
    } else toast(r.message || "Couldn't send message");
  } catch (e) { toast("Couldn't send message"); }
  finally { if (sendBtn) sendBtn.disabled = false; }
}
async function openRoomPrivateMessages() {
  if (!currentRoomId || !me?.userId) return;
  roomPrivateOpen = true;
  $("room-private-message-window")?.classList.remove("hidden");
  roomPrivateSetListMode();
  await roomPrivateRefreshList();
}
function closeRoomPrivateMessages() {
  roomPrivateOpen = false;
  roomPrivateActivePeerId = null;
  $("room-private-message-window")?.classList.add("hidden");
  if ($("room-private-input")) $("room-private-input").value = "";
}
$("room-private-close")?.addEventListener("click", closeRoomPrivateMessages);
$("room-private-back")?.addEventListener("click", async () => { roomPrivateSetListMode(); await roomPrivateRefreshList(); });
$("room-private-send")?.addEventListener("click", roomPrivateSendMessage);
$("room-private-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); roomPrivateSendMessage(); }
});

function updatePrivateUnreadUi() {
  privateUnreadTotal = Object.values(privateUnreadByUser).reduce((sum,n)=>sum+Number(n||0),0);
  document.querySelectorAll('.inbox-nav-btn .inbox-unread-badge').forEach(el=>{ el.textContent=privateUnreadTotal>99?'99+':String(privateUnreadTotal); el.classList.toggle('hidden',privateUnreadTotal<=0); });
  const ind=$('private-message-indicator'), count=$('private-message-count');
  if(count){ count.textContent=privateUnreadTotal>99?'99+':String(privateUnreadTotal); count.classList.toggle('hidden', privateUnreadTotal<=0); }
  if(ind) ind.classList.toggle('hidden',!currentRoomId);
}
// Safety net: the room inbox icon used to appear only when an unread event
// happened to re-run the function above. Re-sync it cheaply so it is always
// shown inside a room, with no refresh needed.
setInterval(() => {
  const ind = document.getElementById('private-message-indicator');
  if (!ind) return;
  const shouldHide = !currentRoomId;
  if (ind.classList.contains('hidden') !== shouldHide) ind.classList.toggle('hidden', shouldHide);
}, 1500);
function setPrivateUnread(userId,count){ if(!userId)return; privateUnreadByUser[userId]=Math.max(0,Number(count||0)); updatePrivateUnreadUi(); }
function bumpPrivateUnread(userId){ if(!userId || userId===me?.userId)return; privateUnreadByUser[userId]=Number(privateUnreadByUser[userId]||0)+1; updatePrivateUnreadUi(); }
async function markThreadRead(userId){
  if(!userId || !me?.userId)return; setPrivateUnread(userId,0);
  try{ await api('/api/messages/read','POST',{userId:me.userId,otherUserId:userId}); }catch(_){}
}
function applyThreadPresence(p){
  const el=$('thread-presence'); if(!el)return; const online=!!p?.online,inRoom=!!p?.inRoom;
  el.classList.toggle('online',online); el.classList.toggle('room',inRoom);
  if(inRoom) el.textContent=`In room${p.roomName?': '+p.roomName:''}`;
  else if(online) el.textContent='Online';
  else if(p?.lastOnlineAt) el.textContent=`Last seen ${new Date(p.lastOnlineAt).toLocaleString()}`;
  else el.textContent='Offline';
}
async function loadPrivateUnread(){
  try{ const r=await api('/api/messages/inbox/'+me.userId); if(!r.success)return; privateUnreadByUser=Object.create(null); (r.conversations||[]).forEach(c=>{if(c.unreadCount>0)privateUnreadByUser[c.otherUserId]=c.unreadCount;}); updatePrivateUnreadUi(); }catch(_){}
}
async function openInbox() {
  const r=await api('/api/messages/inbox/'+me.userId); const conversations=r.success?r.conversations:[]; const wrap=$('inbox-list'); wrap.innerHTML='';
  $('inbox-empty').classList.toggle('hidden',conversations.length>0);
  conversations.forEach(c=>{
    setPrivateUnread(c.otherUserId,c.unreadCount||0);
    const row=document.createElement('div'); row.className='user-row'+((c.unreadCount||0)>0?' unread':'');
    const presenceText=c.inRoom?`In room${c.roomName?': '+escapeHtml(c.roomName):''}`:c.online?'Online':'Offline';
    const presenceClass=c.inRoom?'room':c.online?'online':'offline';
    const badge=c.isAi?` <span title="Verified · Always Online" style="color:#3ba9ff;">✔️ Online</span>`:c.isSystem?` <span title="System notification" style="color:#ff7a00;">● System</span>`:'';
    const unread=(c.unreadCount||0)>0?`<span class="inbox-row-unread">${c.unreadCount>99?'99+':c.unreadCount}</span>`:'';
    row.innerHTML=`<img class="avatar avatar-sm" src="${c.otherPhoto||placeholderAvatar(c.otherName)}"><div class="user-row-body"><div class="inbox-row-meta"><span class="name">${escapeHtml(c.otherName)}${badge}</span><span class="inbox-presence ${presenceClass}">${presenceText}</span>${unread}</div><span class="sub">${escapeHtml(c.lastMessage||'')}</span></div>`;
    row.addEventListener('click',()=>openThread(c.otherUserId,c.otherName,c.otherPhoto,c)); wrap.appendChild(row);
  });
  updatePrivateUnreadUi(); showView('view-inbox');
}
// PHASE 4 FIX (2026-08-16, private chat audit — §9/§10): mirrors
// renderedChatMsgIds' role for room chat. Reset per-thread in openThread()
// (a new thread = a fresh render from scratch, no stale ids to carry over
// from a previously-open conversation) so switching from User A's thread to
// User B's can never cross-contaminate dedup state between them.
const renderedThreadMsgIds = new Set();

async function refreshThreadSafetyActions() {
  const blockBtn = $("btn-thread-block");
  const callBtn = $("btn-thread-audio-call");
  if (!threadPeerId) return;
  try {
    const r = await api("/api/safety/blocked");
    const blocked = !!(r.success && Array.isArray(r.blockedUserIds) && r.blockedUserIds.includes(threadPeerId));
    if (blockBtn) {
      blockBtn.textContent = blocked ? "🔓" : "🚫";
      blockBtn.title = blocked ? "Unblock user" : "Block user";
      blockBtn.setAttribute("aria-label", blocked ? "Unblock user" : "Block user");
      blockBtn.classList.toggle("active", blocked);
    }
    if (callBtn) {
      const er = await api("/api/calls/eligibility/" + encodeURIComponent(threadPeerId));
      const eligible = !!(er.success && er.eligible && !blocked);
      callBtn.classList.toggle("call-disabled", !eligible);
      callBtn.disabled = !eligible;
      callBtn.title = eligible ? "Audio call" : "Audio call requires mutual follow";
    }
  } catch (_) {}
}

async function openThread(userId, userName, userPhoto, presenceHint) {
  threadPeerId = userId;
  threadPeerName = userName;
  threadPeerPhoto = userPhoto || "";
  renderedThreadMsgIds.clear();
  $("thread-title").textContent = userName;
  applyThreadPresence(presenceHint || {online:false,inRoom:false});
  markThreadRead(userId);
  const [msgRes, callRes] = await Promise.all([
    api(`/api/messages/thread/${me.userId}/${userId}`),
    api(`/api/calls/history/${me.userId}/${userId}`)
  ]);
  const log = $("thread-log");
  log.innerHTML = "";
  const timeline = [];
  if (msgRes.success) msgRes.messages.forEach((m) => timeline.push({ ts: new Date(m.time).getTime(), kind: "message", data: m }));
  if (callRes.success) callRes.history.forEach((c) => timeline.push({ ts: c.endedAt || c.startedAt, kind: "call", data: c }));
  timeline.sort((a, b) => a.ts - b.ts);
  // Render while hidden, then reveal and perform the first scroll after the
  // browser has laid out the thread. Scrolling a display:none container
  // before layout is the reason the first message could appear below the
  // fold until a second message was sent.
  timeline.forEach((item) => item.kind === "message" ? appendThreadMsg(item.data) : appendThreadCallLog(item.data));
  showView("view-thread");
  refreshThreadSafetyActions();
  requestAnimationFrame(() => {
    log.scrollTop = log.scrollHeight;
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  });
}
$("btn-back-thread").addEventListener("click", () => {
  if (privateReturnToRoom && currentRoomId) { privateReturnToRoom = false; showView("view-room"); return; }
  openInbox();
});
$("btn-thread-block")?.addEventListener("click", async () => {
  if (!threadPeerId) return;
  const blocked = $("btn-thread-block").textContent.includes("🔓");
  const action = blocked ? "unblock" : "block";
  if (!blocked && !confirm("Block this user? They will not be able to message or audio-call you.")) return;
  const r = await api("/api/safety/" + action, "POST", { targetUserId: threadPeerId });
  if (!r.success) return toast(r.message || "Could not update block");
  toast(blocked ? "User unblocked" : "User blocked");
  await refreshThreadSafetyActions();
});

$("btn-thread-clear")?.addEventListener("click", async () => {
  if (!threadPeerId) return;
  if (!confirm("Clear all messages in this private chat? This cannot be undone.")) return;
  const other = threadPeerId;
  const r = await api(`/api/messages/thread/${encodeURIComponent(me.userId)}/${encodeURIComponent(other)}`, "DELETE");
  if (!r.success) return toast(r.message || "Could not clear messages");
  renderedThreadMsgIds.clear();
  $("thread-log").innerHTML = "";
  toast("Private messages cleared");
  await openInbox();
});

$("btn-thread-send").addEventListener("click", sendThreadMsg);
$("thread-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendThreadMsg(); });
// Gallery/image icon in the thread toolbar — tap opens the device gallery
// (native file picker), and picking a photo uploads + sends it straight to
// the open peer, same as any other private message.
$("btn-thread-photo").addEventListener("click", () => $("thread-photo-input").click());
$("thread-photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !threadPeerId) return;
  const btn = $("btn-thread-photo");
  btn.classList.add("sending");
  try {
    const fd = new FormData();
    fd.append("photo", file);
    fd.append("toUserId", threadPeerId);
    const r = await apiUpload("/api/messages/send-image", fd);
    if (r.success) appendThreadMsg(r.message);
    else toast(r.message || "Couldn't send photo");
  } catch (err) {
    toast("Couldn't send photo");
  } finally {
    btn.classList.remove("sending");
  }
});
function openImagePreview(url) {
  $("image-preview-img").src = url;
  $("modal-image-preview").classList.remove("hidden");
}
$("btn-image-preview-close").addEventListener("click", () => $("modal-image-preview").classList.add("hidden"));
$("modal-image-preview").addEventListener("click", (e) => { if (e.target.id === "modal-image-preview") $("modal-image-preview").classList.add("hidden"); });
async function sendThreadMsg() {
  const input = $("thread-input");
  const message = input.value.trim();
  if (!message || !threadPeerId) return;
  const r = await api("/api/messages/send", "POST", { fromUserId: me.userId, toUserId: threadPeerId, message });
  if (r.success) { appendThreadMsg(r.message); input.value = ""; }
}
// PRIORITY 6 fix (2026-08-12): same unbounded-DOM issue as room chat — cap
// the live thread view, never touch privateMessages.json / the server's
// persisted history. Reopening the thread re-fetches full history via
// openThread()'s /api/messages/thread call, so nothing is lost.
const MAX_VISIBLE_PRIVATE_MESSAGES = 30;

function appendThreadMsg(msg) {
  // PHASE 4 FIX (§9): dedupe by server-issued id, same pattern as room
  // chat's appendChatMsg — a duplicate delivery (multi-device fan-out,
  // reconnect resend) must never render a second bubble for the same
  // message. Older persisted messages predating this fix may still lack an
  // id (id == null) — those always render, exactly as before this fix.
  if (msg && msg.id != null) {
    if (renderedThreadMsgIds.has(msg.id)) return;
    renderedThreadMsgIds.add(msg.id);
  }
  const log = $("thread-log");
  const div = document.createElement("div");
  const out = msg.from === me.userId;
  div.className = "thread-msg " + (out ? "out" : "in");
  if (msg.type === "agency_invite") {
    div.appendChild(agencyInviteCard(msg));
  } else if (msg.type === "relationship_request") {
    div.appendChild(relationshipRequestCard(msg));
  } else if (msg.type === "image" && msg.imageUrl) {
    const img = document.createElement("img");
    img.className = "thread-msg-photo";
    img.src = msg.imageUrl;
    img.alt = "Photo";
    img.addEventListener("click", () => openImagePreview(msg.imageUrl));
    // BUGFIX 2026-08-22 ("messages below don't show until I send another
    // one"): the bubble is 0px tall until the photo itself finishes
    // downloading, so scrollHeight measured right after appendChild() is
    // too small and the log settles scrolled short of the real bottom —
    // whatever was just sent/received sits just out of view until some
    // later action (like sending a second message) forces another scroll
    // recompute. Re-checking once the image has actually loaded and
    // laid out fixes the position for good, without disturbing the user
    // if they've scrolled up to read older messages.
    img.addEventListener("load", () => {
      const nearBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 80;
      if (nearBottom) log.scrollTop = log.scrollHeight;
    });
    div.appendChild(img);
  } else {
    div.textContent = msg.message;
  }
  if (msg && msg.id != null) div.dataset.msgId = String(msg.id);
  log.appendChild(div);
  const wasAtBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 40;
  while (log.children.length > MAX_VISIBLE_PRIVATE_MESSAGES) {
    const oldest = log.firstChild;
    if (oldest && oldest.dataset && oldest.dataset.msgId != null) renderedThreadMsgIds.delete(oldest.dataset.msgId);
    log.removeChild(oldest);
  }
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
}
// Renders one call-history entry (missed/rejected/cancelled/completed) as a
// centered status line inside the open thread — same idea as WhatsApp/
// Messenger's inline "Missed call" row. Called both when opening a thread
// (past history) and live, the instant a call with the open peer ends.
function appendThreadCallLog(entry) {
  const log = $("thread-log");
  const div = document.createElement("div");
  const icon = entry.type === "video" ? "🎥" : "📞";
  const missedLike = entry.status === "missed" || entry.status === "rejected" || entry.status === "cancelled";
  div.className = "thread-call-log" + (missedLike ? " missed" : "");
  let label;
  if (entry.status === "missed") label = "Missed " + entry.type + " call";
  else if (entry.status === "rejected") label = (entry.from === me.userId ? "Declined by " + threadPeerName : "You declined") + " · " + entry.type + " call";
  else if (entry.status === "cancelled") label = "Cancelled " + entry.type + " call";
  else label = entry.type[0].toUpperCase() + entry.type.slice(1) + " call · " + formatCallDuration(entry.durationSec);
  div.textContent = icon + " " + label;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
function formatCallDuration(sec) {
  sec = sec || 0;
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}
function relationshipRequestCard(msg) {
  const d = msg.data || {};
  const type = d.relationshipType === "cp" ? "cp" : "friendship";
  const label = type === "cp" ? "CP Request" : "Friendship Request";
  const icon = type === "cp" ? "/images/relationships/cp-heart.png" : "/images/relationships/friendship-heart.png";
  const card = document.createElement("div");
  card.className = "relationship-request-card";
  const canRespond = msg.to === me.userId && d.status === "pending";
  card.innerHTML = `
    <div class="relationship-request-head">
      <img class="relationship-request-icon" src="${icon}" alt="">
      <div><div class="relationship-request-title">${label}</div><div class="relationship-request-sub">${(d.cost || 0).toLocaleString()} Diamonds</div></div>
    </div>
    <div class="relationship-request-status"></div>`;
  const statusBox = card.querySelector(".relationship-request-status");
  if (canRespond) {
    const actions = document.createElement("div");
    actions.className = "relationship-request-actions";
    actions.innerHTML = `<button class="btn btn-primary btn-sm rel-accept">Yes</button><button class="btn btn-ghost btn-sm rel-reject">No</button>`;
    statusBox.appendChild(actions);
    actions.querySelector(".rel-accept").addEventListener("click", () => respondRelationshipRequest(d.requestId, "accept", card));
    actions.querySelector(".rel-reject").addEventListener("click", () => respondRelationshipRequest(d.requestId, "reject", card));
  } else {
    const labelText = d.status === "accepted" ? "✅ Accepted" : d.status === "rejected" ? "❌ Declined" : d.status === "expired" ? "⌛ Expired" : "⏳ Pending";
    statusBox.textContent = labelText;
  }
  return card;
}

async function respondRelationshipRequest(requestId, action, cardEl) {
  const r = await api("/api/relationships/respond", "POST", { requestId, action });
  if (!r.success) { toast(r.message || "Request could not be processed"); return; }
  const statusBox = cardEl.querySelector(".relationship-request-status");
  if (statusBox) statusBox.innerHTML = action === "accept" ? '<div class="invite-card-status">✅ Accepted</div>' : '<div class="invite-card-status">❌ Declined</div>';
  if (action === "accept") toast(r.relationship && r.relationship.type === "cp" ? "💞 CP accepted" : "🤝 Friendship accepted");
  else toast("Request declined");
}

function agencyInviteCard(msg) {
  const d = msg.data || {};
  const card = document.createElement("div");
  card.className = "invite-card";
  const canRespond = msg.to === me.userId && d.status === "pending";
  card.innerHTML = `
    <div class="invite-card-head">
      ${d.agencyLogo ? `<img src="${escapeHtml(d.agencyLogo)}" class="invite-card-logo" alt="">` : `<div class="invite-card-logo placeholder">🏢</div>`}
      <div>
        <div class="invite-card-name">${escapeHtml(d.agencyName || "Agency")}</div>
        <div class="invite-card-id">Agency ID: ${escapeHtml(d.agencyId || "")}</div>
      </div>
    </div>
    <div class="invite-body-status"></div>
  `;
  const statusBox = card.querySelector(".invite-body-status");
  if (canRespond) {
    const actions = document.createElement("div");
    actions.className = "invite-card-actions";
    actions.innerHTML = `<button class="btn btn-primary btn-sm invite-accept">Accept</button><button class="btn btn-ghost btn-sm invite-decline">Decline</button>`;
    statusBox.appendChild(actions);
    actions.querySelector(".invite-accept").addEventListener("click", () => respondAgencyInvite(d.inviteId, "accept", card));
    actions.querySelector(".invite-decline").addEventListener("click", () => respondAgencyInvite(d.inviteId, "decline", card));
  } else {
    const label = d.status === "accepted" ? "✅ Accepted" : d.status === "declined" ? "❌ Declined" : "Pending";
    statusBox.innerHTML = `<div class="invite-card-status">${label}</div>`;
  }
  return card;
}
async function respondAgencyInvite(inviteId, action, cardEl) {
  const r = await api("/api/agency/invite/respond", "POST", { inviteId, userId: me.userId, action });
  if (!r.success) { toast(r.message || "Didn't work"); return; }
  if (action === "decline") {
    cardEl.closest(".thread-msg")?.remove();
    toast("Invitation declined");
  } else {
    me.isHost = true;
    saveSession();
    checkHostCenterMenu();
    const statusBox = cardEl.querySelector(".invite-body-status");
    if (statusBox) statusBox.innerHTML = `<div class="invite-card-status">✅ Accepted</div>`;
    toast("🎉 You are now an Agency Host! Check the Host Center menu.");
  }
}

// ===========================================================================
// PRIVATE AUDIO/VIDEO CALLING (WebRTC, signaling over the existing socket)
// Purely additive: its own state, its own DOM (#call-overlay), its own
// socket events (all namespaced "call:..."). Never touches room/voice
// (that's a separate WebRTC-less audio system tied to seats), gifts,
// wallet, or messaging code — the only thing it shares with messaging is
// dropping a call-log line into #thread-log when a call with the open
// peer ends, the same way WhatsApp/Messenger show missed-call rows inline.
// ===========================================================================
let iceServersCache = null;
let iceServersCacheAt = 0;
// PHASE 1 (Tier A): dynamic TURN credentials expire server-side (default
// 6h, TURN_CREDENTIAL_TTL_SECONDS). Re-fetching well inside that window
// keeps a long-lived tab (someone who leaves the app open for hours)
// from holding a stale/expired credential into a new call. Harmless
// no-op for static-credential deployments (TURN_SECRET unset) too.
const ICE_SERVERS_CACHE_MAX_AGE_MS = 10 * 60 * 1000; // TURN credentials can be short-lived; refresh often for reliable mobile calls
let currentCall = null;      // { callId, peerId, peerName, peerPhoto, type, role, status }
let callLocalStream = null;
let callPc = null;
let callTimerHandle = null;
let callSeconds = 0;
let pendingIceCandidates = [];
let pendingOfferSdp = null;
let pendingLocalIceCandidates = [];
let usingFrontCamera = true;
let micMuted = false;
let cameraOff = false;
let speakerOn = true; // best-effort UI state — see toggleSpeaker() note

// ===========================================================================
// MOBILE WEBRTC VIDEO HARDENING
// Android WebView can open a live camera track while the <video> element
// remains on a black first frame. Some WebRTC implementations can also fire
// RTCTrackEvent with an empty streams[] array. Keep media rendering resilient
// and never reveal the full-screen video layer for an audio-only track.
// ===========================================================================
function videoConstraints(facingMode) {
  return {
    facingMode: { ideal: facingMode || "user" },
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    frameRate: { ideal: 30, max: 30 }
  };
}

async function attachLiveVideo(videoEl, stream, label, { showWrap = null, muted = true } = {}) {
  if (!videoEl || !stream) return false;

  // IMPORTANT ANDROID WEBVIEW FIX:
  // Do not start/play a MediaStream while its <video> element is inside a
  // display:none wrapper. Chromium/WebView can successfully resolve
  // video.play() in that state but create a black hardware video surface;
  // making the element visible afterwards does not always cause the first
  // camera frame to be composed. Reveal the wrapper FIRST, then attach and
  // play on the next frame. This is especially important for the local
  // preview, whose wrapper starts hidden until getUserMedia succeeds.
  if (showWrap) showWrap.classList.remove("hidden");

  videoEl.autoplay = true;
  videoEl.muted = muted;
  videoEl.playsInline = true;
  videoEl.setAttribute("playsinline", "");
  videoEl.setAttribute("webkit-playsinline", "");
  videoEl.controls = false;
  videoEl.disablePictureInPicture = true;
  videoEl.setAttribute("disablepictureinpicture", "");
  videoEl.removeAttribute("poster");
  videoEl.style.display = "block";
  videoEl.style.width = "100%";
  videoEl.style.height = "100%";
  videoEl.style.objectFit = "cover";
  videoEl.srcObject = stream;

  const nextFrame = () => new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });

  const play = async () => {
    try {
      if (showWrap) showWrap.classList.remove("hidden");
      const videoTrack = stream.getVideoTracks?.()[0];
      if (videoTrack && videoTrack.readyState === "live" && videoTrack.muted) {
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; videoTrack.removeEventListener("unmute", finish); resolve(); } };
          videoTrack.addEventListener("unmute", finish, { once: true });
          setTimeout(finish, 300);
        });
      }
      await nextFrame();
      const result = videoEl.play();
      if (result && typeof result.then === "function") await result;
      console.debug(`[call-diag] Video Rendering (${label})`, {
        readyState: videoEl.readyState,
        videoWidth: videoEl.videoWidth,
        videoHeight: videoEl.videoHeight,
        trackLive: !!stream.getVideoTracks?.().some(t => t.readyState === "live")
      });
      return true;
    } catch (e) {
      console.debug(`[call-diag] Video play deferred (${label}): ${e && e.name}`);
      return false;
    }
  };

  if (await play() && (videoEl.videoWidth > 0 || videoEl.readyState >= 2)) return true;

  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("loadedmetadata", finish);
      videoEl.removeEventListener("canplay", finish);
      videoEl.removeEventListener("playing", finish);
      resolve();
    };
    videoEl.addEventListener("loadedmetadata", finish, { once: true });
    videoEl.addEventListener("canplay", finish, { once: true });
    videoEl.addEventListener("playing", finish, { once: true });
    setTimeout(finish, 1200);
  });

  if (await play() && (videoEl.videoWidth > 0 || videoEl.readyState >= 2)) return true;
  await new Promise((r) => setTimeout(r, 350));
  return play();
}

function streamForTrackEvent(event, fallbackStream) {
  if (event && event.streams && event.streams[0]) return event.streams[0];
  const stream = fallbackStream || new MediaStream();
  if (event && event.track && !stream.getTracks().some((t) => t.id === event.track.id)) {
    try { stream.addTrack(event.track); } catch (e) {}
  }
  return stream;
}

async function acquireCallMedia(type, facingMode) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    throw new Error("getUserMedia unavailable");
  }
  if (type !== "video") return navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS, video: false });
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS, video: videoConstraints(facingMode) });
  } catch (firstError) {
    console.debug("[call-diag] video constraints fallback:", firstError && firstError.name);
    return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  }
}


async function getIceServers() {
  if (iceServersCache && (Date.now() - iceServersCacheAt) < ICE_SERVERS_CACHE_MAX_AGE_MS) return iceServersCache;
  try {
    // PHASE 1 (Tier A): userId is optional/advisory — server never trusts
    // it for access control, only uses it to label a dynamic TURN
    // credential for easier auditing. Safe no-op if `me` isn't set yet.
    const uidParam = (typeof me !== "undefined" && me && me.userId) ? `?userId=${encodeURIComponent(me.userId)}` : "";
    const r = await api(`/api/calls/ice-servers${uidParam}`);
    iceServersCache = (r.success && r.iceServers && r.iceServers.length) ? r.iceServers : [{ urls: "stun:stun.l.google.com:19302" }];
    iceServersCacheAt = Date.now();
  } catch (e) {
    iceServersCache = [{ urls: "stun:stun.l.google.com:19302" }];
    iceServersCacheAt = Date.now();
  }
  // Diagnostics only (console, no UI): mirrors the server's own
  // "TURN Loaded"/"TURN Missing" log so it's visible from the client side
  // too, without a second network call — inferred from whether any entry
  // in the same response already carries TURN credentials.
  const hasTurn = iceServersCache.some((s) => s && s.username && s.credential);
  console.debug(hasTurn ? "[ice-config] TURN Loaded (client)" : "[ice-config] TURN Missing — STUN-only (client)");
  return iceServersCache;
}

function showCallOverlay() { $("call-overlay").classList.remove("hidden"); }
function hideCallOverlay() {
  $("call-overlay").classList.add("hidden");
  $("call-video-remote-wrap").classList.add("hidden");
  $("call-incoming-actions").classList.add("hidden");
  $("call-outgoing-actions").classList.add("hidden");
  $("call-active-controls").classList.add("hidden");
  $("call-video-remote").srcObject = null;
  // BUG FIX (crash on call end): these two elements don't exist in the
  // private call overlay markup (private calls only ever show a remote
  // video wrap + audio sink — see the comment on #call-overlay in
  // index.html). Calling .srcObject/.classList on a missing element threw
  // a TypeError every time a call ended, aborting the rest of this
  // cleanup function silently. Guarded the same way the video-track
  // recovery handler elsewhere in this file already does.
  const localVideoEl = $("call-video-local");
  if (localVideoEl) localVideoEl.srcObject = null;
  const localVideoWrapEl = $("call-video-local-wrap");
  if (localVideoWrapEl) localVideoWrapEl.classList.add("hidden"); // BLACK-SCREEN FIX (2026-08-27)
}
function setCallStatusText(t) { $("call-status-text").textContent = t; }

function startCallTimer() {
  callSeconds = 0;
  setCallStatusText("00:00");
  stopCallTimer();
  callTimerHandle = setInterval(() => { callSeconds++; setCallStatusText(formatCallDuration(callSeconds)); }, 1000);
}
function stopCallTimer() { if (callTimerHandle) clearInterval(callTimerHandle); callTimerHandle = null; }

function teardownCall() {
  console.debug("[call-diag] Call Disconnected");
  stopCallTimer();
  if (callPc) {
    if (callPc._diagTimer) clearInterval(callPc._diagTimer);
    // Explicitly stop every sender's track before close(), and clear the
    // event handlers we attached — close() alone stops tracks too, but
    // being explicit here avoids relying on that for the onended-based
    // track-recovery handlers, so they can never fire during a normal,
    // intentional teardown and try to "recover" a call that's already over.
    try {
      callPc.getSenders().forEach((s) => { if (s.track) { s.track.onended = null; s.track.stop(); console.debug(`[call-diag] Track Removed (${s.track.kind})`); } });
    } catch (e) {}
    callPc.onicecandidate = null;
    callPc.ontrack = null;
    callPc.oniceconnectionstatechange = null;
    callPc.onconnectionstatechange = null;
    try { callPc.close(); } catch (e) {}
    callPc = null;
  }
  if (callLocalStream) { callLocalStream.getTracks().forEach((t) => { t.onended = null; t.stop(); }); callLocalStream = null; }
  pendingIceCandidates = [];
  pendingOfferSdp = null;
  pendingLocalIceCandidates = [];
  micMuted = false; cameraOff = false;
  $("btn-call-mute").classList.remove("active");
  currentCall = null;
  hideCallOverlay();
}

function createPeerConnection(iceServers) {
  const pc = new RTCPeerConnection({ iceServers });
  const sentCandidates = new Set(); // dedup, same as room voice — each unique candidate only needs sending once
  pc.onicecandidate = (e) => {
    if (!e.candidate || !currentCall) return;
    const key = e.candidate.candidate;
    if (sentCandidates.has(key)) return;
    sentCandidates.add(key);
    if (!currentCall.callId) {
      pendingLocalIceCandidates.push(e.candidate);
      return;
    }
    socket.emit("call:ice-candidate", { callId: currentCall.callId, candidate: e.candidate });
  };
  pc._diagTimer = startConnectionDiagnostics(pc, "call");
  pc.ontrack = (e) => {
    console.debug(`[call-diag] Remote Stream Ready track=${e.track.kind}`);
    const remoteVideo = $("call-video-remote");
    const stream = streamForTrackEvent(e, remoteVideo.srcObject instanceof MediaStream ? remoteVideo.srcObject : null);
    if (remoteVideo.srcObject !== stream) remoteVideo.srcObject = stream;
    if (e.track.kind === "audio") {
      const playPromise = remoteVideo.play();
      if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
    }
  };

  // ROOT-CAUSE FIX (voice stability pass): this used to hang up on the very
  // first ICE hiccup (Wi-Fi<->mobile switch, a couple seconds of dead
  // signal), with no attempt to recover — unlike the room-voice mesh
  // elsewhere in app.js, which already does a real ICE restart before ever
  // giving up. Mirrors that same recover-first pattern here: try one ICE
  // restart (only the original caller re-offers — an answerer only ever
  // reacts to call:offer, same as normal call setup), and only end the call
  // if that restart doesn't recover within a few seconds.
  let iceRestartTried = false;
  let iceFailTimer = null;
  pc.oniceconnectionstatechange = () => {
    console.debug(`[call-diag] ICE State: ${pc.iceConnectionState}`);
    if (!currentCall) return;
    const state = pc.iceConnectionState;
    if (state === "connected" || state === "completed") {
      iceRestartTried = false;
      if (iceFailTimer) { clearTimeout(iceFailTimer); iceFailTimer = null; }
      return;
    }
    if (state === "failed" || state === "disconnected") {
      if (currentCall.role === "caller" && !iceRestartTried && state === "failed") {
        iceRestartTried = true;
        setCallStatusText("Reconnecting...");
        pc.createOffer({ iceRestart: true })
          .then((offer) => pc.setLocalDescription(applyOpusFEC(offer)))
          .then(() => { if (currentCall) socket.emit("call:offer", { callId: currentCall.callId, sdp: pc.localDescription }); })
          .catch(() => {});
      }
      if (iceFailTimer) clearTimeout(iceFailTimer);
      iceFailTimer = setTimeout(() => {
        if (currentCall && (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected")) endCurrentCall();
      }, 8000);
    }
  };
  pc.onconnectionstatechange = () => {
    console.debug(`[call-diag] Connection State: ${pc.connectionState}`);
    if (!currentCall) return;
    if (pc.connectionState === "connecting") setCallStatusText("Reconnecting...");
  };
  return pc;
}

// STABILITY FIX: neither startCall() nor the accept handler previously
// guarded against a stale/leftover callPc before creating a new one (e.g. a
// double-tap on Accept, or a fast reject-then-call-again sequence landing
// inside the same tick). A leftover open RTCPeerConnection left dangling
// like that is a real duplicate-PeerConnection + memory-leak risk. Every
// call site below now routes through this instead of `new` + assign
// directly, so a prior connection is always closed first.
function createFreshCallPc(iceServers) {
  if (callPc) {
    console.debug("[call-diag] closing stale PeerConnection before creating a new one");
    if (callPc._diagTimer) clearInterval(callPc._diagTimer);
    try { callPc.close(); } catch (e) {}
    callPc = null;
  }
  return createPeerConnection(iceServers);
}

// STABILITY FIX: getUserMedia previously had zero retry logic — any
// transient failure (device briefly busy with another app, OS permission
// dialog race, a device enumeration hiccup right after a fresh permission
// grant) tore the call down immediately with a generic toast. Real-world
// failures here are frequently transient, so this now retries once after a
// short delay for the recoverable error classes (NotReadableError /
// TrackStartError = device busy, AbortError = OS-level hiccup) before
// giving up. Permission-denied and no-device errors are never retried since
// a retry can't fix those. Console-only diagnostics added per the
// diagnostics requirement; no UI/architecture change.
async function acquireLocalMedia(type, facingMode, _isRetry) {
  let stream;
  try {
    stream = await acquireCallMedia(type, facingMode);
    console.debug(`[call-diag] Media Permission granted (${type})`);
  } catch (e) {
    console.debug(`[call-diag] Media Permission failed (${type}): ${e && e.name}`);
    const retryable = e && (e.name === "NotReadableError" || e.name === "TrackStartError" || e.name === "AbortError");
    if (retryable && !_isRetry) {
      await new Promise((res) => setTimeout(res, 600));
      return acquireLocalMedia(type, facingMode, true);
    }
    throw e;
  }
  callLocalStream = stream;
  console.debug(`[call-diag] Local Stream Ready (${type}) tracks=${stream.getTracks().map((t) => t.kind).join(",")}`);
  // Track-end recovery: if the OS/browser kills a track out from under us
  // (device unplugged, permission revoked mid-call, app backgrounded on a
  // platform that suspends media), try once to reacquire the same kind of
  // track and hot-swap it into the active peer connection rather than
  // leaving the call silently dead-audio or frozen-video.
  stream.getTracks().forEach((track) => {
    track.onended = () => {
      console.debug(`[call-diag] Track Removed unexpectedly (${track.kind})`);
      if (!currentCall || !callPc || !callLocalStream) return;
      const kind = track.kind;
      const recoveryConstraints = kind === "video"
        ? { video: videoConstraints(usingFrontCamera ? "user" : "environment") }
        : { audio: VOICE_AUDIO_CONSTRAINTS };
      navigator.mediaDevices.getUserMedia(recoveryConstraints).then((recStream) => {
        const newTrack = kind === "video" ? recStream.getVideoTracks()[0] : recStream.getAudioTracks()[0];
        if (!newTrack || !callLocalStream) return;
        const sender = callPc.getSenders().find((s) => s.track && s.track.kind === kind);
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
        callLocalStream.addTrack(newTrack);
        newTrack.onended = track.onended;
        if (kind === "video") { const lv = $("call-video-local"); if (lv) lv.srcObject = callLocalStream; }
        console.debug(`[call-diag] Track Added via recovery (${kind})`);
      }).catch(() => { console.debug(`[call-diag] Track recovery failed (${kind})`); });
    };
  });
  if (type === "video") {
    // BUGFIX 2026-08-22: only reveal the local self-preview here. The full
    // #call-video-remote-wrap (which now paints ON TOP of the avatar/name/
    // status panel — see style.css) is left hidden until the peer's video
    // track actually arrives in ontrack(), so "Calling..."/the peer's name
    // still stay visible while dialing/connecting instead of being covered
    // by an empty black box before anyone has actually connected.
    const localVideo = $("call-video-local");
    await attachLiveVideo(localVideo, stream, "local", { showWrap: $("call-video-local-wrap") });
    console.debug("[call-diag] Video track settings:", stream.getVideoTracks()[0]?.getSettings?.() || {});
  }
  return stream;
}

async function startCall(type) {
  // Private inbox calling is intentionally audio-only. Keep the function
  // signature for compatibility with any stale UI code, but never allow a
  // private video call to be created.
  type = "audio";
  if (!threadPeerId) return;
  if (currentCall) { toast("You're already on a call"); return; }
  const eligibility = await api("/api/calls/eligibility/" + encodeURIComponent(threadPeerId));
  if (!eligibility.success || !eligibility.eligible) {
    toast("Audio call is available only when both users follow each other");
    refreshThreadSafetyActions();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Calling isn't supported on this browser"); return; }
  currentCall = { callId: null, peerId: threadPeerId, peerName: threadPeerName, peerPhoto: threadPeerPhoto, type, role: "caller", status: "dialing" };
  $("call-peer-photo").src = threadPeerPhoto || placeholderAvatar(threadPeerName);
  $("call-peer-name").textContent = threadPeerName;
  setCallStatusText("Calling...");
  $("call-outgoing-actions").classList.remove("hidden");
  showCallOverlay();
  try {
    const iceServers = await getIceServers();
    await acquireLocalMedia(type, "user");
    callPc = createFreshCallPc(iceServers);
    callLocalStream.getTracks().forEach((t) => { callPc.addTrack(t, callLocalStream); console.debug(`[call-diag] Track Added (${t.kind})`); });
  } catch (e) {
    toast("Couldn't access microphone/camera");
    teardownCall();
    return;
  }
  socket.emit("call:invite", { toUserId: threadPeerId, callType: type });
}
$("btn-thread-audio-call").addEventListener("click", () => startCall("audio"));

function showIncomingCall(callId, callType, from) {
  // Private inbox calls are audio-only. Reject legacy video invites from an
  // older client so a stale APK cannot bring back the removed video feature.
  if (callType !== "audio") {
    socket.emit("call:reject", { callId });
    return;
  }
  if (currentCall) { socket.emit("call:reject", { callId }); return; } // already busy locally
  currentCall = { callId, peerId: from.userId, peerName: from.userName, peerPhoto: from.userPhoto, type: "audio", role: "callee", status: "ringing" };
  $("call-peer-photo").src = from.userPhoto || placeholderAvatar(from.userName);
  $("call-peer-name").textContent = from.userName;
  setCallStatusText("Audio call...");
  $("call-accept-icon").src = "images/icons/icon-call.jpg";
  $("call-incoming-actions").classList.remove("hidden");
  showCallOverlay();
}
$("btn-call-reject").addEventListener("click", () => {
  if (!currentCall) return;
  socket.emit("call:reject", { callId: currentCall.callId });
  teardownCall();
});
$("btn-call-cancel").addEventListener("click", () => {
  if (!currentCall) return;
  socket.emit("call:cancel", { callId: currentCall.callId });
  teardownCall();
});
$("btn-call-accept").addEventListener("click", async () => {
  if (!currentCall) return;
  const callId = currentCall.callId, type = currentCall.type;
  // IMPORTANT: do not acknowledge the call until the callee has a local
  // media stream AND a PeerConnection ready.  Previously call:accept was
  // emitted first, which let the caller immediately create/send its SDP
  // offer while this device was still opening the camera. On Android
  // WebView that race can leave the call accepted but the video negotiation
  // incomplete.
  setCallStatusText("Connecting...");
  $("call-incoming-actions").classList.add("hidden");
  $("call-active-controls").classList.remove("hidden");
  try {
    const iceServers = await getIceServers();
    await acquireLocalMedia(type, "user");
    callPc = createFreshCallPc(iceServers);
    callLocalStream.getTracks().forEach((t) => { callPc.addTrack(t, callLocalStream); console.debug(`[call-diag] Track Added (${t.kind})`); });
    // Now that our PC/media are ready, acknowledge the call. The caller can
    // safely start SDP negotiation immediately after this point.
    socket.emit("call:accept", { callId });
    if (pendingOfferSdp) { await applyIncomingOffer(pendingOfferSdp); pendingOfferSdp = null; }
  } catch (e) {
    console.error("[call-diag] Callee setup failed before accept:", e?.name, e?.message);
    toast("Couldn't access microphone/camera");
    socket.emit("call:end", { callId });
    teardownCall();
  }
});
$("btn-call-hangup").addEventListener("click", () => endCurrentCall());
function endCurrentCall() {
  if (!currentCall) return;
  socket.emit("call:end", { callId: currentCall.callId });
  teardownCall();
}

async function applyIncomingOffer(sdp) {
  await callPc.setRemoteDescription(new RTCSessionDescription(sdp));
  for (const c of pendingIceCandidates) { try { await callPc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {} }
  pendingIceCandidates = [];
  const answer = applyOpusFEC(await callPc.createAnswer());
  await callPc.setLocalDescription(answer);
  socket.emit("call:answer", { callId: currentCall.callId, sdp: answer });
}

// ----- Mute / camera / camera-switch / speaker -----
$("btn-call-mute").addEventListener("click", () => {
  if (!callLocalStream) return;
  micMuted = !micMuted;
  callLocalStream.getAudioTracks().forEach((t) => t.enabled = !micMuted);
  console.debug(`[call-diag] Microphone ${micMuted ? "Disabled" : "Enabled"}`);
  $("btn-call-mute").classList.toggle("active", micMuted);
  if (currentCall) socket.emit("call:media-state", { callId: currentCall.callId, micMuted, cameraOff });
});
// Speaker/earpiece routing: browsers only expose HTMLMediaElement.setSinkId
// on a handful of platforms (mainly Chrome desktop) — there is no standard
// web API to force a phone's earpiece vs. loudspeaker the way a native
// Android/iOS app can. This toggle applies setSinkId where supported and
// otherwise just reflects the intended state in the UI; true earpiece
// routing on iOS/Android WebView needs a small native bridge (out of scope
// for a web-only client) — flagging this explicitly rather than silently
// no-op-ing.
$("btn-call-speaker").addEventListener("click", async () => {
  speakerOn = !speakerOn;
  $("btn-call-speaker").classList.toggle("active", speakerOn);
  const remoteVideo = $("call-video-remote");
  if (typeof remoteVideo.setSinkId === "function") {
    try { await remoteVideo.setSinkId(speakerOn ? "default" : "communications"); } catch (e) {}
  }
});

function registerCallSocketEvents() {
  socket.on("call:ringing", ({ callId }) => {
    if (currentCall) {
      currentCall.callId = callId;
      for (const candidate of pendingLocalIceCandidates) socket.emit("call:ice-candidate", { callId, candidate });
      pendingLocalIceCandidates = [];
    }
    setCallStatusText("Ringing...");
  });
  socket.on("call:incoming", ({ callId, callType, from }) => showIncomingCall(callId, callType, from));
  socket.on("call:incoming-cancel", ({ callId }) => {
    if (currentCall && currentCall.callId === callId && currentCall.status === "ringing" && currentCall.role === "callee") teardownCall();
  });

  socket.on("call:accepted", async ({ callId }) => {
    if (!currentCall) return;
    currentCall.callId = callId;
    for (const candidate of pendingLocalIceCandidates) socket.emit("call:ice-candidate", { callId, candidate });
    pendingLocalIceCandidates = [];
    currentCall.status = "connecting";
    setCallStatusText("Connecting...");
    $("call-outgoing-actions").classList.add("hidden");
    $("call-active-controls").classList.remove("hidden");
    try {
      const offer = applyOpusFEC(await callPc.createOffer());
      await callPc.setLocalDescription(offer);
      socket.emit("call:offer", { callId, sdp: offer });
    } catch (e) { toast("Call failed to connect"); endCurrentCall(); }
  });

  socket.on("call:offer", async ({ callId, sdp }) => {
    if (!currentCall) return;
    if (currentCall.callId === null) currentCall.callId = callId;
    if (!callPc) { pendingOfferSdp = sdp; return; } // caller's offer beat our own media/pc setup
    await applyIncomingOffer(sdp);
  });

  socket.on("call:answer", async ({ sdp }) => {
    // Duplicate-answer guard, same reasoning as room voice: only meaningful
    // while we're actually waiting on one.
    if (!callPc || callPc.signalingState !== "have-local-offer") return;
    try { await callPc.setRemoteDescription(new RTCSessionDescription(sdp)); } catch (e) { return; }
    for (const c of pendingIceCandidates) { try { await callPc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) {} }
    pendingIceCandidates = [];
  });

  socket.on("call:ice-candidate", async ({ candidate }) => {
    // Invalid-candidate guard: a malformed payload (missing/non-string
    // `candidate` field) should never be queued or handed to
    // RTCIceCandidate — both would either throw or silently pollute the
    // pending queue with junk that can never apply.
    if (!candidate || typeof candidate.candidate !== "string") { console.debug("[call-diag] ignored invalid ICE candidate"); return; }
    if (!callPc || !callPc.remoteDescription) { pendingIceCandidates.push(candidate); return; }
    try { await callPc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
  });

  socket.on("call:connected", () => { console.debug("[call-diag] Call Connected"); if (currentCall) { currentCall.status = "connected"; startCallTimer(); } });

  // Server-side disconnect-grace-period fix: the other side's socket
  // dropped (refresh, brief network blip) but the call itself is being
  // held open for a few seconds rather than ended outright.
  socket.on("call:peer-reconnecting", ({ callId }) => {
    if (currentCall && currentCall.callId === callId) setCallStatusText("Connection lost — waiting...");
  });
  socket.on("call:peer-resumed", ({ callId }) => {
    if (currentCall && currentCall.callId === callId && currentCall.status === "connected") setCallStatusText(formatCallDuration(callSeconds));
  });

  socket.on("call:peer-media-state", ({ micMuted: peerMuted }) => {
    if (currentCall) setCallStatusText(peerMuted ? (currentCall.peerName + " is muted") : formatCallDuration(callSeconds));
  });

  socket.on("call:not-eligible", (payload) => {
  teardownCall();
  toast(payload?.message || "Audio call requires both users to follow each other");
  refreshThreadSafetyActions();
});
socket.on("call:busy", ({ toUserId, self }) => {
    toast(self ? "You're already on a call" : "That user is on another call");
    teardownCall();
  });
  socket.on("call:offline", () => { toast("User is offline"); teardownCall(); });

  socket.on("call:ended", (payload) => {
    if (payload.historyEntry && threadPeerId && currentCall && (currentCall.peerId === threadPeerId)) {
      appendThreadCallLog(payload.historyEntry);
    }
    if (!payload.self) {
      const reasonText = { rejected: "Call declined", cancelled: "Call cancelled", "no-answer": "Missed call", "peer-disconnected": "Call ended" }[payload.reason];
      if (reasonText) toast(reasonText);
    }
    teardownCall();
  });
}

// ===========================================================================
// PROFILE SETTINGS / HELP / LEVEL
// ===========================================================================
// ===========================================================================
// CP CENTER — profile entry, accepted pair, live day counter, Following invites
// ===========================================================================
let cpCenterTimer = null;
let cpCenterFollowing = [];
let cpCenterRelationship = null;

function cpCenterOtherId(rel) {
  if (!rel) return null;
  return rel.userA === me.userId ? rel.userB : rel.userA;
}

function cpCenterDays(acceptedAt) {
  const ts = Number(acceptedAt || 0);
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function renderCpCenterDays() {
  const el = $("cp-center-days");
  const bond = $("cp-center-bond-line");
  const levelEl = $("cp-center-level");
  const days = cpCenterRelationship ? cpCenterDays(cpCenterRelationship.acceptedAt) : 0;
  const bondLevel = days > 0 ? Math.max(1, Math.round(days / 10)) : 0;
  if (el) el.textContent = days;
  if (levelEl) levelEl.textContent = `LV ${bondLevel}`;
  if (bond) bond.textContent = `Bond Level • ${bondLevel} • Together for ${days} day${days === 1 ? "" : "s"}`;
}

function stopCpCenterTimer() {
  if (cpCenterTimer) clearInterval(cpCenterTimer);
  cpCenterTimer = null;
}

function startCpCenterTimer() {
  stopCpCenterTimer();
  renderCpCenterDays();
  cpCenterTimer = setInterval(renderCpCenterDays, 1000);
}

async function loadCpCenterRelationship() {
  cpCenterRelationship = null;
  try {
    const r = await api(`/api/relationships/mine/${encodeURIComponent(me.userId)}`);
    if (r.success) cpCenterRelationship = (r.relationships || []).find(x => x.type === "cp" && x.status === "accepted") || null;
  } catch (_) {}

  const avatar = $("cp-center-me-avatar");
  if (avatar) avatar.src = me.photo || placeholderAvatar(me.name);
  $("cp-center-me-name").textContent = me.name || "You";

  const partnerBlock = $("cp-center-partner-block");
  const status = $("cp-center-status");
  const meIdEl = $("cp-center-me-id");
  const meTagsEl = $("cp-center-me-tags");
  const renderCpTags = (wrap, user, roleLabel) => {
    if (!wrap) return;
    wrap.innerHTML = "";
    const tags = [];
    const vip = Number(user?.vipLevel || 0);
    if (vip > 0) tags.push(`<span class="pp-cp-tag pp-cp-vip">VIP ${vip}</span>`);
    if (user?.customTag?.text) tags.push(`<span class="pp-cp-tag pp-cp-custom" style="background:${escapeHtml(user.customTag.color || "#F7CE7E")};color:${tagTextColor(user.customTag.color)}">${escapeHtml(user.customTag.text)}</span>`);
    if (roleLabel) tags.push(`<span class="pp-cp-tag pp-cp-role">${escapeHtml(roleLabel)}</span>`);
    wrap.innerHTML = tags.join("");
  };
  if (meIdEl) meIdEl.textContent = `ID: ${me.customId || me.userId || "—"}`;
  renderCpTags(meTagsEl, me, "OWNER");
  const mainInvite = $("btn-cp-invite-scroll");
  const summary = $("menu-cp-summary");
  const endCp = $("btn-cp-end");

  if (cpCenterRelationship) {
    const otherId = cpCenterOtherId(cpCenterRelationship);
    let other = null;
    try {
      const ur = await api(`/api/user/by-id/${encodeURIComponent(otherId)}?viewerId=${encodeURIComponent(me.userId || "")}`);
      if (ur.success) other = ur.user;
    } catch (_) {}
    if (other) {
      partnerBlock.classList.remove("pp-cp-empty-person");
      partnerBlock.innerHTML = `<div class="pp-cp-avatar-ring"><img src="${escapeHtml(other.photo || placeholderAvatar(other.name))}" alt="CP partner"></div><div class="pp-cp-name">${escapeHtml(other.name || "CP")}</div><div class="pp-cp-id" id="cp-center-partner-id">ID: ${escapeHtml(other.customId || other.userId || "—")}</div><div class="pp-cp-tags" id="cp-center-partner-tags"></div>`;
      const partnerTags = $("cp-center-partner-tags");
      if (partnerTags) {
        const vip = Number(other.vipLevel || 0);
        const parts = [];
        if (vip > 0) parts.push(`<span class="pp-cp-tag pp-cp-vip">VIP ${vip}</span>`);
        if (other.customTag?.text) parts.push(`<span class="pp-cp-tag pp-cp-custom" style="background:${escapeHtml(other.customTag.color || "#F7CE7E")};color:${tagTextColor(other.customTag.color)}">${escapeHtml(other.customTag.text)}</span>`);
        parts.push(`<span class="pp-cp-tag pp-cp-role">CP</span>`);
        partnerTags.innerHTML = parts.join("");
      }
      status.textContent = `CP active with ${other.name || "your partner"}`;
    } else {
      partnerBlock.classList.remove("pp-cp-empty-person");
      partnerBlock.innerHTML = `<div class="pp-cp-avatar-ring"><img src="${placeholderAvatar("CP")}" alt="CP partner"></div><div class="pp-cp-name">CP</div>`;
      status.textContent = "CP active";
    }
    mainInvite.textContent = "CP Active";
    mainInvite.disabled = true;
    if (endCp) endCp.classList.remove("hidden");
    startCpCenterTimer();
  } else {
    partnerBlock.className = "pp-cp-person pp-cp-empty-person";
    partnerBlock.innerHTML = `<div class="pp-cp-avatar-ring pp-cp-empty-avatar"><span>+</span></div><div class="pp-cp-name" id="cp-center-partner-name">Invite</div>`;
    status.textContent = "You don’t have CP yet.";
    mainInvite.textContent = "Invite CP";
    mainInvite.disabled = false;
    if (endCp) endCp.classList.add("hidden");
    $("cp-center-days").textContent = "0";
    stopCpCenterTimer();
  }
}

function renderCpFollowingList() {
  const wrap = $("cp-center-following-list");
  const empty = $("cp-center-following-empty");
  const q = String($("cp-center-search")?.value || "").trim().toLowerCase();
  if (!wrap || !empty) return;
  const list = cpCenterFollowing.filter(u => {
    if (!q) return true;
    return String(u.name || "").toLowerCase().includes(q) || String(u.userId || "").toLowerCase().includes(q);
  });
  wrap.innerHTML = "";
  empty.classList.toggle("hidden", list.length > 0);
  list.forEach(u => {
    const row = document.createElement("div");
    row.className = "pp-cp-follow-row";
    row.innerHTML = `
      <img class="pp-cp-follow-avatar" src="${escapeHtml(u.photo || placeholderAvatar(u.name))}" alt="">
      <div class="pp-cp-follow-info"><div class="pp-cp-follow-name">${escapeHtml(u.name || "User")}</div><div class="pp-cp-follow-id">ID: ${escapeHtml(u.userId || "")}</div></div>
      <button class="pp-cp-invite-btn" type="button" data-cp-user-id="${escapeHtml(u.userId || "")}">Invite</button>`;
    const btn = row.querySelector(".pp-cp-invite-btn");
    btn.addEventListener("click", async () => {
      if (cpCenterRelationship) return;
      await sendRelationshipRequest(u.userId, "cp", "cp-center");
      await loadCpCenterRelationship();
      renderCpFollowingList();
    });
    wrap.appendChild(row);
  });
}

async function loadCpCenterFollowing() {
  try {
    const r = await api(`/api/user/${encodeURIComponent(me.mobile)}/following`);
    cpCenterFollowing = r.success ? (r.following || []) : [];
  } catch (_) { cpCenterFollowing = []; }
  renderCpFollowingList();
}


$("cp-center-search")?.addEventListener("input", renderCpFollowingList);
$("btn-cp-center-back")?.addEventListener("click", () => { stopCpCenterTimer(); showView("view-profile"); });
$("btn-cp-help")?.addEventListener("click", () => toast("CP starts when the request is accepted. The day counter begins at acceptance."));
$("btn-cp-invite-scroll")?.addEventListener("click", () => document.querySelector("#cp-center-search")?.scrollIntoView({ behavior: "smooth", block: "center" }));
$("btn-cp-end")?.addEventListener("click", async () => {
  if (!cpCenterRelationship) return;
  const targetUserId = cpCenterOtherId(cpCenterRelationship);
  if (!targetUserId) return;
  await uncpRelationship(targetUserId, "cp-center");
  await loadCpCenterRelationship();
});

// ===========================================================================
// GENERIC BACK BUTTONS + MENU NAVIGATION
// ===========================================================================
document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.getAttribute("data-back")));
});

$("menu-wallet").addEventListener("click", openWallet);
$("menu-withdraw")?.addEventListener("click", openWithdraw);
$("menu-frames").addEventListener("click", () => showView("view-shop"));
$("menu-agency")?.addEventListener("click", openAgency);
$("menu-diamond-center").addEventListener("click", openDiamondCenter);
$("menu-merchant-center")?.addEventListener("click", openMerchantCenter);
$("menu-seller-center")?.addEventListener("click", openMerchantCenter);
// Profile navigation: these rows are functional entry points.
$("menu-cp-center")?.addEventListener("click", async () => {
  showView("view-cp-center");
  try { await loadCpCenterRelationship(); } catch (_) {}
});
$("menu-level")?.addEventListener("click", () => {
  showView("view-profile-level");
  try { loadProfileLevel?.(); } catch (_) {}
});
async function refreshDailyTaskReward() {
  const btn = $("btn-daily-treasure");
  const status = $("daily-task-reward-status");
  if (!btn) return;
  btn.disabled = true;
  try {
    const r = await api("/api/daily-reward/state");
    if (!r || !r.success) throw new Error(r?.message || "Sign in to claim rewards.");
    btn.disabled = false;
    btn.textContent = r.claimedToday ? "View Daily Task" : `Claim Day ${r.nextDay}`;
    if (status) status.textContent = r.claimedToday ? "Reward collected. Come back after the 12-hour cooldown for the next day." : `Day ${r.nextDay} reward: ${Number(r.rewards?.[r.nextDay - 1] || 0).toLocaleString()} Diamonds. Claim once every 12 hours. Missing 36 hours resets the streak to Day 1.`;
    const roomBonusStatus = $("room-gift-bonus-status");
    if (roomBonusStatus) roomBonusStatus.textContent = `Pending room bonus: ${Number(r.roomGiftBonusPendingDiamonds || 0).toLocaleString()} Diamonds. The room owner receives 2% of eligible gift spend in their diamond wallet after midnight (India time).`;
    const popupClaim = $("btn-daily-task-popup-claim");
    const popupStatus = $("daily-task-popup-status");
    const popupAmount = $("daily-task-popup-amount");
    const popupStreak = $("daily-task-popup-streak");
    if (popupClaim) {
      popupClaim.disabled = !!r.claimedToday;
      popupClaim.textContent = r.claimedToday ? "Claimed for now" : `Claim Day ${r.nextDay}`;
    }
    if (popupAmount) popupAmount.textContent = `${Number(r.rewards?.[r.nextDay - 1] || 0).toLocaleString()} Diamonds`;
    if (popupStatus) popupStatus.textContent = r.claimedToday ? "Reward collected. Return after the 12-hour cooldown." : "Ready to claim. Your reward is credited by the server after successful claim.";
    if (popupStreak) popupStreak.textContent = `Day ${r.nextDay} of 7 · one claim per 12-hour cooldown · missed 36 hours resets the streak`;
    const schedule = $("daily-task-popup-schedule");
    if (schedule) schedule.innerHTML = (r.rewards || []).map((amount, index) => `<div class="daily-task-schedule-day ${index + 1 === Number(r.nextDay) ? "current" : ""} ${index + 1 < Number(r.nextDay) ? "past" : ""}"><span>Day ${index + 1}</span><b>${Number(amount || 0).toLocaleString()}</b><small>Diamonds</small></div>`).join("");
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Claim";
    if (status) status.textContent = e.message || "Unable to load reward status. Please try again.";
    const popupClaim = $("btn-daily-task-popup-claim");
    const popupStatus = $("daily-task-popup-status");
    if (popupClaim) { popupClaim.disabled = false; popupClaim.textContent = "Try Again"; }
    if (popupStatus) popupStatus.textContent = e.message || "Unable to load reward status. Please try again.";
  }
}
$("menu-daily-tasks")?.addEventListener("click", () => { showView("view-daily-tasks"); refreshDailyTaskReward(); });
$("btn-group-daily-task")?.addEventListener("click", () => { $("modal-group-detail")?.classList.add("hidden"); showView("view-daily-tasks"); refreshDailyTaskReward(); });
function openDailyTaskPopup() {
  const modal = $("modal-daily-task");
  if (modal) modal.classList.remove("hidden");
  refreshDailyTaskReward();
}
$("btn-room-daily-task")?.addEventListener("click", openDailyTaskPopup);
$("btn-daily-task-popup-close")?.addEventListener("click", () => $("modal-daily-task")?.classList.add("hidden"));
$("modal-daily-task")?.addEventListener("click", (event) => { if (event.target === $("modal-daily-task")) $("modal-daily-task").classList.add("hidden"); });
async function claimDailyTaskReward(button) {
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const r = await api("/api/daily-reward/claim", "POST", {});
    if (!r?.success) throw new Error(r?.message || "Reward could not be claimed.");
    if (typeof me === "object" && me) me.diamonds = Number(r.diamonds) || Number(me.diamonds) || 0;
    saveSession();
    fillHomeProfile();
    toast(`🎁 Reward collected: ${Number(r.reward || 0).toLocaleString()} Diamonds!`);
    await refreshDailyTaskReward();
  } catch (e) {
    toast(e.message || "Reward could not be claimed. Please try again.");
    await refreshDailyTaskReward();
  }
}
$("btn-daily-task-popup-claim")?.addEventListener("click", (event) => claimDailyTaskReward(event.currentTarget));
$("btn-daily-treasure")?.addEventListener("click", () => openDailyTaskPopup());

$("menu-help-feedback")?.addEventListener("click", () => showView("view-help-feedback"));
$("menu-settings")?.addEventListener("click", () => {
  showView("view-settings");
  try { updateSettingsCacheSize(); } catch (_) {}
});

$("menu-host-center").addEventListener("click", openHostCenter);

// ===========================================================================
// SETTINGS / PROFILE QUICK ACTIONS — functional recovery 2026-10-08
// ===========================================================================
function updateSettingsCacheSize() {
  const el = $("settings-cache-size");
  if (!el) return;
  let bytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (!k.startsWith("pp_")) bytes += String(localStorage.getItem(k) || "").length * 2;
    }
  } catch (_) {}
  el.textContent = bytes ? `~${Math.max(1, Math.round(bytes / 1024))} KB` : "Clean";
}
function openPolicyCenter(title) {
  const modal = $("modal-policy-center");
  const titleEl = $("policy-center-title");
  const content = $("policy-center-content");
  if (!modal || !content) return;
  if (titleEl) titleEl.textContent = title || "Terms of Service";
  content.innerHTML = `<div class="pp-info-card"><h3>${escapeHtml(title || "Policy")}</h3><p>This policy is part of the PingPong Party application. Please review the current policy before using the related feature. For account-specific questions, use Feedback & Support.</p></div>`;
  modal.classList.remove("hidden");
}

$("settings-privacy")?.addEventListener("click", () => $("modal-privacy-center")?.classList.remove("hidden"));
$("btn-privacy-center-close")?.addEventListener("click", () => $("modal-privacy-center")?.classList.add("hidden"));
$("settings-push-toggle")?.addEventListener("change", (e) => {
  try { localStorage.setItem("pp_push_enabled", e.target.checked ? "1" : "0"); } catch (_) {}
  toast(e.target.checked ? "Notifications enabled" : "Notifications disabled");
});
$("settings-cache")?.addEventListener("click", async () => {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i) || "";
      if (!k.startsWith("pp_")) localStorage.removeItem(k);
    }
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
  } catch (_) {}
  updateSettingsCacheSize();
  toast("Cache cleaned");
});
$("settings-sanitize")?.addEventListener("click", () => {
  if (!currentRoom) { toast("Join a room first"); return; }
  if (!me) { toast("Please log in again"); return; }
  const canManage = currentRoom.hostId === me.userId || (currentRoom.adminIds || []).includes(me.userId);
  if (!canManage) { toast("Only the room owner/admin can sanitize a room"); return; }
  // Use the existing clear-chat moderation action rather than a fake client-only action.
  socket.emit("mod-clear-chat", { roomId: currentRoomId });
  toast("Room chat sanitized");
});
$("settings-delete-account")?.addEventListener("click", async () => {
  if (!confirm("Delete your account permanently? This cannot be undone.")) return;
  try {
    const r = await api("/api/account", "DELETE", {});
    if (!r.success) { toast(r.message || "Account deletion failed"); return; }
    clearSession("account-deleted");
    showView("view-login");
    toast("Account deleted");
  } catch (_) { toast("Could not delete account right now"); }
});

document.querySelectorAll("[data-policy]").forEach(btn => btn.addEventListener("click", () => openPolicyCenter(btn.getAttribute("data-policy"))));
$("btn-policy-center-close")?.addEventListener("click", () => $("modal-policy-center")?.classList.add("hidden"));
document.querySelectorAll("[data-policy-tab]").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("[data-policy-tab]").forEach(b => b.classList.toggle("active", b === btn));
  openPolicyCenter(btn.textContent.trim());
}));
$("settings-power-code")?.addEventListener("click", async () => {
  const code = prompt("Enter your authorized Power Code:");
  if (!code) return;
  try {
    const r = await api("/api/godpower/activate", "POST", { code });
    toast(r.success ? "Power Code activated" : (r.message || "Power Code rejected"));
    if (r.success) fillHomeProfile?.();
  } catch (_) { toast("Power Code service unavailable"); }
});
$("settings-about")?.addEventListener("click", () => alert("PingPong Party\nProduction Premium\nv2.1.0"));
$("settings-feedback")?.addEventListener("click", async () => {
  const message = prompt("Write your feedback or support request:");
  if (!message?.trim()) return;
  try {
    const r = await api("/api/support/feedback", "POST", { type: "Other", message: message.trim() });
    toast(r.success ? "Feedback submitted" : (r.message || "Could not submit feedback"));
  } catch (_) { toast("Could not submit feedback right now"); }
});
$("settings-logout")?.addEventListener("click", () => {
  if (!confirm("Log out of this account?")) return;
  clearSession("user-requested-logout");
  showView("view-login");
});
$("settings-invites")?.addEventListener("click", () => openInbox());
$("settings-cp")?.addEventListener("click", async () => { showView("view-cp-center"); try { await loadCpCenterRelationship(); } catch (_) {} });
$("settings-level")?.addEventListener("click", () => { showView("view-profile-level"); try { loadProfileLevel?.(); } catch (_) {} });
$("btn-settings-invite-seat")?.addEventListener("click", () => {
  if (!currentRoom || !me) { toast("Join a room first"); return; }
  const canManage = currentRoom.hostId === me.userId || (currentRoom.adminIds || []).includes(me.userId);
  if (!canManage) { toast("Only the room owner/admin can invite users"); return; }
  const empty = Array.from({length:12}, (_,i) => i+1).find(n => !currentRoom.seats?.[n-1] && !(currentRoom.lockedSeats || []).includes(n));
  if (!empty) { toast("No free unlocked seat available"); return; }
  openOnlineMembersForSeatInvite(empty);
});
$("btn-settings-level")?.addEventListener("click", () => { $("modal-room-mod")?.classList.add("hidden"); $("modal-level-info")?.classList.remove("hidden"); if (levelInfoCache) renderLevelInfo(); else socket.emit("get-level-info", { userId: me?.userId }); });
$("btn-settings-cp")?.addEventListener("click", async () => { $("modal-room-mod")?.classList.add("hidden"); showView("view-cp-center"); try { await loadCpCenterRelationship(); } catch (_) {} });
$("btn-settings-admins")?.addEventListener("click", () => {
  const select = $("mod-admin-select");
  if (!select) return;
  if (!select.options.length) { toast("No other room members to manage"); return; }
  const target = select.options[0].textContent;
  const action = confirm(`Make ${target} an Admin?\nPress Cancel to leave admin management.`);
  if (action) socket.emit("set-admin", { roomId: currentRoomId, targetUserId: select.value, isAdmin: true });
});
updateSettingsCacheSize();

// ===========================================================================
// WALLET
// ===========================================================================
async function openWallet() {
  const frame = $("wallet-ui-frame");
  if (frame) {
    const base = "/wallet-ui.html?userId=" + encodeURIComponent(me.userId || "");
    if (!frame.src || !frame.src.endsWith(base)) frame.src = base;
  }
  showView("view-wallet");
}

// ===========================================================================
// WITHDRAW (Beans -> USD -> Withdrawal, 2026-08-31, additive) — same iframe
// pattern as openWallet() above; the page itself (public/withdraw.html) uses
// the authenticated /api/withdrawal/* routes, never a client-supplied userId.
// ===========================================================================
async function openWithdraw() {
  const frame = $("withdraw-ui-frame");
  if (frame && (!frame.src || frame.src === "about:blank")) {
    frame.src = "/withdraw.html";
  }
  showView("view-withdraw");
}

// ===========================================================================
// RECHARGE / PAYMENT -> COIN SYSTEM (2026-08-16)
// ---------------------------------------------------------------
// Manual UPI/PhonePe/Google Pay flow: pick a package -> pick a method (all
// three just point the user at the same Admin-configured UPI ID/QR — there
// is no payment gateway API integrated) -> pay outside the app -> submit
// the UTR -> wait for Admin verification. This screen NEVER shows a
// "payment successful" state on its own; the only state it can reach after
// submitting is "Pending Verification" (see PAYMENT_METHOD_ICONS below for
// what each method actually does).
// ===========================================================================
let rechargeConfig = null;
let rechargeSelected = { pkg: null, method: null, order: null, paymentData: null };

const PAYMENT_METHOD_ICONS = { upi: "🏦", phonepe: "📱", gpay: "🟢", paytm: "🔵" };
const PAYMENT_METHOD_LABELS = { upi: "Any UPI App", phonepe: "PhonePe", gpay: "Google Pay", paytm: "Paytm" };

async function openRechargeModal() {
  rechargeSelected = { pkg: null, method: null, order: null, paymentData: null };
  const r = await api("/api/wallet/recharge/config");
  if (!r.success) { toast(r.message || "Could not load recharge options"); return; }
  rechargeConfig = r;
  renderRechargePackages();
  showRechargeStep("package");
  $("recharge-modal").classList.remove("hidden");
}

function closeRechargeModal() {
  $("recharge-modal").classList.add("hidden");
}

function showRechargeStep(step) {
  ["package", "method", "pay", "pending"].forEach((s) => {
    $("recharge-step-" + s).classList.toggle("hidden", s !== step);
  });
  $("recharge-step-title").textContent =
    step === "package" ? "Select Package" :
    step === "method" ? "Select Payment Method" :
    step === "pay" ? "Complete Payment" : "Recharge";
}

function renderRechargePackages() {
  const grid = $("recharge-package-grid");
  grid.innerHTML = "";
  const packages = (rechargeConfig && rechargeConfig.packages) || [];
  $("recharge-package-empty").classList.toggle("hidden", packages.length > 0);
  if (rechargeConfig.offlineRechargeOnly || rechargeConfig.onlineRechargeAllowed === false) {
    $("recharge-package-empty").classList.add("hidden");
    grid.innerHTML = `<div class="recharge-country-notice"><strong>Offline recharge only</strong><p class="hint">Online UPI recharge packages are available for India accounts only. For your country, please contact an authorized Admin / Merchant for an offline recharge.</p></div>`;
    return;
  }
  if (!rechargeConfig.settings || !rechargeConfig.settings.enabled) {
    grid.innerHTML = `<p class="hint">Online recharge is currently unavailable. Please try again later.</p>`;
    return;
  }
  packages.forEach((p) => {
    const card = document.createElement("div");
    card.className = "recharge-package-card";
    card.innerHTML = `
      <div class="price">₹${p.priceINR}</div>
      <div class="coins"><img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> ${p.totalDiamonds.toLocaleString()}</div>
      ${p.bonusDiamonds ? `<div class="bonus">+${p.bonusDiamonds.toLocaleString()} bonus</div>` : ""}
      ${p.label ? `<div class="bonus" style="color:#5aa0ff;">${escapeHtml(p.label)}</div>` : ""}
    `;
    card.addEventListener("click", () => {
      // PHASE 5 FIX: no client-generated reference anymore — the server
      // order (created on method selection below) is the only reference.
      rechargeSelected.pkg = p;
      rechargeSelected.order = null;
      rechargeSelected.paymentData = null;
      grid.querySelectorAll(".recharge-package-card.selected").forEach((el) => el.classList.remove("selected"));
      card.classList.add("selected");
      renderRechargeMethods();
      $("recharge-selected-summary").textContent = `₹${p.priceINR} → ${p.totalDiamonds.toLocaleString()} Diamonds`;
      showRechargeStep("method");
    });
    grid.appendChild(card);
  });
}

function renderRechargeMethods() {
  const wrap = $("recharge-method-list");
  wrap.innerHTML = "";
  const methods = (rechargeConfig && rechargeConfig.settings && rechargeConfig.settings.methods) || {};
  ["phonepe", "gpay", "paytm", "upi"].filter((m) => methods[m]).forEach((m) => {
    const card = document.createElement("div");
    card.className = "recharge-method-card";
    card.innerHTML = `<span class="method-icon">${PAYMENT_METHOD_ICONS[m]}</span><span>${PAYMENT_METHOD_LABELS[m]}</span>`;
    // PHASE 5 FIX (server-first order): tapping a method now creates the
    // PENDING order on the SERVER first, and only opens the UPI app once
    // that order (and its server-issued id/amount/reference) exists — the
    // deep link/QR the user actually pays against always come from that
    // authoritative order, never from anything built client-side. The
    // click is still the original user gesture (nothing awaited yet when
    // it fires), so the eventual window.location.href navigation inside
    // launchUpiApp() is still allowed to trigger the native app.
    card.addEventListener("click", () => startRechargeOrder(m));
    wrap.appendChild(card);
  });
}

// PHASE 5 FIX: replaces the old click handler that built a client-side
// ref + deep link synchronously. Now: create the order server-side ->
// fetch that order's server-computed payment data (deep link + dynamic QR,
// or null QR if 'qrcode' isn't installed server-side, in which case the
// admin's static QR image is used instead) -> render the pay step -> only
// then attempt to open the UPI app.
async function startRechargeOrder(method) {
  if (!rechargeSelected.pkg) { toast("Select a package first"); return; }
  rechargeSelected.method = method;
  const wrap = $("recharge-method-list");
  if (wrap) wrap.classList.add("loading");
  const orderRes = await api("/api/wallet/recharge/order/create", "POST", {
    packageId: rechargeSelected.pkg.id, method
  });
  if (wrap) wrap.classList.remove("loading");
  if (!orderRes.success) { toast(orderRes.message || "Could not start this recharge — try again"); return; }
  rechargeSelected.order = orderRes.transaction;

  const dataRes = await api(`/api/wallet/recharge/order/${orderRes.transaction.id}/payment-data`);
  // Payment data (deep link / dynamic QR) failing to load is NOT fatal —
  // the pay step still renders using the admin's static UPI ID/QR from
  // rechargeConfig.settings as a fallback; only the "open app"/dynamic-QR
  // convenience is lost, never the ability to pay and submit a UTR.
  rechargeSelected.paymentData = dataRes.success ? dataRes : null;

  showRechargePayStep();
  launchUpiApp();
}

function launchUpiApp() {
  const data = rechargeSelected.paymentData;
  const link = data && data.upiLink;
  if (!link) { toast("Payment link is unavailable. Please go back and create the order again."); return; }
  // Launch PhonePe directly on Android Chrome/WebView. Use only the
  // server-generated UPI payload; never reconstruct amount/reference here.
  // Keep a standards-based UPI fallback for devices where the PhonePe
  // package/deep-link handler is unavailable.
  const method = rechargeSelected.method || "upi";
  const query = link.includes("?") ? link.split("?").slice(1).join("?") : "";
  const packageByMethod = {
    phonepe: "com.phonepe.app",
    gpay: "com.google.android.apps.nbu.paisa.user",
    paytm: "net.one97.paytm"
  };
  // Convert provider-specific deep links to a standards-based UPI payload for Android intents.
  const genericLink = link.replace(/^phonepe:\/\/pay\?/i, "upi://pay?")
    .replace(/^paytmmp:\/\/pay\?/i, "upi://pay?")
    .replace(/^tez:\/\/upi\/pay\?/i, "upi://pay?");
  if (/Android/i.test(navigator.userAgent) && packageByMethod[method] && query) {
    const intent = `intent://pay?${query}#Intent;scheme=upi;package=${packageByMethod[method]};end`;
    window.location.href = intent;
    // If the chosen app is not installed / cannot handle the intent, offer the generic UPI resolver.
    window.setTimeout(() => { if (!document.hidden) window.location.href = genericLink; }, 900);
    return;
  }
  window.location.href = method === "upi" ? genericLink : link;
}

function showRechargePayStep() {
  const s = rechargeConfig.settings;
  const p = rechargeSelected.pkg;
  const pd = rechargeSelected.paymentData;
  $("recharge-pay-amount").textContent = `₹${p.priceINR}`;
  $("recharge-pay-upi").textContent = s.upiId ? "UPI ID: " + s.upiId : "";
  $("recharge-pay-name").textContent = s.receiverName ? "Receiver: " + s.receiverName : "";
  // PHASE 5 FIX: the only reference shown/quoted to the user is now the
  // server-issued order id (rechargeSelected.order.id) — never a
  // client-generated string.
  $("recharge-pay-ref").textContent = (rechargeSelected.order && rechargeSelected.order.id) || "";
  $("recharge-pay-instructions").textContent = s.instructions || "Pay the exact amount, then enter the Transaction ID / UTR from your payment app below.";
  $("btn-recharge-open-app").classList.toggle("hidden", !(pd && typeof pd.upiLink === "string" && pd.upiLink.length > 0));
  $("recharge-utr-input").value = "";
  showRechargeStep("pay");
}

$("btn-recharge-open-app")?.addEventListener("click", launchUpiApp);

$("btn-open-recharge")?.addEventListener("click", openRechargeModal);
$("btn-recharge-close")?.addEventListener("click", closeRechargeModal);
$("btn-recharge-back-to-package")?.addEventListener("click", () => showRechargeStep("package"));
$("btn-recharge-back-to-method")?.addEventListener("click", () => showRechargeStep("method"));
$("btn-recharge-done")?.addEventListener("click", () => { closeRechargeModal(); openWallet(); });

$("btn-recharge-submit")?.addEventListener("click", async () => {
  const utr = $("recharge-utr-input").value.trim();
  if (!utr || utr.length < 4) { toast("Enter a valid Transaction ID / UTR"); return; }
  // PHASE 5 FIX: the order already exists server-side (created in
  // startRechargeOrder()) — submitting now only attaches the UTR to that
  // existing PENDING order and moves it to PAYMENT_SUBMITTED. It never
  // creates a new order and never credits coins.
  if (!rechargeSelected.order) { toast("Select a package and payment method first"); return; }
  const btn = $("btn-recharge-submit");
  btn.disabled = true;
  const r = await api(`/api/wallet/recharge/order/${rechargeSelected.order.id}/submit-utr`, "POST", { utr });
  btn.disabled = false;
  if (r.success) {
    showRechargeStep("pending");
  } else {
    toast(r.message || "Could not submit — try again");
  }
});


// ===========================================================================
// TREASURE BOX
// ===========================================================================
async function openTreasure() {
  const r = await api("/api/treasure/status/" + me.userId);
  $("btn-claim-daily").disabled = !(r.success && r.dailyReady);
  $("btn-claim-weekly").disabled = !(r.success && r.weeklyReady);
  $("btn-claim-daily").textContent = (r.success && r.dailyReady) ? "Open" : "Already claimed today's";
  $("btn-claim-weekly").textContent = (r.success && r.weeklyReady) ? "Open" : "Already claimed this week's";
  showView("view-treasure");
}
$("btn-claim-daily").addEventListener("click", async () => {
  const r = await api("/api/treasure/claim-daily", "POST", {});
  if (r.success) { toast(`🎁 You got ${r.reward} Diamonds!`); me.diamonds = r.diamonds; saveSession(); fillHomeProfile(); openTreasure(); }
  else toast(r.message || "Something went wrong");
});
$("btn-claim-weekly").addEventListener("click", async () => {
  const r = await api("/api/treasure/claim-weekly", "POST", {});
  if (r.success) { toast(`🏆 You got ${r.reward} Diamonds!`); me.diamonds = r.diamonds; saveSession(); fillHomeProfile(); openTreasure(); }
  else toast(r.message || "Something went wrong");
});

// ===========================================================================
// FRAMES
// ===========================================================================
function formatFrameRemaining(expiresAt) {
  if (!expiresAt) return "Permanent";
  const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  if (!ms) return "Expired";
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  return `${d}d ${h}h ${m}m`;
}
function updateProfileFrameCountdown() {
  const el = $("profile-frame-countdown");
  if (!el) return;
  const frame = me?.activeFrame;
  if (!frame?.expiresAt) { el.classList.add("hidden"); return; }
  const remaining = formatFrameRemaining(frame.expiresAt);
  const prefix = frame?.svip ? "SVIP · " : "NEW · ";
  el.textContent = remaining === "Expired" ? "SVIP frame expired" : prefix + remaining;
  el.classList.remove("hidden");
}
let frameCountdownTimer = null;
function startFrameCountdown(expiresAt) {
  if (frameCountdownTimer) clearInterval(frameCountdownTimer);
  if (!expiresAt) return;
  const tick = () => {
    const el = $("active-frame-countdown");
    if (!el) return;
    el.textContent = "⏳ " + formatFrameRemaining(expiresAt);
    if (formatFrameRemaining(expiresAt) === "Expired") { clearInterval(frameCountdownTimer); openFrames(); }
  };
  tick();
  frameCountdownTimer = setInterval(tick, 60000);
}
async function openFrames() {
  const r = await api("/api/frames/mine/" + me.userId);
  const activeBox = $("active-frame-box");
  if (r.success && r.activeFrame) {
    me.activeFrame = r.activeFrame; saveSession();
    updateProfileFrameCountdown();
    activeBox.innerHTML = `<p class="field-label">Your Active Frame</p><p>${escapeHtml(r.activeFrame.name || r.activeFrame.frameId)}</p><p id="active-frame-countdown" class="hint frame-countdown">${r.activeFrame.expiresAt ? "⏳ " + formatFrameRemaining(r.activeFrame.expiresAt) : "Permanent"}</p><p class="hint">${r.activeFrame.expiresAt ? "Expires: " + new Date(r.activeFrame.expiresAt).toLocaleString() : "Permanent"}</p>`;
    startFrameCountdown(r.activeFrame.expiresAt);
  } else {
    if (frameCountdownTimer) { clearInterval(frameCountdownTimer); frameCountdownTimer = null; }
    if (me.activeFrame) { me.activeFrame = null; saveSession(); }
    updateProfileFrameCountdown();
    activeBox.innerHTML = `<p class="hint">You have no active frame.</p>`;
  }

  // Only frames Admin has actually assigned to THIS account — never the
  // full catalog — same "My Vehicles" inventory pattern as openVehicles().
  const wrap = $("frame-catalog-list");
  wrap.innerHTML = "";
  if (!r.success || !r.inventory || !r.inventory.length) {
    wrap.innerHTML = `<p class="hint">No Frames assigned yet.</p>`;
  } else {
    r.inventory.forEach((f) => {
      const item = document.createElement("div");
      item.className = "gift-item";
      const status = f.permanent ? "Permanent" : (f.expiresAt ? "Expires " + new Date(f.expiresAt).toLocaleDateString() : "");
      item.innerHTML = `
        ${f.imageUrl ? `<img src="${f.imageUrl}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;">` : '<span class="emoji">🖼️</span>'}
        <span class="price">${escapeHtml(f.name)}</span>
        <span class="hint">${status}${f.active ? " · Active" : ""}</span>
        <div style="display:flex;gap:6px;margin-top:6px;">
          ${f.active
            ? `<button class="btn btn-ghost btn-frame-remove" data-id="${f.id}" style="flex:1;">Remove</button>`
            : `<button class="btn btn-primary btn-frame-use" data-id="${f.id}" style="flex:1;">Use</button>`}
        </div>
      `;
      wrap.appendChild(item);
    });
  }

  showView("view-frames");
}

$("frame-catalog-list").addEventListener("click", async (e) => {
  const useBtn = e.target.closest(".btn-frame-use");
  if (useBtn) {
    const r = await api("/api/frames/use", "POST", { frameId: useBtn.dataset.id });
    if (r.success) openFrames(); else toast(r.message || "Failed", true);
    return;
  }
  const removeBtn = e.target.closest(".btn-frame-remove");
  if (removeBtn) {
    const r = await api("/api/frames/deactivate", "POST", {});
    if (r.success) openFrames(); else toast(r.message || "Failed", true);
  }
});

// ===========================================================================
// VEHICLE ENTRY SYSTEM (Add-on) — My Vehicles / Customize
// ===========================================================================
async function openVehicles() {
  const r = await api("/api/vehicles/mine/" + me.userId);
  const wrap = $("vehicle-list");
  const empty = $("vehicle-list-empty");
  wrap.innerHTML = "";
  if (!r.success || !r.inventory.length) {
    empty.classList.remove("hidden");
  } else {
    empty.classList.add("hidden");
    r.inventory.forEach((v) => {
      const item = document.createElement("div");
      item.className = "gift-item";
      const status = v.permanent ? "Permanent" : (v.expiresAt ? "Expires " + new Date(v.expiresAt).toLocaleDateString() : "");
      item.innerHTML = `
        ${v.thumbnailUrl ? `<img src="${v.thumbnailUrl}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;">` : "<span class=\"emoji\">🚗</span>"}
        <span class="price">${escapeHtml(v.name)}</span>
        <span class="hint">${status}${v.active ? " · Active" : ""}</span>
        <div style="display:flex;gap:6px;margin-top:6px;">
          ${v.active
            ? `<button class="btn btn-ghost btn-vehicle-remove" data-id="${v.id}" style="flex:1;">Remove</button>`
            : `<button class="btn btn-primary btn-vehicle-use" data-id="${v.id}" style="flex:1;">Use</button>`}
        </div>
      `;
      wrap.appendChild(item);
    });
  }
  showView("view-vehicles");
}

$("vehicle-list").addEventListener("click", async (e) => {
  const useBtn = e.target.closest(".btn-vehicle-use");
  if (useBtn) {
    const r = await api("/api/vehicles/use", "POST", { vehicleId: useBtn.dataset.id });
    if (r.success) openVehicles(); else toast(r.message || "Failed", true);
    return;
  }
  const removeBtn = e.target.closest(".btn-vehicle-remove");
  if (removeBtn) {
    const r = await api("/api/vehicles/deactivate", "POST", {});
    if (r.success) openVehicles(); else toast(r.message || "Failed", true);
  }
});

$("btn-shop-vehicles").addEventListener("click", () => openVehicles());

// ===========================================================================
// DIAMOND CENTER — assigned seller/reseller UI
// ===========================================================================
async function openDiamondCenter() {
  const body = $("dc-user-body");
  body.innerHTML = `<div class="dc-loading">Loading Diamond Center…</div>`;
  const r = await api("/api/diamond-center/me");
  if (!r.success || !r.center) {
    body.innerHTML = `<div class="dc-empty"><div class="dc-empty-icon">💎</div><h3>Diamond Center unavailable</h3><p>${escapeHtml(r.message || "This account is not assigned a Diamond Center.")}</p></div>`;
    showView("view-diamond-center");
    return;
  }
  renderDiamondCenter(r.center, r.history || []);
  showView("view-diamond-center");
}

function renderDiamondCenter(c, history) {
  const body = $("dc-user-body");
  const packages = (c.packages || []).filter(p => p && p.active !== false);
  const packageOptions = packages.map(p =>
    `<button class="dc-package" data-pkg="${escapeHtml(p.id)}" data-price="${Number(p.priceINR)}"><strong>₹${Number(p.priceINR).toLocaleString()}</strong><span>${Number(p.diamonds).toLocaleString()} 🪙</span>${p.label ? `<small>${escapeHtml(p.label)}</small>` : ""}</button>`
  ).join("");
  const historyHtml = history.length ? history.map(t => `
    <div class="dc-history-row">
      <div><b>${escapeHtml(t.targetUserId || "Center Top-up")}</b><small>${new Date(t.time).toLocaleString()}</small></div>
      <div class="dc-history-amount">${t.type === "center_topup" ? "+" : "-"}${Number(t.type === "center_topup" ? t.diamonds : t.totalDiamonds).toLocaleString()} 💎<small>${t.type === "recharge" ? `₹${Number(t.priceINR).toLocaleString()} · +${Number(t.bonusDiamonds || 0).toLocaleString()} bonus` : "Center inventory top-up"}</small></div>
    </div>`).join("") : `<div class="dc-history-empty">No recharge activity yet.</div>`;

  body.innerHTML = `
    <div class="dc-shell">
      <div class="dc-hero">
        <div class="dc-hero-glow"></div>
        <div class="dc-avatar">${c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="">` : "💎"}</div>
        <div class="dc-hero-copy"><span class="dc-kicker">DIAMOND BALANCE</span><h1>${Number(c.balanceDiamonds).toLocaleString()} 💎</h1><p>${escapeHtml(c.userName)} · ID ${escapeHtml(c.userId)}</p></div>
      </div>

      <div class="dc-stats">
        <div><span>Bonus</span><b>+${Number(c.bonusPercent || 0)}%</b></div>
        <div><span>Recharges</span><b>${Number(c.totalRechargeCount || 0).toLocaleString()}</b></div>
        <div><span>Distributed</span><b>${Number(c.totalDiamondsDistributed || 0).toLocaleString()} 💎</b></div>
      </div>

      <div class="dc-card">
        <div class="dc-title"><div><span class="dc-kicker">DIAMOND DELIVERY</span><h2>Recharge User ID</h2></div><span class="dc-live">● LIVE</span></div>
        <label class="dc-label">Target User ID</label>
        <input id="dc-target-user" class="dc-input" type="text" placeholder="Enter User ID to recharge" autocomplete="off">
        <label class="dc-label">Recharge Amount (₹)</label>
        <input id="dc-price" class="dc-input" type="number" min="1" step="1" inputmode="numeric" placeholder="Example: 300">
        <label class="dc-label">Or choose a recharge package</label>
        <div class="dc-packages">${packageOptions || `<p>No recharge packages configured.</p>`}</div>
        <div class="dc-summary" id="dc-summary">Enter an amount or select a package to preview the Diamond delivery.</div>
        <button id="dc-send-btn" class="dc-send-btn" disabled>Send Diamonds</button>
        <p class="dc-note">Any whole-rupee amount is supported. The Party rate is ₹1 = 10,000 Coins (₹100 = 1,000,000 Coins). Your own User ID can also be recharged from Center inventory.</p>
      </div>

      <div class="dc-card">
        <div class="dc-title"><div><span class="dc-kicker">LEDGER</span><h2>Recharge History</h2></div></div>
        <div class="dc-history">${historyHtml}</div>
      </div>
    </div>`;

  let selected = null;
  const priceInput = $("dc-price");
  const sendBtn = $("dc-send-btn");
  const summary = $("dc-summary");

  function selectPackage(pkg) {
    selected = pkg || null;
    body.querySelectorAll(".dc-package").forEach(x => x.classList.toggle("selected", !!selected && x.dataset.pkg === selected.id));
    if (!selected) {
      summary.textContent = "Enter an amount or select a package to preview the Diamond delivery.";
      sendBtn.disabled = true;
      return;
    }
    priceInput.value = Number(selected.priceINR);
    const bonus = Math.floor(Number(selected.diamonds) * Number(c.bonusPercent || 0) / 100);
    summary.innerHTML = `₹${Number(selected.priceINR).toLocaleString()} → <b>${(Number(selected.diamonds) + bonus).toLocaleString()} 💎</b> <span>(+${bonus.toLocaleString()} bonus)</span>`;
    sendBtn.disabled = false;
  }

  function resolveByAmount() {
    const amount = Math.floor(Number(priceInput.value));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      selected = null;
      body.querySelectorAll(".dc-package").forEach(x => x.classList.remove("selected"));
      summary.textContent = "Enter an amount to preview the Diamond delivery.";
      sendBtn.disabled = true;
      return;
    }
    const pkg = packages.find(p => Math.floor(Number(p.priceINR)) === amount) || null;
    selected = pkg;
    body.querySelectorAll(".dc-package").forEach(x => x.classList.toggle("selected", !!pkg && x.dataset.pkg === pkg.id));
    const base = packages.find(p => Math.floor(Number(p.priceINR)) === 300) ||
      packages.slice().sort((a,b) => Number(a.priceINR) - Number(b.priceINR))[0];
    if (!base) {
      summary.textContent = "No recharge rate is configured.";
      sendBtn.disabled = true;
      return;
    }
    const basePrice = Math.floor(Number(base.priceINR));
    const baseDiamonds = Math.floor(Number(base.diamonds));
    const diamonds = pkg ? Math.floor(Number(pkg.diamonds)) : Math.floor((amount * baseDiamonds) / basePrice);
    const bonus = Math.floor(diamonds * Number(c.bonusPercent || 0) / 100);
    summary.innerHTML = `₹${amount.toLocaleString()} → <b>${(diamonds + bonus).toLocaleString()} 💎</b> <span>${pkg ? `(${escapeHtml(pkg.label || "configured package")})` : `(custom rate: ${baseDiamonds.toLocaleString()} 💎 / ₹${basePrice.toLocaleString()})`}</span>`;
    sendBtn.disabled = diamonds <= 0;
  }

  body.querySelectorAll(".dc-package").forEach(btn => btn.onclick = () => {
    selectPackage(packages.find(p => p.id === btn.dataset.pkg) || null);
  });
  priceInput.oninput = resolveByAmount;

  sendBtn.onclick = async () => {
    const targetUserId = $("dc-target-user").value.trim();
    const priceINR = Math.floor(Number(priceInput.value));
    if (!targetUserId || !Number.isSafeInteger(priceINR) || priceINR <= 0) {
      toast("Enter a valid User ID and recharge amount", true); return;
    }
    if (!confirm(`Send ₹${Number(priceINR).toLocaleString()} recharge to ${targetUserId}?`)) return;
    sendBtn.disabled = true; sendBtn.textContent = "Processing…";
    try {
      const rr = await api("/api/diamond-center/recharge", "POST", {
        targetUserId,
        priceINR,
        packageId: selected && Number(priceINR) === Number(selected.priceINR) ? selected.id : null
      });
      if (rr.success) { toast(`${Number(rr.transaction.totalDiamonds).toLocaleString()} Coins sent`); openDiamondCenter(); }
      else { toast(rr.message || "Recharge failed", true); sendBtn.disabled = false; sendBtn.textContent = "Send Diamonds"; }
    } catch (e) {
      console.error("[DIAMOND CENTER] recharge error", e);
      toast("Recharge failed. Please try again.", true);
      sendBtn.disabled = false; sendBtn.textContent = "Send Diamonds";
    }
  };
}
// ===========================================================================
// MERCHANT CENTER — Merchant / Seller user dashboard
// ===========================================================================
async function openMerchantCenter() {
  const body = $("mc-user-body");
  if (!body) return;
  body.innerHTML = `<div class="mc-loading">Loading Merchant Center…</div>`;
  const r = await api("/api/merchant-center/me");
  if (!r.success) {
    body.innerHTML = `<div class="mc-empty"><img src="/images/icons/merchant-center.png" alt=""><h3>Merchant Center unavailable</h3><p>${escapeHtml(r.message || "This account is not assigned a Merchant Center.")}</p></div>`;
    showView("view-merchant-center");
    return;
  }
  renderMerchantCenter(r);
  showView("view-merchant-center");
}

function renderMerchantCenter(data) {
  const body = $("mc-user-body");
  const m = data.merchant || {};
  const isOwner = data.role === "merchant";
  const wallet = isOwner ? m.balanceDiamonds : (data.seller ? data.seller.balanceDiamonds : 0);
  const sellers = data.sellers || [];
  const history = data.history || [];
  const sellerCards = sellers.map(s => `
    <div class="mc-seller-card" data-seller-user="${escapeHtml(s.userId)}">
      <div class="mc-seller-avatar">${s.avatar ? `<img src="${escapeHtml(s.avatar)}" alt="">` : "💎"}</div>
      <div class="mc-seller-copy"><b>${escapeHtml(s.userName)}</b><span>${escapeHtml(s.userId)}</span></div>
      <div class="mc-seller-actions">
        <div class="mc-seller-balance">${Number(s.balanceDiamonds||0).toLocaleString()} 💎</div>
        ${isOwner ? `<div class="mc-inline-form"><input class="mc-input mc-seller-topup-input" data-seller="${escapeHtml(s.sellerId)}" type="number" min="1" step="1" inputmode="numeric" placeholder="Amount ₹"><button class="mc-mini-btn mc-seller-topup-btn" data-seller="${escapeHtml(s.sellerId)}" type="button">Top Up Seller</button></div>` : ""}
      </div>
    </div>`).join("");

  const historyHtml = history.length ? history.slice(0,100).map(x => `
    <div class="mc-history-row">
      <div><b>${escapeHtml(x.type || "transaction")}</b><small>${new Date(x.time).toLocaleString()} · ${escapeHtml(x.sellerUserId || m.userId || "")} → ${escapeHtml(x.targetUserId || "-")}</small></div>
      <strong>${Number(x.diamonds || 0).toLocaleString()} ${Number(x.diamonds||0) ? "💎" : ""}</strong>
    </div>`).join("") : `<div class="mc-empty-inline">No Merchant transactions yet.</div>`;

  body.innerHTML = `
    <div class="mc-shell">
      <div class="mc-hero">
        <div class="mc-hero-glow"></div>
        <div class="mc-icon"><img src="/images/icons/merchant-center.png" alt=""></div>
        <div class="mc-hero-copy">
          <span class="mc-kicker">${isOwner ? "MERCHANT CENTER" : "SELLER CENTER"}</span>
          <h1>${Number(wallet).toLocaleString()} 💎</h1>
          <p>${escapeHtml(m.userName || data.seller?.userName || "")} · ID ${escapeHtml(isOwner ? (m.userId || "") : (data.seller?.userId || ""))}</p>
        </div>
        <span class="mc-status">${m.status === "active" ? "● ACTIVE" : "● " + escapeHtml(m.status || "ACTIVE")}</span>
      </div>

      <div class="mc-stats">
        <div><span>Seller Network</span><b>${Number(m.sellerCount||0)}/${Number(m.maxSellers||10)}</b></div>
        <div><span>Merchant Balance</span><b>${Number(m.balanceDiamonds||0).toLocaleString()} 💎</b></div>
        <div><span>Total Sold</span><b>${Number(m.totalDiamondsSold||0).toLocaleString()} 💎</b></div>
        <div><span>To Sellers</span><b>${Number(m.totalDiamondsToSellers||0).toLocaleString()} 💎</b></div>
      </div>

      <div class="mc-card">
        <div class="mc-card-head"><div><span class="mc-kicker">DIAMOND DELIVERY</span><h2>Sell Diamonds to User</h2></div><span class="mc-live">● SECURE</span></div>
        <label class="mc-label">Target User ID</label>
        <input id="mc-target-user" class="mc-input" type="text" placeholder="Enter User ID" autocomplete="off">
        <label class="mc-label">Diamond Amount</label>
        <input id="mc-sale-amount" class="mc-input" type="number" min="1" step="1" inputmode="numeric" placeholder="Enter Diamonds">
        <div class="mc-sale-summary" id="mc-sale-summary">Your available balance: ${Number(wallet).toLocaleString()} 💎</div>
        <button id="mc-sell-btn" class="mc-send-btn">Send Diamonds</button>
      </div>

      ${isOwner ? `<div class="mc-card">
        <div class="mc-card-head"><div><span class="mc-kicker">SELLER MANAGEMENT</span><h2>Create Seller</h2></div><span>${sellers.length}/10</span></div>
        <p class="mc-help">Create a Seller using an existing User ID. The Seller receives the Seller tag automatically.</p>
        <div class="mc-inline-form mc-create-seller-form">
          <input id="mc-new-seller-userid" class="mc-input" type="text" placeholder="Seller User ID" autocomplete="off">
          <button id="mc-create-seller-btn" class="mc-send-btn" type="button">Create Seller</button>
        </div>
      </div>` : ""}

      ${isOwner ? `<div class="mc-card">
        <div class="mc-card-head"><div><span class="mc-kicker">ACCOUNT CONTROL</span><h2>User Unban</h2></div><span class="mc-live">10 / MONTH</span></div>
        <p class="mc-help">You can unban up to 10 User IDs per calendar month. Unbanning a user does not add Diamonds.</p>
        <div class="mc-unban-quota" id="mc-unban-quota">Checking monthly quota…</div>
        <label class="mc-label">Banned User ID</label>
        <input id="mc-unban-userid" class="mc-input" type="text" placeholder="Enter banned User ID" autocomplete="off">
        <button id="mc-unban-btn" class="mc-send-btn" type="button">Unban User ID</button>
      </div>` : ""}

      ${isOwner ? `<div class="mc-card">
        <div class="mc-card-head"><div><span class="mc-kicker">SELLER NETWORK</span><h2>Your Sellers</h2></div><span>${sellers.length}/10</span></div>
        <div class="mc-seller-list">${sellerCards || `<div class="mc-empty-inline">No sellers assigned yet.</div>`}</div>
      </div>` : ""}

      <div class="mc-card">
        <div class="mc-card-head"><div><span class="mc-kicker">LEDGER</span><h2>Complete Transaction History</h2></div></div>
        <div class="mc-history">${historyHtml}</div>
      </div>
    </div>`;

  const btn = $("mc-sell-btn");
  const amount = $("mc-sale-amount");
  const summary = $("mc-sale-summary");
  amount.oninput = () => {
    const inr = Math.floor(Number(amount.value));
    const diamonds = Number.isSafeInteger(inr) && inr > 0 ? Math.floor(inr * 10000) : 0;
    summary.textContent = diamonds > 0
      ? `₹${inr.toLocaleString()} = ${diamonds.toLocaleString()} 💎 · Remaining ${Math.max(0, Number(wallet)-diamonds).toLocaleString()} 💎`
      : `Rate: ₹1 = 10,000 Coins · Available ${Number(wallet).toLocaleString()} 💎`;
  };
  btn.onclick = async () => {
    const targetUserId = $("mc-target-user").value.trim();
    const priceINR = Math.floor(Number(amount.value));
    const diamonds = Number.isSafeInteger(priceINR) && priceINR > 0 ? Math.floor(priceINR * 10000) : 0;
    if (!targetUserId || !Number.isSafeInteger(priceINR) || priceINR <= 0) { toast("Enter a valid User ID and INR amount", true); return; }
    if (!Number.isSafeInteger(diamonds) || diamonds <= 0) { toast("Amount is too small for the Diamond rate", true); return; }
    if (diamonds > Number(wallet)) { toast("Insufficient Merchant/Seller balance", true); return; }
    if (!confirm(`Recharge ₹${priceINR.toLocaleString()} to ${targetUserId} (${diamonds.toLocaleString()} Diamonds)?`)) return;
    btn.disabled = true; btn.textContent = "Processing…";
    const rr = await api("/api/merchant-center/sell", "POST", { targetUserId, priceINR });
    if (rr.success) { toast(`₹${priceINR.toLocaleString()} recharge completed · ${Number(rr.transaction.diamonds).toLocaleString()} Coins sent`); openMerchantCenter(); }
    else { toast(rr.message || "Recharge failed", true); btn.disabled = false; btn.textContent = "Recharge User"; }
  };

  if (isOwner) {
    $("mc-create-seller-btn")?.addEventListener("click", async () => {
      const userId = $("mc-new-seller-userid").value.trim();
      if (!userId) { toast("Enter Seller User ID", true); return; }
      const b = $("mc-create-seller-btn"); b.disabled = true; b.textContent = "Creating…";
      const rr = await api("/api/merchant-center/sellers", "POST", { userId });
      if (rr.success) { toast("Seller created successfully"); openMerchantCenter(); }
      else { toast(rr.message || "Could not create Seller", true); b.disabled = false; b.textContent = "Create Seller"; }
    });

    document.querySelectorAll(".mc-seller-topup-btn").forEach(btn => btn.addEventListener("click", async () => {
      const sellerId = btn.dataset.seller;
      const input = document.querySelector(`.mc-seller-topup-input[data-seller="${CSS.escape(sellerId)}"]`);
      const amountINR = Math.floor(Number(input?.value));
      const diamonds = Number.isSafeInteger(amountINR) && amountINR > 0 ? Math.floor(amountINR * 10000) : 0;
      if (!Number.isSafeInteger(amountINR) || amountINR <= 0 || diamonds <= 0) { toast("Enter a valid INR amount", true); return; }
      if (diamonds > Number(m.balanceDiamonds || 0)) { toast("Merchant balance is insufficient", true); return; }
      btn.disabled = true; btn.textContent = "…";
      const rr = await api(`/api/merchant-center/sellers/${encodeURIComponent(sellerId)}/topup`, "POST", { amountINR });
      if (rr.success) { toast(`₹${amountINR.toLocaleString()} transferred · ${Number(rr.diamonds).toLocaleString()} Coins to Seller`); openMerchantCenter(); }
      else { toast(rr.message || "Seller top-up failed", true); btn.disabled = false; btn.textContent = "Top Up"; }
    }));

    const quota = $("mc-unban-quota");
    api("/api/merchant-center/unban-status").then(rr => {
      if (rr.success) quota.textContent = `${rr.unbanRemaining} of ${rr.unbanLimit} unban IDs remaining this month · ${rr.month}`;
      else quota.textContent = rr.message || "Quota unavailable";
    });
    $("mc-unban-btn")?.addEventListener("click", async () => {
      const targetUserId = $("mc-unban-userid").value.trim();
      if (!targetUserId) { toast("Enter a User ID", true); return; }
      if (!confirm(`Unban User ID ${targetUserId}?`)) return;
      const b = $("mc-unban-btn"); b.disabled = true; b.textContent = "Processing…";
      const rr = await api("/api/merchant-center/unban", "POST", { targetUserId });
      if (rr.success) { toast(`User ${rr.targetUserId} unbanned · ${rr.unbanRemaining} remaining this month`); openMerchantCenter(); }
      else { toast(rr.message || "Unban failed", true); b.disabled = false; b.textContent = "Unban User ID"; }
    });
  }
}

// ===========================================================================
// AGENCY CENTER
// ===========================================================================
let currentAgencyId = null;
async function openAgency() {
  const r = await api("/api/agency/mine/" + me.userId);
  const body = $("agency-body");
  if (!r.success || !r.agency) {
    currentAgencyId = null;
    body.innerHTML = `<div class="empty-state"><p>You don't have an Agency.</p></div>`;
    showView("view-agency");
    return;
  }
  currentAgencyId = r.agency.agencyId;
  if (!r.agency.isOwner) {
    // Host viewing their own agency membership — full stats live in Host Center.
    body.innerHTML = `
      <div class="auth-card">
        <h3>${escapeHtml(r.agency.name)}</h3>
        <p class="hint">Commission rate: ${(r.agency.commissionRate * 100).toFixed(0)}%</p>
        <p class="hint">You'll see full gift stats in your Host Center.</p>
      </div>`;
    showView("view-agency");
    return;
  }
  await renderAgencyDashboard();
  showView("view-agency");
}
function agencyIcon(type) {
  const paths = {
    hosts:'<path d="M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-1a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.8 19a5.2 5.2 0 0 1 10.4 0M13.2 18.2a4.2 4.2 0 0 1 8 0"/>' ,
    applications:'<path d="m5 12 4 4L19 6"/><path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"/>',
    report:'<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h6M9 16h6"/>',
    reward:'<path d="M12 3 14.8 8.7 21 9.6l-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    invite:'<path d="M15 20v-1.5A4.5 4.5 0 0 0 10.5 14h-1A4.5 4.5 0 0 0 5 18.5V20"/><circle cx="10" cy="8" r="3"/><path d="M18 8v6M15 11h6"/>',
    policy:'<path d="M12 3 19 6v5c0 4.5-3 7.4-7 10-4-2.6-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
    subagencies:'<rect x="3" y="4" width="7" height="5" rx="1"/><rect x="14" y="4" width="7" height="5" rx="1"/><rect x="8.5" y="15" width="7" height="5" rx="1"/><path d="M6.5 9v3h11V9M12 12v3"/>',
    settlements:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    hostdata:'<path d="M5 19V9M12 19V5M19 19v-8"/><path d="M3 19h18"/>'
  };
  return `<svg class="agency-feature-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[type] || paths.report}</svg>`;
}

async function renderAgencyDashboard() {
  if (!currentAgencyId) return;
  const r = await api(`/api/agency/dashboard/${currentAgencyId}?ownerUserId=${me.userId}`);
  const body = $("agency-body");
  if (!r.success) { body.innerHTML = `<div class="empty-state"><p>${escapeHtml(r.message || "Could not load")}</p></div>`; return; }
  const a = r.agency, t = r.totals, m = r.management || {};
  const level = a.level || { key:"B", label:"Level B", next:4000000 };
  const monthly = Number(t.monthlyDiamonds || 0);
  const levelFloor = level.key === "B" ? 0 : level.key === "A" ? 4000000 : level.key === "A+" ? 10000000 : 20000000;
  const levelProgress = Math.max(0, Math.min(100, Math.floor(((monthly - levelFloor) / Math.max(1, level.next - levelFloor)) * 100)));
  const target = Number(a.weeklyTargetValue || 0), weeklyPct = Number(a.weeklyAchievementPercent || 0);
  let html = `
    <div class="agency-premium-shell">
      <div class="agency-hero-card">
        <div class="agency-hero-top">
          <button class="agency-back-mini" type="button" data-back="view-profile">‹</button>
          <div class="agency-hero-avatar" id="agency-logo-click" title="Change Agency logo">
            ${a.logo ? `<img src="${escapeHtml(a.logo)}" alt="">` : `<span>♛</span>`}
            <i>✦</i>
          </div>
          <div class="agency-hero-copy">
            <div class="agency-name-line"><h1>${escapeHtml(a.name)}</h1><span class="agency-level-badge">${escapeHtml(level.key)}</span></div>
            <div class="agency-id-line">ID: ${escapeHtml(a.agencyId)}</div>
          </div>
          <button class="agency-gear" id="agency-policy-btn" type="button" aria-label="Agency policy">⚙</button>
        </div>
        <div class="agency-meta-row"><span>Commission: ${(Number(a.commissionRate || 0) * 100).toFixed(0)}%</span><span>Official Handler: ${escapeHtml(a.officialName || "Not assigned")}</span><span class="agency-live-dot">● LIVE</span></div>
        <div class="agency-level-row"><strong>Agency ${escapeHtml(level.label)}</strong><span>${monthly.toLocaleString()} / ${Number(level.next).toLocaleString()}</span></div>
        <div class="agency-progress"><span style="width:${levelProgress}%"></span></div>
        <div class="agency-level-foot"><span>${levelProgress}% progress</span><span>${Math.max(0, Number(level.next)-monthly).toLocaleString()} to next level</span></div>
      </div>
      <input type="file" id="agency-logo-input" class="hidden" accept="image/*">

      <div class="agency-stat-grid">
        <button class="agency-stat-card" data-agency-panel="hosts"><span class="agency-stat-icon">♧</span><span class="agency-stat-label">Total Hosts</span><strong>${Number(t.totalHosts || 0).toLocaleString()}</strong></button>
        <button class="agency-stat-card" data-agency-panel="hosts"><span class="agency-stat-icon">◉</span><span class="agency-stat-label">Active Hosts</span><strong>${Number(t.activeHosts || 0).toLocaleString()}</strong></button>
        <button class="agency-stat-card" data-agency-panel="report"><span class="agency-stat-icon">🎁</span><span class="agency-stat-label">Daily Gifts</span><strong>${Number(t.dailyGifts || 0).toLocaleString()}</strong><small>Today</small></button>
        <button class="agency-stat-card" data-agency-panel="report"><span class="agency-stat-icon">◇</span><span class="agency-stat-label">Monthly Gifting</span><strong>${Number(t.monthlyGifts || 0).toLocaleString()}</strong><small>${monthly.toLocaleString()} 💎 confirmed</small></button>
      </div>

      <div class="agency-management-card">
        <div class="agency-section-title"><h2>Agency Management</h2><span>LIVE</span></div>
        <div class="agency-feature-grid">
          <button data-agency-panel="hosts">${agencyIcon("hosts")}<span>Host Management</span></button>
          <button data-agency-panel="applications">${agencyIcon("applications")}<span>Application Review</span>${m.pendingApplications ? `<em>${m.pendingApplications}</em>` : ""}</button>
          <button data-agency-panel="report">${agencyIcon("report")}<span>Agency Report</span></button>
          <button data-agency-panel="rewards">${agencyIcon("reward")}<span>Agency Reward</span></button>
          <button data-agency-panel="invite">${agencyIcon("invite")}<span>Invite</span></button>
          <button data-agency-panel="policy">${agencyIcon("policy")}<span>Policy</span></button>
          <button data-agency-panel="settlements">${agencyIcon("settlements")}<span>Settlement History</span></button>
          <button data-agency-panel="hostdata">${agencyIcon("hostdata")}<span>Host Data</span></button>
        </div>
      </div>

      <div class="agency-commission-card">
        <div class="agency-commission-head"><div><span>This Week Target</span><strong>${target.toLocaleString()} <small>💎</small></strong></div><b>${weeklyPct}%</b></div>
        <div class="agency-progress"><span style="width:${weeklyPct}%"></span></div>
        <div class="agency-commission-foot"><span>Confirmed: ${Number((a.weeklyAchievementDiamonds || 0)).toLocaleString()} 🪙</span><button data-agency-panel="policy">Manage target ›</button></div>
      </div>

      <div class="agency-ranking-card">
        <div class="agency-section-title"><h2>Host Ranking</h2><button data-agency-panel="hosts">See All ›</button></div>
        ${(r.hosts || []).slice().sort((x,y) => Number(y.monthlyDiamonds||0)-Number(x.monthlyDiamonds||0)).slice(0,3).map((h,i)=>`
          <div class="agency-rank-row"><span class="agency-rank-medal">${i===0?'🥇':i===1?'🥈':'🥉'}</span><div class="agency-rank-avatar">${h.photo ? `<img src="${escapeHtml(h.photo)}" alt="">` : escapeHtml((h.name||'U').charAt(0).toUpperCase())}</div><div class="agency-rank-info"><strong>${escapeHtml(h.name)}</strong><small>#${escapeHtml(h.userId)} · ${h.online ? 'Active now' : 'Offline'}</small></div><b>${Number(h.monthlyDiamonds||0).toLocaleString()} 💎</b></div>`).join('') || `<div class="agency-empty-inline">No hosts yet. Invite your first host.</div>`}
      </div>
    </div>`;
  body.innerHTML = html;
  $("agency-logo-click").addEventListener("click", () => $("agency-logo-input").click());
  $("agency-logo-input").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append("logo", file);
    const up = await apiUpload("/api/room/logo/upload", fd);
    if (!up.success) { toast(up.message || "Upload failed"); return; }
    const rr = await api("/api/agency/logo", "POST", { agencyId: currentAgencyId, logoUrl: up.url });
    if (rr.success) { toast("Agency logo updated"); renderAgencyDashboard(); } else toast(rr.message || "Update failed");
  });
  document.querySelectorAll("[data-agency-panel]").forEach(btn => btn.addEventListener("click", () => openAgencyPanel(btn.dataset.agencyPanel)));
  $("agency-policy-btn").addEventListener("click", () => openAgencyPanel("policy"));
  const back = body.querySelector(".agency-back-mini"); if (back) back.addEventListener("click", () => showView("view-profile"));
}

async function openAgencyPanel(panel) {
  const body = $("agency-body");
  const close = () => renderAgencyDashboard();
  if (panel === "invite") {
    body.innerHTML = `<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Invite a Host</h2></div><div class="agency-invite-premium"><span>♛</span><h3>Invite a new Host</h3><p>Enter the User ID of the Host you want to bring into your Agency.</p><div class="agency-invite-row"><input id="agency-invite-input" class="field-solo" placeholder="Enter User ID"><button id="btn-agency-invite-send" class="btn btn-primary">Invite</button></div></div></div>`;
    $("agency-panel-close").onclick=close; $("btn-agency-invite-send").onclick=sendAgencyInvite; return;
  }
  if (panel === "hosts") {
    const r = await api(`/api/agency/dashboard/${currentAgencyId}?ownerUserId=${me.userId}`);
    body.innerHTML = `<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Host Management</h2><span>${r.success ? r.hosts.length : 0} hosts</span></div><div class="agency-panel-list">${r.success && r.hosts.length ? r.hosts.map(h=>`<div class="agency-manage-row"><div class="agency-manage-avatar">${h.photo?`<img src="${escapeHtml(h.photo)}" alt="">`:escapeHtml((h.name||'U')[0])}</div><div><strong>${escapeHtml(h.name)}</strong><small>ID: ${escapeHtml(h.userId)} · ${h.online?'Active now':'Offline'}<br>${Number(h.monthlyDiamonds||0).toLocaleString()} 💎 this month</small></div><button class="btn btn-ghost btn-sm" data-remove-host="${escapeHtml(h.userId)}">Remove</button></div>`).join(''):`<div class="agency-empty-state">No hosts yet.</div>`}</div></div>`;
    $("agency-panel-close").onclick=close;
    body.querySelectorAll("[data-remove-host]").forEach(b=>b.onclick=async()=>{if(!confirm("Remove this Host from the Agency?"))return;const rr=await api("/api/agency/hosts/remove","POST",{agencyId:currentAgencyId,hostUserId:b.dataset.removeHost});toast(rr.success?"Host removed":(rr.message||"Could not remove"));if(rr.success)openAgencyPanel("hosts");}); return;
  }
  if (panel === "hostdata") {
    const r = await api(`/api/agency/dashboard/${currentAgencyId}?ownerUserId=${me.userId}`);
    const hosts = r.success ? (r.hosts || []) : [];
    const render = (period) => {
      const key = period === "daily" ? "daily" : period === "weekly" ? "weekly" : "monthly";
      return hosts.map(h => {
        const count = Number(h[key+"Gifts"] || 0), diamonds = Number(h[key+"Diamonds"] || 0);
        const joined = h.joinedAt ? new Date(h.joinedAt).toLocaleDateString() : "—";
        return `<div class="agency-hostdata-row"><div class="agency-hostdata-id">${escapeHtml(h.userId)}</div><div class="agency-hostdata-name"><b>${escapeHtml(h.name)}</b><small>Joined: ${escapeHtml(joined)}</small></div><div class="agency-hostdata-value"><b>${count.toLocaleString()}</b><small>Gifts</small></div><div class="agency-hostdata-value"><b>${diamonds.toLocaleString()} 💎</b><small>${period[0].toUpperCase()+period.slice(1)} Diamonds</small></div><span class="agency-online-pill ${h.online?'on':''}">${h.online?'ONLINE':'OFFLINE'}</span></div>`;
      }).join("") || `<div class="agency-empty-state"><b>${agencyIcon("hostdata")}</b><p>No host data available.</p></div>`;
    };
    body.innerHTML = `<div class="agency-panel agency-hostdata-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Host Data</h2><span>${hosts.length} hosts</span></div><div class="agency-period-tabs"><button class="active" data-host-period="daily">Daily</button><button data-host-period="weekly">Weekly</button><button data-host-period="monthly">Monthly</button></div><div class="agency-hostdata-head"><span>Host ID</span><span>Name</span><span>Gifts</span><span>Diamonds</span><span>Status</span></div><div id="agency-hostdata-list">${render("daily")}</div></div>`;
    $("agency-panel-close").onclick=close;
    body.querySelectorAll("[data-host-period]").forEach(btn=>btn.onclick=()=>{body.querySelectorAll("[data-host-period]").forEach(x=>x.classList.remove("active"));btn.classList.add("active");$("agency-hostdata-list").innerHTML=render(btn.dataset.hostPeriod);});
    return;
  }
  if (panel === "applications") {
    const r = await api(`/api/agency/applications/${currentAgencyId}`);
    body.innerHTML = `<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Application Review</h2></div><div class="agency-panel-list">${r.success&&r.applications.length?r.applications.map(x=>`<div class="agency-manage-row"><div class="agency-manage-avatar">${x.photo?`<img src="${escapeHtml(x.photo)}" alt="">`:escapeHtml((x.name||'U')[0])}</div><div><strong>${escapeHtml(x.name)}</strong><small>User ID: ${escapeHtml(x.userId)}<br>${new Date(x.createdAt).toLocaleString()}</small></div><button class="btn btn-primary btn-sm" data-app-action="accept" data-app-id="${escapeHtml(x.applicationId)}">Accept</button><button class="btn btn-ghost btn-sm" data-app-action="reject" data-app-id="${escapeHtml(x.applicationId)}">Reject</button></div>`).join(''):`<div class="agency-empty-state"><b>✓</b><p>No pending applications.</p></div>`}</div></div>`;
    $("agency-panel-close").onclick=close;
    body.querySelectorAll("[data-app-action]").forEach(b=>b.onclick=async()=>{const rr=await api(`/api/agency/applications/${encodeURIComponent(b.dataset.appId)}/respond`,`POST`,{action:b.dataset.appAction});toast(rr.success?`Application ${b.dataset.appAction}ed`:rr.message||"Action failed");if(rr.success)openAgencyPanel("applications");}); return;
  }
  if (panel === "report") {
    const r = await api(`/api/agency/report/${currentAgencyId}`);
    if(!r.success){toast(r.message||"Report unavailable");return;}
    const s=r.stats||{}; body.innerHTML=`<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Agency Report</h2><button id="agency-print-report" class="btn btn-primary btn-sm">Print / PDF</button></div><div id="agency-report-content" class="agency-report"><div class="agency-report-cover"><span>♛</span><h1>${escapeHtml(r.agency.name)}</h1><p>${escapeHtml(r.agency.agencyId)} · ${escapeHtml(r.agency.level.label)}</p></div><div class="agency-report-grid"><div><small>Today</small><b>${s.dailyGifts||0} gifts</b><span>${Number(s.dailyDiamonds||0).toLocaleString()} 🪙</span></div><div><small>This Week</small><b>${s.weeklyGifts||0} gifts</b><span>${Number(r.weeklyConfirmedDiamonds||0).toLocaleString()} 🪙</span></div><div><small>This Month</small><b>${s.monthlyGifts||0} gifts</b><span>${Number(r.monthlyConfirmedDiamonds||0).toLocaleString()} 🪙</span></div><div><small>All Time</small><b>${s.totalGifts||0} gifts</b><span>${Number(s.totalDiamonds||0).toLocaleString()} 🪙</span></div></div><h3>Top Hosts</h3>${(r.topHosts||[]).map((h,i)=>`<div class="agency-report-host"><span>#${i+1}</span><b>${escapeHtml(h.name)}</b><small>${escapeHtml(h.userId)}</small><strong>${Number(h.monthlyDiamonds||0).toLocaleString()} 💎</strong></div>`).join('')||'<p class="hint">No host activity yet.</p>'}</div></div>`;
    $("agency-panel-close").onclick=close; $("agency-print-report").onclick=()=>{const w=window.open('','_blank');if(!w){toast('Allow pop-ups to print the report');return;}w.document.write(`<html><head><title>${escapeHtml(r.agency.name)} Agency Report</title><style>body{font-family:Arial;padding:32px;max-width:760px;margin:auto}h1{color:#8c6420}.box{display:inline-block;width:22%;padding:15px;border:1px solid #ddd;margin:1%}.host{padding:10px;border-bottom:1px solid #ddd}</style></head><body><h1>${escapeHtml(r.agency.name)}</h1><p>Agency ID: ${escapeHtml(r.agency.agencyId)} · ${escapeHtml(r.agency.level.label)}</p><div class="box">Today<br><b>${s.dailyGifts||0}</b> gifts</div><div class="box">Week<br><b>${Number(r.weeklyConfirmedDiamonds||0).toLocaleString()}</b> 💎</div><div class="box">Month<br><b>${Number(r.monthlyConfirmedDiamonds||0).toLocaleString()}</b> 💎</div><h2>Top Hosts</h2>${(r.topHosts||[]).map((h,i)=>`<div class="host">#${i+1} ${escapeHtml(h.name)} — ${Number(h.monthlyDiamonds||0).toLocaleString()} 💎</div>`).join('')}</body></html>`);w.document.close();w.print();}; return;
  }
  if (panel === "rewards") {
    const r = await api(`/api/agency/rewards/${currentAgencyId}`); body.innerHTML=`<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Agency Reward</h2></div><div class="agency-panel-list">${r.success&&r.rewards.length?r.rewards.map(x=>`<div class="agency-reward-row"><span>🏆 #${x.rank}</span><div><strong>${Number(x.rewardDiamonds||0).toLocaleString()} 💎</strong><small>${escapeHtml(x.eventId||'Agency Ranking Event')} · ${new Date(x.creditedAt).toLocaleDateString()}</small></div></div>`).join(''):`<div class="agency-empty-state"><b>♜</b><p>No ranking rewards credited yet.</p></div>`}</div></div>`; $("agency-panel-close").onclick=close; return;
  }
  if (panel === "settlements") {
    const r=await api(`/api/agency/settlements/${currentAgencyId}`); body.innerHTML=`<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Settlement History</h2></div><div class="agency-panel-list">${r.success&&r.settlements.length?r.settlements.map(x=>`<div class="agency-settlement-row"><div><strong>${escapeHtml(x.periodStart||'')}</strong><small>Target ${Number(x.weeklyTarget||0).toLocaleString()} · Achieved ${Number(x.actualAchieved||0).toLocaleString()} · ${Number(x.commissionPercent||0)}%</small></div><b>${Number(x.paidAmount||x.calculatedSalary||0).toLocaleString()} Beans</b><span class="agency-status ${escapeHtml(x.status||'pending')}">${escapeHtml(String(x.status||'pending').toUpperCase())}</span></div>`).join(''):`<div class="agency-empty-state"><b>◷</b><p>No settlements recorded yet.</p></div>`}</div></div>`; $("agency-panel-close").onclick=close; return;
  }
  if (panel === "subagencies") {
    const r=await api(`/api/agency/sub-agencies/${currentAgencyId}`); body.innerHTML=`<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Sub-agency Data</h2><button id="agency-add-sub" class="btn btn-primary btn-sm">+ Add</button></div><div class="agency-panel-list">${r.success&&r.subAgencies.length?r.subAgencies.map(x=>`<div class="agency-manage-row"><div class="agency-manage-avatar">⌘</div><div><strong>${escapeHtml(x.name)}</strong><small>Manager: ${escapeHtml(x.managerUserId)} · Hosts: ${Number(x.hostIds?.length||0)}</small></div></div>`).join(''):`<div class="agency-empty-state"><b>⌘</b><p>No sub-agencies yet.</p></div>`}</div></div>`; $("agency-panel-close").onclick=close; $("agency-add-sub").onclick=()=>{const name=prompt('Sub-agency name');if(!name)return;const managerUserId=prompt('Manager User ID');if(!managerUserId)return;api('/api/agency/sub-agencies','POST',{parentAgencyId:currentAgencyId,name,managerUserId}).then(rr=>{toast(rr.success?'Sub-agency created':rr.message||'Could not create');if(rr.success)openAgencyPanel('subagencies');});}; return;
  }
  if (panel === "policy") {
    const r=await api(`/api/agency/report/${currentAgencyId}`); if(!r.success){toast(r.message||'Policy unavailable');return;} const target=Number(r.agency.weeklyTargetValue||0); body.innerHTML=`<div class="agency-panel"><div class="agency-panel-head"><button class="icon-btn" id="agency-panel-close">←</button><h2>Agency Policy</h2></div><div class="agency-policy-card"><div><span>Commission</span><strong>${(Number(r.agency.commissionRate||0)*100).toFixed(0)}%</strong><small>Current Agency commission</small></div><div><span>Weekly Target</span><strong>${target.toLocaleString()} 💎</strong><small>Confirmed gift Diamonds</small></div><div><span>Agency Level</span><strong>${escapeHtml(r.agency.level.label)}</strong><small>Based on monthly confirmed Diamonds</small></div></div><div class="agency-target-editor"><label>Set Weekly Target</label><div><input id="agency-target-input" class="field-solo" type="number" min="0" step="1" value="${target}"><button id="agency-target-save" class="btn btn-primary">Save</button></div><p class="hint">Commission percentage remains controlled by the admin policy; this owner control changes only the Agency's weekly target.</p></div></div>`; $("agency-panel-close").onclick=close; $("agency-target-save").onclick=async()=>{const value=Number($("agency-target-input").value);const rr=await api('/api/agency/weekly-target','POST',{agencyId:currentAgencyId,weeklyTarget:value});toast(rr.success?'Weekly target saved':rr.message||'Could not save');if(rr.success)close();}; return;
  }
}
async function sendAgencyInvite() {
  const input = $("agency-invite-input");
  const toUserId = input.value.trim();
  if (!toUserId) return;
  const r = await api("/api/agency/invite", "POST", { agencyId: currentAgencyId, fromUserId: me.userId, toUserId });
  if (r.success) { toast("Invitation sent"); input.value = ""; }
  else toast(r.message || "Could not send");
}

// ===========================================================================
// HOST CENTER
// ===========================================================================
let hostCenterPeriod = "all";
async function openHostCenter() {
  await Promise.all([loadHostStats(), loadHostGifts()]);
  showView("view-host-center");
}
async function loadHostStats() {
  const r = await api("/api/host-center/" + me.userId);
  if (!r.success) return;
  applyHostStats(r.stats);
}
function applyHostStats(s) {
  $("hc-daily-gifts").textContent = s.dailyGifts;
  $("hc-weekly-gifts").textContent = s.weeklyGifts;
  $("hc-monthly-gifts").textContent = s.monthlyGifts;
  $("hc-total-gifts").textContent = s.totalGifts;
  $("hc-total-diamonds").textContent = s.totalDiamonds;
  $("hc-diamond-value").textContent = s.estimatedDiamondValue;
}
async function loadHostGifts() {
  const r = await api(`/api/host-center/${me.userId}/gifts?period=${hostCenterPeriod}&limit=50`);
  const wrap = $("hc-gift-list");
  wrap.innerHTML = "";
  if (!r.success || !r.gifts.length) {
    $("hc-gift-empty").classList.remove("hidden");
    return;
  }
  $("hc-gift-empty").classList.add("hidden");
  r.gifts.forEach((g) => wrap.appendChild(hostGiftRow(g)));
}
function hostGiftRow(g) {
  const row = document.createElement("div");
  row.className = "user-row";
  row.innerHTML = `
    <div class="social-item-icon" style="width:40px;height:40px;">${g.senderAvatar ? `<img src="${escapeHtml(g.senderAvatar)}" alt="">` : "👤"}</div>
    <div class="user-row-body">
      <span class="name">${escapeHtml(g.senderName)} <span class="hint">(${escapeHtml(g.senderUserId)})</span></span>
      <span class="sub">🎁 ${escapeHtml(g.giftName)} · <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> ${g.diamondAmount} · Room #${escapeHtml(String(g.roomNumber))} · ${formatVisitTime(g.time)}</span>
    </div>`;
  return row;
}
$("hc-period-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".social-tab");
  if (!btn) return;
  $("hc-period-tabs").querySelectorAll(".social-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  hostCenterPeriod = btn.dataset.period;
  loadHostGifts();
});
// Live push from server whenever a new gift lands in this host's own room
// (see agencyHost.js registerGiftRecordedHook) — keeps Host Center in sync
// with Agency Center without either side polling or duplicating data.
function handleHostStatsUpdate(stats) {
  if (!$("view-host-center").classList.contains("active")) return;
  applyHostStats(stats);
}
function handleHostGiftReceived(gift) {
  if (!$("view-host-center").classList.contains("active")) return;
  if (hostCenterPeriod === "all" || hostCenterPeriod === "daily") {
    $("hc-gift-empty").classList.add("hidden");
    $("hc-gift-list").prepend(hostGiftRow(gift));
  }
}

// ===========================================================================
// ROOM "MORE" MENU — bottom sheet holding Music / TV / Playlist / Game /
// Shop now that they're no longer always-on icons in the room toolbar. Pure
// show/hide of the existing panel; every button inside still fires the
// exact same click handler it always did (see closeAllPanels/EXCLUSIVE_PANEL_IDS
// above for how opening one of them also closes this sheet automatically).
// ===========================================================================
[
  ["btn-toggle-gift-effect", "giftEffect"],
  ["btn-toggle-gift-sound", "giftSound"],
  ["btn-toggle-entry-animation", "entryAnimation"]
].forEach(([id, key]) => {
  document.getElementById(id)?.addEventListener("click", () => toggleRoomEffectPref(key));
});

$("btn-room-more").addEventListener("click", () => {
  closeAllPanels("room-more-menu");
  const calcBtn = $("btn-open-gift-calculator");
  if (calcBtn) calcBtn.classList.toggle("hidden", !canManageGiftCalculator());
  $("room-more-menu").classList.remove("hidden");
});
$("btn-room-more-close").addEventListener("click", () => {
  $("room-more-menu").classList.add("hidden");
});
$("btn-open-gift-calculator")?.addEventListener("click", openGiftCalculatorModal);
$("btn-gift-calculator-on")?.addEventListener("click", () => setGiftCalculatorPower(true));
$("btn-gift-calculator-off")?.addEventListener("click", () => setGiftCalculatorPower(false));
$("btn-gift-calculator-reset")?.addEventListener("click", resetGiftCalculator);
$("btn-gift-calculator-close")?.addEventListener("click", () => closeGiftCalculatorModal(false));
$("btn-gift-calculator-x")?.addEventListener("click", () => closeGiftCalculatorModal(false));
$("gift-calculator-handle")?.addEventListener("click", () => closeGiftCalculatorModal(false));
$("gift-calculator-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "gift-calculator-modal") closeGiftCalculatorModal(false);
});
$("room-more-menu").addEventListener("click", (e) => {
  if (e.target.id === "room-more-menu") $("room-more-menu").classList.add("hidden");
});
// btn-toggle-yt doesn't open a panel of its own (it just flips YouTube mode
// on/off for the room), so it wouldn't otherwise close this sheet the way
// the other More items do — this just tucks the sheet away after the tap,
// without touching the actual toggle logic above.
$("btn-toggle-yt").addEventListener("click", () => $("room-more-menu").classList.add("hidden"));

$("btn-open-shop").addEventListener("click", () => {
  $("room-more-menu").classList.add("hidden");
  showView("view-shop");
});
$("btn-shop-frames").addEventListener("click", () => openFrames());

// Teen Patti entry from Shop. The supplied game runs in an iframe so its
// global CSS and game handlers cannot interfere with PingPong's main app.
const teenPattiSheet = $("teen-patti-sheet");
const teenPattiFrame = $("teen-patti-frame");
$("btn-shop-teen-patti")?.addEventListener("click", () => {
  teenPattiSheet?.classList.remove("hidden");
  if (teenPattiFrame && teenPattiFrame.src === "about:blank") {
    teenPattiFrame.src = "/games/teen-patti/index.html";
  }
});
$("btn-close-teen-patti")?.addEventListener("click", () => {
  teenPattiSheet?.classList.add("hidden");
});
teenPattiSheet?.addEventListener("click", (event) => {
  if (event.target === teenPattiSheet) teenPattiSheet.classList.add("hidden");
});


// ===========================================================================
// ROOM TV SCREEN — Lucky Fruit, opened on demand as a bottom-
// sheet overlay (see the room-tv-screen CSS fix note for why it's no longer
// a permanently-visible in-flow block).
// ===========================================================================
const ROOM_TV_GAMES = {
  foodwheel: "/foodwheel/index.html"
};
let roomTvActiveGame = "foodwheel";
let fruitWheelUiConfig = { scale: 1, width: 100, height: 68, bottomOffset: 3, topOffset: 0 };
function applyFruitWheelUiConfig(cfg) {
  fruitWheelUiConfig = { ...fruitWheelUiConfig, ...(cfg || {}) };
  const frame = $("room-tv-frame");
  const screen = $("room-tv-screen");
  if (!frame || !screen) return;
  const c = fruitWheelUiConfig;
  const scale = Number(c.scale) || 1;
  const width = Number(c.width) || 100;
  const height = Number(c.height) || 100;
  const bottom = Number(c.bottomOffset) || 0;
  // The game sheet is bottom-anchored. Increasing bottomOffset moves the
  // complete game upward while keeping the result/wager area on-screen.
  const heightDvh = Math.max(48, Math.min(78, height * 0.68));
  screen.style.setProperty("--fw-height-dvh", `${heightDvh}dvh`);
  screen.style.setProperty("--fw-bottom-dvh", `${bottom}dvh`);
  const top = Number(c.topOffset) || 0;
  screen.style.setProperty("--fw-top-dvh", `${top}dvh`);
  screen.style.setProperty("--fw-frame-width", `${width}%`);
  screen.style.setProperty("--fw-frame-left", `${(100 - width) / 2}%`);
  screen.style.setProperty("--fw-frame-height", "100%");
  frame.style.setProperty("--fw-scale", String(scale));
  frame.style.transformOrigin = "center bottom";
}
async function loadFruitWheelUiConfig() {
  try {
    const r = await api("/api/fruitwheel/ui-config");
    if (r?.success) applyFruitWheelUiConfig(r.config);
  } catch (_) {}
}



// Real winner feed cache (see socket.on("real-win", ...) above) — kept here
// so it survives between game opens without re-fetching every time.
let recentWins = [];
let recentWinsLoaded = false;
function sendRealWinsToGame() {
  const frame = $("room-tv-frame");
  if (frame && frame.contentWindow) {
    frame.contentWindow.postMessage({ type: "REAL_WINS", wins: recentWins }, "*");
  }
}

// Lucky Fruit history is server-authoritative. The iframe keeps its local UI
// state for responsiveness, but the visible Game Records list is replaced by
// this authenticated history after open and after every settled round.
async function sendFruitWheelHistoryToGame() {
  const frame = $("room-tv-frame");
  if (!frame || !frame.contentWindow || !me || !me.userId) return;
  try {
    const r = await api("/api/fruitwheel/history/" + encodeURIComponent(me.userId));
    if (r && r.success && Array.isArray(r.history)) {
      frame.contentWindow.postMessage({ type: "FRUITWHEEL_HISTORY", history: r.history }, "*");
    }
  } catch (e) {
    console.warn("[Fruit Wheel] history sync failed:", e?.message || e);
  }
}

async function ensureRecentWinsLoaded() {
  if (recentWinsLoaded) return;
  recentWinsLoaded = true;
  try {
    const r = await api("/api/games/recent-wins");
    if (r.success && Array.isArray(r.wins)) recentWins = r.wins;
  } catch (e) {}
}

function setRoomTvGame(key) {
  if (!ROOM_TV_GAMES[key]) return;
  roomTvActiveGame = key;
  $("room-tv-frame").src = ROOM_TV_GAMES[key];
  document.querySelectorAll(".room-tv-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.game === key);
  });
}


// Local only — opening/closing the game affects just the person who tapped
// the button, not the rest of the room.
$("btn-toggle-game").addEventListener("click", () => openRoomGame());
$("btn-lucky-fruit-launcher")?.addEventListener("click", () => openRoomGame("foodwheel"));
$("btn-room-tv-close").addEventListener("click", () => closeRoomGame());

let roomMusicWasPlayingBeforeGame = false;

function openRoomGame(game, fromRemote) {
  closeAllPanels("room-tv-screen");
  document.body.classList.add("game-locked");
  $("room-tv-screen").classList.add("tv-open");
  // Fix (sluggish app / stuck UI after playing): always load a fresh
  // instance of the game on open rather than trusting a stale `.src` check.
  // Combined with the teardown in closeRoomGame() below, this guarantees
  // the game is never silently running in the background when the panel
  // is closed.
  setRoomTvGame(game || roomTvActiveGame);
  loadFruitWheelUiConfig();

  // Fix (audio bug): the room's background music used to keep playing
  // underneath the game. Pause it locally while the game is open (each
  // user's own playback only — this doesn't touch the shared music state
  // for others) and remember whether it was playing so we can resume it
  // on close instead of guessing.
  const musicEl = $("room-audio");
  if (musicEl) {
    roomMusicWasPlayingBeforeGame = !musicEl.paused;
    musicEl.pause();
  }

  if (!fromRemote && currentRoomId) {
    socket.emit("game-toggle", { roomId: currentRoomId, open: true, game: game || roomTvActiveGame });
  }
}
function closeRoomGame(fromRemote) {
  document.body.classList.remove("game-locked");
  $("room-tv-screen").classList.remove("tv-open");

  // Fix (app feels stuck / leave-room unresponsive after playing): the
  // game iframe used to keep running forever in the background even once
  // "closed" here (only visually hidden via CSS), so all its timers —
  // Lucky Fruit's bot betting/dealing loops, Food Wheel's spin simulation —
  // kept firing and competing for the main thread the whole time you stayed
  // in the room, which is what made the rest of the UI (leave button, room
  // settings, chat) feel sluggish or unresponsive. Unloading the iframe
  // fully stops all of that; setRoomTvGame() loads a fresh instance again
  // next time the panel is opened.
  $("room-tv-frame").src = "about:blank";
  if (currentRoomId) socket.emit("fruitwheel-leave", { roomId: currentRoomId });

  const musicEl = $("room-audio");
  if (musicEl && roomMusicWasPlayingBeforeGame) {
    musicEl.play().catch(() => {});
  }
  roomMusicWasPlayingBeforeGame = false;

  if (!fromRemote && currentRoomId) {
    socket.emit("game-toggle", { roomId: currentRoomId, open: false });
  }
}

// Bridge messages coming from whichever game iframe is currently loaded on the TV screen
window.addEventListener("message", async (ev) => {
  const data = ev && ev.data;
  if (!data) return;
  // SECURITY FIX (Fruit Wheel audit, item #3, 2026-08-02): this listener
  // previously trusted any postMessage delivered to the window, regardless
  // of sender. The real fund-moving action (fruitwheel-bet) is validated
  // server-side against the user's real balance, so
  // this was never an actual coin-theft path — but a forged FOODWHEEL_BET
  // message from any other embedded/compromised script could still trigger
  // an unwanted real bet on the user's own money without them tapping
  // anything. Restricting to messages whose source is exactly the game
  // iframe's own contentWindow closes that gap with no behavior change for
  // the real game, which is the only legitimate sender.
  const gameFrame = $("room-tv-frame");
  if (!gameFrame || ev.source !== gameFrame.contentWindow) return;

  if (data.type === "FOODWHEEL_CLOSE") {
    // The in-game ✕ button now behaves exactly like the overlay's own close button.
    closeRoomGame();
  }

  if (data.type === "FOODWHEEL_READY") {
    // Hand the player's real wallet balance to the game on load — fetch it
    // fresh from the server (the single source of truth for coins) rather
    // than trusting the local cache, so the game never starts from a
    // slightly-stale number.
    const w = await api("/api/wallet/" + me.userId);
    if (w.success) { me.diamonds = w.diamonds; saveSession(); fillHomeProfile(); }
    $("room-tv-frame").contentWindow.postMessage({ type: "FOODWHEEL_INIT", balance: me.diamonds || 0 }, "*");
    await ensureRecentWinsLoaded();
    sendRealWinsToGame();
    await sendFruitWheelHistoryToGame();
    // Fruit Wheel's round/result/payout all live on the server now — join
    // that room's round so this tab starts receiving real broadcasts.
    if (currentRoomId) socket.emit("fruitwheel-join", { roomId: currentRoomId });
    socket.emit("fruitwheel-leaderboard-request");

    // Replay matching authoritative packets after iframe READY so a load race
    // can never hide the real top winners or the player's real result.
    const frameReady = $("room-tv-frame");
    const sameRoom = (x) => x && (!x.roomId || !currentRoomId || x.roomId === currentRoomId);
    if (frameReady && frameReady.contentWindow) {
      if (sameRoom(fruitWheelLiveState)) frameReady.contentWindow.postMessage({ type: "FRUITWHEEL_ROUND", ...fruitWheelLiveState }, "*");
      if (sameRoom(fruitWheelLiveWinners) && fruitWheelLiveState && Number(fruitWheelLiveWinners.roundId) === Number(fruitWheelLiveState.roundId)) frameReady.contentWindow.postMessage({ type: "FRUITWHEEL_WINNERS", ...fruitWheelLiveWinners }, "*");
      if (sameRoom(fruitWheelLiveMyResult) && fruitWheelLiveState && Number(fruitWheelLiveMyResult.roundId) === Number(fruitWheelLiveState.roundId)) frameReady.contentWindow.postMessage({ type: "FRUITWHEEL_MY_RESULT", ...fruitWheelLiveMyResult }, "*");
    }
  }

  if (data.type === "FOODWHEEL_BET") {
    // The bet itself is sent to the server for validation and real-money
    // deduction; the game only plays the tap animation locally. The server
    // pushes back a wallet-update (handled above) with the true balance.
    if (currentRoomId) {
      socket.emit("fruitwheel-bet", { roomId: currentRoomId, foodId: data.foodId, amount: data.amount });
    }
  }



});

// ===========================================================================
// TREASURE CHEST
// ===========================================================================
let chestConfigCache = null;
let chestCountdownTimer = null;
let chestResetAtMs = null;

async function loadChestConfig() {
  if (chestConfigCache) return chestConfigCache;
  const r = await api("/api/chest/config");
  if (r.success) chestConfigCache = r.levels;
  return chestConfigCache;
}

// Box artwork changes with the chest's current level (level 1 = blue,
// level 2 = red/ruby, level 3 = purple/gold, ...). Falls back to the
// highest available box art for any level beyond what's been supplied,
// and to the original default box if nothing at all is available yet.
const CHEST_BOX_ART_LEVELS = 3;
function chestBoxArtSrc(level) {
  const n = Math.max(1, Math.min(CHEST_BOX_ART_LEVELS, Number(level) || 1));
  return "/images/chest-level-" + n + ".png";
}
async function renderChest(chest) {
  await loadChestConfig();
  const idx = Math.min(chest.level - 1, (chestConfigCache || []).length - 1);
  const cfg = chestConfigCache && chestConfigCache[idx];
  const target = cfg ? cfg.target : chest.contributed || 1;
  const finished = chest.level > (chestConfigCache || []).length;

  $("chest-level").textContent = finished ? (chestConfigCache || []).length : chest.level;
  $("chest-contributed").textContent = Math.min(chest.contributed, target);
  $("chest-target").textContent = finished ? chest.contributed : target;
  const pct = finished ? 100 : Math.min(100, (chest.contributed / target) * 100);
  $("chest-progress-fill").style.width = pct + "%";
  const chestImg = $("chest-img");
  if (chestImg) chestImg.src = chestBoxArtSrc(chest.level);

  chestResetAtMs = new Date(chest.resetAt).getTime();
  startChestCountdown();
}

function startChestCountdown() {
  clearInterval(chestCountdownTimer);
  chestCountdownTimer = setInterval(() => {
    if (!chestResetAtMs) return;
    const diff = Math.max(0, chestResetAtMs - Date.now());
    const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, "0");
    $("chest-countdown").textContent = `${h}:${m}:${s}`;
  }, 1000);
}
function stopChestCountdown() { clearInterval(chestCountdownTimer); }

// ===========================================================================
// ROOM RANKING — Daily / Weekly / Monthly gifter leaderboard for the room.
// Data is fetched on open and then kept live by "room-ranking-update"
// broadcasts the server sends alongside every gift in this room.
// ===========================================================================
let rankingPeriod = "daily";
let rankingCache = { daily: [], weekly: [], monthly: [] };

// Short relative-time label for the optional "last gift" line (e.g. "2m
// ago", "3h ago"). Local to the ranking popup only — doesn't touch any
// other time-formatting logic elsewhere in the app.
function formatRankingLastGiftTime(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!isFinite(diffMs) || diffMs < 0) return "";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// FIX (Room Ranking popup, 2026-07-29): renders every row the server sends
// — no client-side Top-N trimming — since the popup is now a full-screen,
// fully scrollable list. Also surfaces User ID and an optional "last gift"
// time, and batches DOM insertion through a fragment instead of repeated
// appendChild calls (fewer reflows for rooms with large gifter counts).
function renderRanking() {
  const wrap = $("ranking-list");
  const list = rankingCache[rankingPeriod] || [];
  wrap.innerHTML = "";
  $("ranking-empty").classList.toggle("hidden", list.length > 0);
  const fragment = document.createDocumentFragment();
  list.forEach((row) => {
    const rankClass = row.rank === 1 ? "rank-top1" : row.rank === 2 ? "rank-top2" : row.rank === 3 ? "rank-top3" : "";
    const lastGift = formatRankingLastGiftTime(row.lastGiftTime);
    const item = document.createElement("div");
    item.className = "user-row";
    item.innerHTML = `
      <div class="rank-badge ${rankClass}">${row.rank}</div>
      <img class="avatar avatar-sm" src="${escapeHtml(row.photo || placeholderAvatar(row.name))}" alt="">
      <div class="user-row-body">
        <span class="name">${escapeHtml(row.name)}</span>
        <span class="sub">ID: ${escapeHtml(row.userId)} · 🎁 ${row.giftCount}${lastGift ? " · " + escapeHtml(lastGift) : ""}</span>
      </div>
      <div class="ranking-diamonds"><img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> ${row.totalDiamonds.toLocaleString()}</div>
    `;
    fragment.appendChild(item);
  });
  wrap.appendChild(fragment);
}

// Compact "top 3 gifters" preview shown right in the room header, always
// visible (unlike the full ranking-list modal, which only renders while
// open) — see room-ranking-data/room-ranking-update handlers and the
// get-room-ranking emit on room join, all above. Tapping the pill opens the
// existing full-list modal via #btn-room-ranking's own click handler below;
// this function only ever touches the avatar row inside it.
function renderRankingPreview() {
  const wrap = $("ranking-preview-avatars");
  if (!wrap) return;
  const top3 = (rankingCache[rankingPeriod] || []).slice(0, 3);
  if (!top3.length) { wrap.innerHTML = `<span class="rank-ph"></span><span class="rank-ph"></span><span class="rank-ph"></span>`; wrap.classList.add("empty"); return; }
  wrap.classList.remove("empty");
  wrap.innerHTML = top3.map((row) =>
    `<img class="ranking-preview-avatar" src="${escapeHtml(row.photo || placeholderAvatar(row.name))}" alt="${escapeHtml(row.name)}">`
  ).join("");
}

$("btn-room-ranking").addEventListener("click", () => {
  if (!currentRoomId) return;
  closeAllPanels("modal-room-ranking");
  $("modal-room-ranking").classList.remove("hidden");
  renderRanking();
  socket.emit("get-room-ranking", { roomId: currentRoomId });
});
$("btn-ranking-x-close").addEventListener("click", () => $("modal-room-ranking").classList.add("hidden"));
$("ranking-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".social-tab");
  if (!btn) return;
  $("ranking-tabs").querySelectorAll(".social-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  rankingPeriod = btn.dataset.period;
  renderRanking();
  renderRankingPreview();
});

// ===========================================================================
// GIFT BOX / LEVEL INFORMATION — read-only view of the Level System.
// Level itself only ever changes server-side, and only from a successful
// room gift send (see idLevel.js) — this popup just displays whatever the
// server last told it via "level-info-data" (on open) or "id-level-up"
// (pushed live the instant a send actually crosses a threshold, from
// anywhere in the app, not just while this popup is open).
// ===========================================================================
let levelInfoCache = null;

function renderLevelInfo() {
  const info = levelInfoCache;
  if (!info) return;
  $("level-info-badge").textContent = info.currentLevel;
  $("level-info-current-level").textContent = `Level ${info.currentLevel}`;
  $("level-info-lifetime").textContent = info.lifetimeGiftSent.toLocaleString();
  $("level-info-max").classList.toggle("hidden", !info.isMaxLevel);
  $("level-info-next-wrap").classList.toggle("hidden", info.isMaxLevel);
  if (!info.isMaxLevel) {
    $("level-info-next-level").textContent = `Level ${info.nextLevel}`;
    $("level-info-progress-fill").style.width = info.progressPercent + "%";
    $("level-info-remaining").textContent = `Need ${info.giftNeededForNextLevel.toLocaleString()} more gift value to reach the next level.`;
  }
  // UPGRADE (2026-08-04, Level Management): apply the current group's
  // theme — badge PNG, gradient background, text color, glow — to the
  // badge circle, and show a small "next badge" preview when the next
  // level lands in a different (admin-themed) group.
  $("level-info-group-label").textContent = `Level Group ${info.groupLabel}`;
  applyLevelTheme($("level-info-badge-wrap"), info.theme);
  const badgeImg = $("level-info-badge-img");
  if (info.theme && info.theme.badgeUrl) {
    badgeImg.src = info.theme.badgeUrl;
    badgeImg.classList.remove("hidden");
  } else {
    badgeImg.classList.add("hidden");
  }
  const nextWrap = $("level-info-next-badge-wrap");
  if (!info.isMaxLevel && info.nextTheme) {
    nextWrap.classList.remove("hidden");
    $("level-info-next-group-label").textContent = info.nextGroupLabel;
    const nextImg = $("level-info-next-badge-img");
    if (info.nextTheme.badgeUrl) { nextImg.src = info.nextTheme.badgeUrl; nextImg.classList.remove("hidden"); }
    else nextImg.classList.add("hidden");
  } else {
    nextWrap.classList.add("hidden");
  }
}

// UPGRADE (2026-08-04, Level Management): shared helper — paints a level
// badge element (background gradient, text color, optional glow) from a
// theme object returned by the server (idLevel.js's getTheme()/
// getLevelInfo()). Used by the Level Information modal above and by the
// live "level-theme-update" broadcast handler below. Never throws if
// theme/el is missing (badges render fine with the CSS default look).
function applyLevelTheme(el, theme) {
  if (!el) return;
  if (!theme) { el.style.background = ""; el.style.boxShadow = ""; el.style.color = ""; return; }
  el.style.background = `linear-gradient(135deg, ${theme.gradientFrom || "#8a8f98"}, ${theme.gradientTo || "#5c6068"})`;
  el.style.color = theme.textColor || "#fff";
  el.style.boxShadow = theme.glowEnabled ? `0 0 14px ${theme.glowColor || theme.gradientFrom || "#fff"}` : "";
}

// UPGRADE (2026-08-04, Level Management) — GLOBAL THEME UPDATE: when an
// admin saves a new theme for a level group, every online user currently
// in that group should see it immediately, with no reload. The actual
// socket.on("level-theme-update", ...) listener lives inside
// connectSocket() (see the ROOT-CAUSE FIX comment there for why it must
// NOT be a bare top-level statement) — this comment is just a pointer so
// the logic isn't a mystery when read from here.

$("btn-level-info").addEventListener("click", () => {
  closeAllPanels("modal-level-info");
  $("modal-level-info").classList.remove("hidden");
  if (levelInfoCache) renderLevelInfo();
  socket.emit("get-level-info");
});
$("btn-level-info-x-close").addEventListener("click", () => $("modal-level-info").classList.add("hidden"));
// (level-info-data / id-level-up socket listeners moved into connectSocket() —
// see the ROOT-CAUSE FIX comment there. Registering them here, at top level,
// was the actual cause of the session-restore and settings-icon bugs.)

$("btn-close-chest-info").addEventListener("click", () => $("modal-chest-info").classList.add("hidden"));


function renderChestDetails(data) {
  if (!data) return;
  const level = Number(data.level) || 1;
  $("chest-live-level").textContent = `LV.${level}`;
  $("chest-live-contributed").textContent = Number(data.contributed || 0).toLocaleString();
  $("chest-live-target").textContent = Number(data.target || 0).toLocaleString();
  const pct = Number(data.target) > 0 ? Math.min(100, Number(data.contributed || 0) / Number(data.target) * 100) : 0;
  $("chest-live-progress-fill").style.width = pct + "%";
  $("chest-live-img").src = chestBoxArtSrc(level);
  const cards = $("chest-rank-cards");
  cards.innerHTML = "";
  const rewards = Array.isArray(data.rankRewards) ? data.rankRewards : [];
  [1,2,3].forEach((rank) => {
    const r = rewards.find((x) => Number(x.rank) === rank) || { rank, diamonds: 0, frameId: null };
    const frame = r.frame || null;
    const frameHtml = frame?.imageUrl ? `<img class="chest-rank-frame-img" src="${escapeHtml(frame.imageUrl)}" alt="${escapeHtml(frame.name || "Frame")}">` : '<span class="frame-mini empty">FRAME</span>';
    const frameMeta = frame ? `<div class="chest-card-frame-id">${escapeHtml(frame.name || "Frame")}</div>` : '<div class="chest-card-frame-id">Frame will be added by Admin</div>';
    const card = document.createElement("div");
    card.className = `chest-rank-card chest-rank-${rank}`;
    card.dataset.rank = String(rank);
    card.innerHTML = `<div class="chest-rank-medal">TOP ${rank}</div><div class="chest-rank-frame">${frameHtml}</div><div class="chest-rank-diamonds"><img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> ${Number(r.diamonds || 0).toLocaleString()}</div>${frameMeta}`;
    cards.appendChild(card);
  });
  setActiveChestRankTab(1);
  const list = $("chest-live-gifters");
  list.innerHTML = "";
  const contributors = Array.isArray(data.contributors) ? data.contributors : [];
  if (!contributors.length) {
    list.innerHTML = '<div class="chest-empty-gifters">No gifts yet. Be the first contributor.</div>';
  } else {
    contributors.slice(0, 50).forEach((c) => {
      const row = document.createElement("div");
      row.className = "chest-gifter-row";
      row.innerHTML = `<div class="chest-gifter-rank">#${c.rank}</div><img class="chest-gifter-avatar" src="${escapeHtml(c.photo || placeholderAvatar(c.name))}" alt=""><div class="chest-gifter-name">${escapeHtml(c.name)}</div><div class="chest-gifter-amount"><img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> ${Number(c.amount || 0).toLocaleString()}</div>`;
      list.appendChild(row);
    });
  }
  const resetAt = new Date(data.resetAt).getTime();
  const updateReset = () => {
    const diff = Math.max(0, resetAt - Date.now());
    const h = String(Math.floor(diff / 3600000)).padStart(2, "0");
    const m = String(Math.floor(diff % 3600000 / 60000)).padStart(2, "0");
    const sec = String(Math.floor(diff % 60000 / 1000)).padStart(2, "0");
    $("chest-live-reset").textContent = `${h}:${m}:${sec}`;
  };
  updateReset();
  clearInterval(window.__ppChestDetailTimer);
  window.__ppChestDetailTimer = setInterval(updateReset, 1000);
  closeAllPanels("modal-chest-live");
  $("modal-chest-live").classList.remove("hidden");
}

function setActiveChestRankTab(rank) {
  const wanted = Number(rank) || 1;
  document.querySelectorAll("#chest-rank-tabs .chest-rank-tab").forEach((btn) => {
    const active = Number(btn.dataset.chestRank) === wanted;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("#chest-rank-cards .chest-rank-card").forEach((card) => {
    card.classList.toggle("active", Number(card.dataset.rank) === wanted);
  });
}

document.getElementById("chest-rank-tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".chest-rank-tab");
  if (!btn) return;
  setActiveChestRankTab(Number(btn.dataset.chestRank) || 1);
});

async function openChestDetails() {
  if (!currentRoomId || !socket) return;
  socket.emit("get-chest-details", { roomId: currentRoomId });
}

let MAZA_GIFT_EFFECTS = null;
async function loadMazaGiftEffects() {
  if (MAZA_GIFT_EFFECTS) return MAZA_GIFT_EFFECTS;
  try {
    const r = await fetch('/data/maza_gift_effects.json?ts=' + Date.now(), { cache: 'no-store' });
    if (r.ok) MAZA_GIFT_EFFECTS = await r.json();
  } catch (e) { console.warn('[MAZA] effect manifest unavailable', e); }
  return MAZA_GIFT_EFFECTS;
}
function setChestEffectVideo(src, level) {
  const video = $('chest-open-effect-video');
  if (!video) return;
  video.classList.add('hidden');
  video.pause();
  video.removeAttribute('src');
  if (!src) return;
  video.src = src;
  video.currentTime = 0;
  video.muted = true;
  video.playsInline = true;
  video.classList.remove('hidden');
  const p = video.play();
  if (p && p.catch) p.catch(() => {});
}
async function playChestOpenAnimation(data) {
  const modal = $('modal-chest-reward');
  const box = $('chest-box');
  const opener = data?.opener?.name || 'A user';
  const level = Math.max(1, Math.min(3, Number(data?.level) || 1));
  const count = $('chest-open-count');
  const reveal = $('chest-reward-reveal-img');
  const mystery = $('chest-reward-mystery-img');
  const video = $('chest-open-effect-video');
  const manifest = await loadMazaGiftEffects();
  $('chest-opener-name').textContent = opener;
  $('chest-reward-level').textContent = `LEVEL ${level}`;
  $('chest-open-kicker').textContent = 'TREASURE CHEST';
  mystery.classList.remove('reveal-out', 'about-to-open');
  mystery.classList.add('counting-down');
  reveal.classList.add('hidden');
  if (video) { video.classList.add('hidden'); video.pause(); video.removeAttribute('src'); }
  box.classList.remove('about-to-open');
  box.classList.add('opening');
  modal.classList.remove('hidden');

  // Premium opening sequence: 9 → 8 → 7 … → 1, then the real MAZA chest
  // animation. Every box (all levels, every gift type) runs through the
  // same beats: a long, calm anticipatory glow while it counts all the way
  // down, then — once it hits the final 3 numbers — the box itself starts
  // shaking harder and glowing brighter each tick until the instant it
  // pops open (mirrors the reference clip's full 9-count build-up).
  const STEP_MS = 700;
  const steps = [9, 8, 7, 6, 5, 4, 3, 2, 1];
  steps.forEach((n, i) => setTimeout(() => {
    count.textContent = String(n);
    count.classList.remove('count-pop');
    requestAnimationFrame(() => count.classList.add('count-pop'));
    if (n <= 3) {
      box.classList.add('about-to-open');
      mystery.classList.add('about-to-open');
      count.classList.add('count-urgent');
    }
  }, i * STEP_MS));

  const OPEN_AT = steps.length * STEP_MS + 100;
  setTimeout(() => {
    $('chest-open-kicker').textContent = `${opener} OPENED THE CHEST`;
    const src = manifest?.opening?.[String(level)] || manifest?.opening?.['1'];
    setChestEffectVideo(src, level);
    count.textContent = 'OPEN!';
    count.classList.remove('count-urgent');
    box.classList.remove('opening', 'about-to-open');
    box.classList.add('opened');
    mystery.classList.remove('counting-down', 'about-to-open');
    mystery.classList.add('reveal-out');
  }, OPEN_AT);

  const REVEAL_AT = OPEN_AT + 5700;
  setTimeout(() => {
    if (video) { video.pause(); video.classList.add('hidden'); }
    reveal.src = chestBoxArtSrc(level);
    reveal.classList.remove('hidden');
    requestAnimationFrame(() => reveal.classList.add('reveal-in'));
    renderChestRewardRows(data);
  }, REVEAL_AT);

  clearTimeout(window.__ppChestRewardClose);
  window.__ppChestRewardClose = setTimeout(closeChestReward, REVEAL_AT + 8500);
}
function renderChestRewardRows(data) {
  const topWrap = $("chest-reward-top");
  topWrap.innerHTML = "";
  const rewards = Array.isArray(data?.rewards) ? data.rewards : [];
  const top = Array.isArray(data?.topContributors) ? data.topContributors : [];
  [1,2,3].forEach((rank) => {
    const contributor = top[rank - 1];
    const reward = rewards.find((r) => Number(r.rank) === rank);
    if (!contributor) return;
    const row = document.createElement("div");
    row.className = `chest-reward-rank-row chest-rank-${rank}`;
    row.innerHTML = `<div class="chest-reward-rank-left"><b>TOP ${rank}</b><span>${escapeHtml(contributor.name)}</span></div><div class="chest-reward-rank-right"><span><img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> ${Number(reward?.diamonds || 0).toLocaleString()}</span>${reward?.frame ? `<img class="chest-row-frame" src="${escapeHtml(reward.frame.imageUrl || "")}" alt="Frame">` : ""}</div>`;
    topWrap.appendChild(row);
  });
  const meReward = rewards.find((r) => r.userId === me?.userId);
  if (meReward) {
    const mine = document.createElement("div");
    mine.className = "chest-my-reward";
    mine.innerHTML = `YOU: TOP ${meReward.rank} • <img src="/images/icons/icon-diamond-premium.png" class="currency-icon" alt="diamond"> ${Number(meReward.diamonds || 0).toLocaleString()}${meReward.frame ? " • Frame added to Frame Store ✓" : ""}`;
    topWrap.prepend(mine);
  }
}


let closeChestRewardTimer = null;
function closeChestReward() {
  closeChestRewardTimer && clearTimeout(closeChestRewardTimer);
  closeChestRewardTimer = null;
  $("modal-chest-reward").classList.add("hidden");
  $("chest-box")?.classList.remove("opening", "opened", "about-to-open");
  $("chest-reward-mystery-img")?.classList.remove("counting-down", "about-to-open");
}
$("btn-close-chest-reward").addEventListener("click", closeChestReward);
$("btn-close-chest-live").addEventListener("click", () => {
  $("modal-chest-live").classList.add("hidden");
  clearInterval(window.__ppChestDetailTimer);
});
$("chest-box").addEventListener("click", openChestDetails);
$("btn-chest-info").addEventListener("click", openChestDetails);

// ===========================================================================
// ROOM MODERATION
// ===========================================================================
let seatLockButtons = [];
(function buildSeatLockRow() {
  const row = $("seat-lock-row");
  for (let n = 1; n <= 12; n++) {
    const b = document.createElement("button");
    b.className = "pick-btn";
    b.textContent = n;
    b.addEventListener("click", () => {
      const isLocked = (currentRoom?.lockedSeats || []).includes(n);
      socket.emit("lock-seat", { roomId: currentRoomId, seatNumber: n, locked: !isLocked });
    });
    row.appendChild(b);
    seatLockButtons.push(b);
  }
})();

$("mod-room-lock-toggle").addEventListener("change", (e) => {
  $("mod-room-lock-password").classList.toggle("hidden", !e.target.checked);
});
$("btn-mod-room-lock-save").addEventListener("click", () => {
  const locked = $("mod-room-lock-toggle").checked;
  const password = $("mod-room-lock-password").value;
  if (locked && !password.trim()) { toast("Enter Password"); return; }
  socket.emit("set-room-lock", { roomId: currentRoomId, locked, password });
  toast(locked ? "Room locked" : "Room unlocked");
  $("mod-room-lock-password").value = "";
});

$("btn-mod-room-name-save")?.addEventListener("click", async () => {
  if (!currentRoomId || !currentRoom || !me || currentRoom.hostId !== me.userId) {
    toast("Only the room owner can change the Room name");
    return;
  }
  const input = $("mod-room-name-input");
  const btn = $("btn-mod-room-name-save");
  const roomName = (input?.value || "").trim();
  if (!roomName) { toast("Enter a Room name"); return; }
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const r = await api("/api/room/rename", "POST", { roomId: currentRoomId, roomName });
    if (!r.success) { toast(r.message || "Couldn't change Room name"); return; }
    if (r.room) currentRoom = r.room;
    if (input) input.value = r.room?.roomName || roomName;
    toast("Room name updated ✓");
  } catch (e) {
    console.error("[ROOM-NAME] rename failed:", e);
    toast("Network error — please try again");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
});


// ===========================================================================
// COMPACT ROOM PROFILE / THREE-DOT ACTIONS — 2026-09-18
// ===========================================================================
let roomProfileHistoryPushed = false;
let roomActionsHistoryPushed = false;

function roomProfileClose(skipHistory = false) {
  const sheet = $("sheet-room-profile");
  if (!sheet) return;
  sheet.classList.add("hidden");
  sheet.setAttribute("aria-hidden", "true");
  if (!skipHistory && roomProfileHistoryPushed) {
    roomProfileHistoryPushed = false;
    if (history.state && history.state.ppRoomProfile) history.back();
  }
}
function roomActionsClose(skipHistory = false) {
  const sheet = $("sheet-room-actions");
  if (!sheet) return;
  sheet.classList.add("hidden");
  sheet.setAttribute("aria-hidden", "true");
  if (!skipHistory && roomActionsHistoryPushed) {
    roomActionsHistoryPushed = false;
    if (history.state && history.state.ppRoomActions) history.back();
  }
}
function roomProfileLogo(url) {
  const img = $("room-profile-avatar"), fallback = $("room-profile-avatar-fallback");
  if (!img || !fallback) return;
  if (url) { img.src = url; img.classList.remove("hidden"); fallback.classList.add("hidden"); }
  else { img.removeAttribute("src"); img.classList.add("hidden"); fallback.classList.remove("hidden"); }
}
function formatCompactCount(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}
async function openRoomProfileSheet() {
  if (!currentRoom) return;
  roomActionsClose();
  const room = currentRoom, sheet = $("sheet-room-profile");
  if (!sheet) return;
  $("room-profile-name").textContent = room.roomName || "Room";
  $("room-profile-id").textContent = "ID: " + (room.roomNumber || room.roomId || "—");
  $("room-profile-host").textContent = "Host: " + (room.hostName || "Host");
  $("room-profile-country").textContent = room.countryId && room.countryId !== "OTHERS" ? room.countryId : "India";
  $("room-profile-members").textContent = String((room.onlineUsers || []).filter(u => !u.hidden).length);
  $("room-profile-gifts").textContent = "0";
  $("room-profile-diamonds").textContent = "0";
  roomProfileLogo(room.logo || DEFAULT_ROOM_LOGO_URL);
  const canManage = !!me && (room.hostId === me.userId || (room.adminIds || []).includes(me.userId));
  $("room-profile-settings").classList.remove("hidden");
  $("room-profile-settings").dataset.canManage = canManage ? "1" : "0";
  $("room-action-settings").classList.remove("hidden");
  $("room-action-settings").dataset.canManage = canManage ? "1" : "0";
  sheet.classList.remove("hidden");
  sheet.setAttribute("aria-hidden", "false");
  if (!roomProfileHistoryPushed) { roomProfileHistoryPushed = true; history.pushState({ ppRoomProfile: true }, ""); }
  try {
    const r = await api("/api/room/" + encodeURIComponent(room.roomId) + "/profile");
    if (r.success && r.profile) {
      $("room-profile-gifts").textContent = formatCompactCount(r.profile.totalGifts || 0);
      $("room-profile-diamonds").textContent = formatCompactCount(r.profile.totalDiamonds || 0);
      $("room-profile-members").textContent = Number(r.profile.memberCount || 0).toLocaleString();
      roomProfileLogo(r.profile.logo || DEFAULT_ROOM_LOGO_URL);
      if (r.profile.country) $("room-profile-country").textContent = r.profile.country;
    }
  } catch (e) { console.warn("[ROOM-PROFILE] stats load failed:", e.message); }
}
function openRoomActionsSheet() {
  if (!currentRoom) return;
  roomProfileClose();
  const sheet = $("sheet-room-actions");
  if (!sheet) return;
  const canManage = !!me && (currentRoom.hostId === me.userId || (currentRoom.adminIds || []).includes(me.userId));
  $("room-action-settings").classList.remove("hidden");
  $("room-action-settings").dataset.canManage = canManage ? "1" : "0";
  sheet.classList.remove("hidden");
  sheet.setAttribute("aria-hidden", "false");
  if (!roomActionsHistoryPushed) { roomActionsHistoryPushed = true; history.pushState({ ppRoomActions: true }, ""); }
}
$("room-logo-display")?.addEventListener("click", openRoomProfileSheet);
$("room-title-block")?.addEventListener("click", openRoomProfileSheet);
$("room-host-display")?.addEventListener("click", openRoomProfileSheet);
$("btn-room-actions")?.addEventListener("click", openRoomActionsSheet);
$("room-profile-backdrop")?.addEventListener("click", roomProfileClose);
$("room-actions-backdrop")?.addEventListener("click", roomActionsClose);
$("room-profile-settings")?.addEventListener("click", () => {
  if (!currentRoom || !me) return;
  const canManage = currentRoom.hostId === me.userId || (currentRoom.adminIds || []).includes(me.userId);
  if (!canManage) { toast("Only the room owner/admin can use Settings"); return; }
  roomProfileClose(true);
  openRoomSettingsPanel();
});
$("room-action-profile")?.addEventListener("click", () => { roomActionsClose(); setTimeout(openRoomProfileSheet, 0); });
$("room-action-settings")?.addEventListener("click", () => {
  if (!currentRoom || !me) return;
  const canManage = currentRoom.hostId === me.userId || (currentRoom.adminIds || []).includes(me.userId);
  if (!canManage) { toast("Only the room owner/admin can use Settings"); return; }
  roomActionsClose(true);
  openRoomSettingsPanel();
});
$("room-action-share")?.addEventListener("click", async () => {
  if (!currentRoom?.roomId) { toast("Room is still loading"); return; }
  const shareUrl = new URL(location.href);
  shareUrl.searchParams.set("room", currentRoom.roomId);
  shareUrl.searchParams.delete("roomInvite");
  const url = shareUrl.toString();
  try {
    if (navigator.share) await navigator.share({ title: currentRoom?.roomName || "PingPong Room", text: `Join my PingPong room: ${currentRoom?.roomName || "Room"}`, url });
    else if (navigator.clipboard) { await navigator.clipboard.writeText(url); toast("Room invitation link copied ✓"); }
    else toast("Room invitation link: " + url);
  } catch (_) {}
  roomActionsClose();
});
$("room-action-leave")?.addEventListener("click", () => { roomActionsClose(); exitRoom(); });

window.addEventListener("popstate", () => {
  if (!$("sheet-room-profile")?.classList.contains("hidden")) {
    $("sheet-room-profile").classList.add("hidden");
    $("sheet-room-profile").setAttribute("aria-hidden", "true");
    roomProfileHistoryPushed = false;
    return;
  }
  if (!$("sheet-room-actions")?.classList.contains("hidden")) {
    $("sheet-room-actions").classList.add("hidden");
    $("sheet-room-actions").setAttribute("aria-hidden", "true");
    roomActionsHistoryPushed = false;
  }
});

function openRoomSettingsPanel() {
  // Bug fix: this used to fail completely silently (no toast, nothing) if
  // tapped before the room's data had finished loading over the socket —
  // which reads exactly like "the settings icon is not clickable / blocked"
  // even though the click WAS registering. Now it tells the user to wait a
  // beat instead of doing nothing.
  if (!currentRoom) { toast("Room is loading, try again in a moment"); return; }
  // BUG FIX (settings-icon-does-nothing, 2026-07-29): everything below reads
  // me.userId repeatedly. If `me` is ever null when this fires (e.g. a
  // session hiccup) this used to throw INSIDE the click handler with no
  // toast and no console-visible feedback for the user to report — it just
  // looked like the tap did nothing at all. Now: an invalid session is
  // caught explicitly up front, and anything else that goes wrong is caught
  // too, so tapping this icon can never again silently do nothing — the
  // user always gets either the panel or a clear toast telling them why not.
  if (!me) { toast("Session issue — please log in again"); showView("view-login"); return; }
  try {
    const isOwner = currentRoom.hostId === me.userId;
    const canManage = isOwner || (currentRoom.adminIds || []).includes(me.userId);
    const logoPreview = $("mod-logo-preview");
    if (logoPreview) logoPreview.src = currentRoom.logo || DEFAULT_ROOM_LOGO_URL;
    const roomNameInput = $("mod-room-name-input");
    if (roomNameInput) {
      roomNameInput.value = currentRoom.roomName || "";
      roomNameInput.disabled = !isOwner;
    }
    const roomNameSave = $("btn-mod-room-name-save");
    if (roomNameSave) roomNameSave.disabled = !isOwner;
    $("mod-room-name-section")?.classList.toggle("hidden", !isOwner);
    $("mod-room-lock-section").classList.toggle("hidden", !isOwner);
    $("mod-room-lock-toggle").checked = !!currentRoom.roomLocked;
    $("mod-room-lock-password").classList.toggle("hidden", !currentRoom.roomLocked);
    $("mod-room-lock-password").value = "";
    $("btn-open-room-theme").textContent = currentRoom.background ? "Change Room Theme" : "Choose Room Theme";
    const others = (currentRoom.onlineUsers || []).filter(u => u.userId !== me.userId);
    const kickSelect = $("mod-kick-select");
    kickSelect.innerHTML = "";
    others.filter(u => u.userId !== currentRoom.hostId).forEach(u => {
      const opt = document.createElement("option"); opt.value = u.userId; opt.textContent = u.userName; kickSelect.appendChild(opt);
    });
    const adminSelect = $("mod-admin-select");
    adminSelect.innerHTML = "";
    others.forEach(u => {
      const opt = document.createElement("option"); opt.value = u.userId; opt.textContent = u.userName; adminSelect.appendChild(opt);
    });
    renderModBulkList(others);
    seatLockButtons.forEach((b, idx) => {
      const n = idx + 1;
      b.classList.toggle("locked", (currentRoom.lockedSeats || []).includes(n));
    });
    openRoomModWithBackHandling();
  } catch (err) {
    console.error("[ROOM-MOD] error opening Room Settings:", err);
    toast("Couldn't open Settings — please try again");
  }
}

$("btn-room-mod").addEventListener("click", openRoomSettingsPanel);

// ---------------------------------------------------------------------
// Room Settings close handling.
// Fix (close/back navigation bug): previously the modal could only be
// dismissed by the small "Close" text button, and the Android
// hardware/gesture Back button navigated the whole app away from the
// room instead of just closing the modal. Now:
//   - an explicit ✕ button (top-right) always closes it
//   - opening the modal pushes one history entry, so Back closes the
//     modal first (via popstate) instead of leaving the room
//   - closing it any other way (✕ or "Close") also unwinds that
//     history entry so Back afterwards behaves normally again — the
//     modal can never get stuck open.
// ---------------------------------------------------------------------
let roomModHistoryPushed = false;
function openRoomModWithBackHandling() {
  $("modal-room-mod").classList.remove("hidden");
  if (!roomModHistoryPushed) {
    roomModHistoryPushed = true;
    history.pushState({ ppRoomMod: true }, "");
  }
}
function closeRoomMod() {
  $("modal-room-mod").classList.add("hidden");
  if (roomModHistoryPushed) {
    roomModHistoryPushed = false;
    if (history.state && history.state.ppRoomMod) history.back();
  }
}
window.addEventListener("popstate", () => {
  if (!$("modal-room-mod").classList.contains("hidden")) {
    $("modal-room-mod").classList.add("hidden");
    roomModHistoryPushed = false;
  }
});
$("btn-close-mod").addEventListener("click", closeRoomMod);
$("btn-mod-x-close").addEventListener("click", closeRoomMod);

$("btn-mod-kick").addEventListener("click", () => {
  const targetUserId = $("mod-kick-select").value;
  if (!targetUserId) return;
  socket.emit("kick-user", { roomId: currentRoomId, targetUserId });
  $("modal-room-mod").classList.add("hidden");
});
$("btn-mod-make-admin").addEventListener("click", () => {
  const targetUserId = $("mod-admin-select").value;
  if (!targetUserId) return;
  socket.emit("set-admin", { roomId: currentRoomId, targetUserId, isAdmin: true });
  toast("Made Admin");
});
$("btn-mod-remove-admin").addEventListener("click", () => {
  const targetUserId = $("mod-admin-select").value;
  if (!targetUserId) return;
  socket.emit("set-admin", { roomId: currentRoomId, targetUserId, isAdmin: false });
  toast("Admin removed");
});

// ---- Bulk moderation: multi-select users, then mute/invite/move/tag/announce ----
let selectedModTargets = new Set();
function renderModBulkList(users) {
  const list = $("mod-bulk-list");
  list.innerHTML = "";
  if (!users.length) {
    list.innerHTML = '<div class="gift-target-empty">No one else in the room</div>';
    $("mod-bulk-select-all").checked = false;
    $("mod-bulk-select-all").disabled = true;
    return;
  }
  $("mod-bulk-select-all").disabled = false;
  users.forEach((u) => {
    const row = document.createElement("label");
    row.className = "gift-target-row";
    const checked = selectedModTargets.has(u.userId) ? "checked" : "";
    row.innerHTML = `<input type="checkbox" data-userid="${u.userId}" ${checked}><span class="gift-target-user"><b>${escapeHtml(u.userName)}</b><small>ID: ${escapeHtml(u.userId)}</small></span>`;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) selectedModTargets.add(u.userId);
      else selectedModTargets.delete(u.userId);
      $("mod-bulk-select-all").checked = users.every(x => selectedModTargets.has(x.userId));
    });
    list.appendChild(row);
  });
  $("mod-bulk-select-all").checked = users.every(u => selectedModTargets.has(u.userId));
}
$("mod-bulk-select-all").addEventListener("change", (e) => {
  const others = (currentRoom?.onlineUsers || []).filter(u => u.userId !== me.userId);
  if (e.target.checked) others.forEach(u => selectedModTargets.add(u.userId));
  else selectedModTargets.clear();
  renderModBulkList(others);
});
function requireModSelection() {
  const ids = Array.from(selectedModTargets);
  if (!ids.length) toast("Select a user first");
  return ids;
}
$("btn-mod-bulk-mute").addEventListener("click", () => {
  const ids = requireModSelection();
  if (!ids.length) return;
  const minutes = parseInt($("mod-bulk-mute-minutes").value, 10) || 0;
  socket.emit("mod-mute-users", { roomId: currentRoomId, targetUserIds: ids, minutes });
  toast(minutes > 0 ? `${ids.length} user(s) muted` : `${ids.length} user(s) unmuted`);
});
$("btn-mod-bulk-invite").addEventListener("click", () => {
  const ids = requireModSelection();
  if (!ids.length) return;
  socket.emit("mod-invite-to-seat", { roomId: currentRoomId, targetUserIds: ids });
  toast("Seat invite sent");
});
$("btn-mod-bulk-audience").addEventListener("click", () => {
  const ids = requireModSelection();
  if (!ids.length) return;
  socket.emit("mod-move-to-audience", { roomId: currentRoomId, targetUserIds: ids });
  toast("Sent to Audience");
});
$("btn-mod-bulk-label").addEventListener("click", () => {
  const ids = requireModSelection();
  if (!ids.length) return;
  const text = $("mod-bulk-label-text").value;
  socket.emit("mod-label-users", { roomId: currentRoomId, targetUserIds: ids, text, color: "#F7CE7E" });
  $("mod-bulk-label-text").value = "";
  toast(text.trim() ? "Tag applied" : "Tag removed");
});
$("btn-mod-bulk-announce").addEventListener("click", () => {
  const ids = requireModSelection();
  if (!ids.length) return;
  const message = $("mod-bulk-announce-text").value.trim();
  if (!message) { toast("Write a message"); return; }
  socket.emit("mod-announce-users", { roomId: currentRoomId, targetUserIds: ids, message });
  $("mod-bulk-announce-text").value = "";
  toast("Message sent");
});

// Someone with permission invited me to a seat — accepting just runs the
// normal take-seat flow for the suggested seat number.
// (moved into connectSocket() — see the fix note there)
// Host/admin muted or unmuted me — enforce locally by forcing the mic off
// and disabling the toggle for the duration.
let hostMutedUntil = 0;
// (mod-mute-update / mod-announcement handlers moved into connectSocket())
$("mod-logo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("logo", file);
  try {
    const r = await apiUpload("/api/room/logo/upload", fd);
    if (r.success) {
      socket.emit("update-room-logo", { roomId: currentRoomId, url: r.url });
      setRoomLogo(r.url);
      roomProfileLogo(r.url);
      const preview = $("mod-logo-preview"); if (preview) preview.src = r.url;
      toast("Room Logo updated ✓");
    } else toast(r.message || "Upload failed");
  } catch (err) {
    console.error("[ROOM-LOGO] upload failed:", err);
    toast("Room Logo upload failed");
  }
});
$("btn-mod-room-logo-reset")?.addEventListener("click", async () => {
  if (!currentRoomId || !currentRoom || !me) return;
  const canManage = currentRoom.hostId === me.userId || (currentRoom.adminIds || []).includes(me.userId);
  if (!canManage) { toast("Only the room owner/admin can change the Room Logo"); return; }
  socket.emit("update-room-logo", { roomId: currentRoomId, url: DEFAULT_ROOM_LOGO_URL });
  setRoomLogo(DEFAULT_ROOM_LOGO_URL);
  roomProfileLogo(DEFAULT_ROOM_LOGO_URL);
  toast("Default Room Logo restored ✓");
});

// ---------------------------------------------------------------------------
// Room Theme (background) — Upload / Preview / Save / Cancel dialog.
// Reuses the exact same upload endpoint + socket event as before
// (/api/room/background/upload + update-room-background), so persistence
// and real-time sync are unchanged — this only adds an explicit preview +
// save step instead of applying on file-select.
// ---------------------------------------------------------------------------
let themeSelectedFile = null;
let themeSelectedLibraryUrl = null;
let themeLibraryCache = [];
function resetThemeModal() {
  themeSelectedFile = null;
  themeSelectedLibraryUrl = null;
  $("theme-file-input").value = "";
  $("theme-preview-img").style.display = "none";
  $("theme-preview-img").removeAttribute("src");
  $("theme-preview-empty").classList.remove("hidden");
  $("btn-theme-save").disabled = true;
  renderThemeLibraryGrid();
}
async function loadThemeLibrary() {
  const r = await api("/api/theme-library/list");
  if (r.success) { themeLibraryCache = r.themes; renderThemeLibraryGrid(); }
}
function renderThemeLibraryGrid() {
  const grid = $("theme-library-grid");
  const empty = $("theme-library-empty");
  if (!grid) return;
  empty.classList.toggle("hidden", themeLibraryCache.length > 0);
  grid.innerHTML = "";
  themeLibraryCache.forEach((t) => {
    const item = document.createElement("div");
    item.className = "theme-library-item" + (themeSelectedLibraryUrl === t.url ? " selected" : "");
    item.innerHTML = `<img src="${escapeHtml(t.url)}" alt=""><div class="theme-library-name">${escapeHtml(t.name)}</div>`;
    item.addEventListener("click", () => {
      themeSelectedFile = null;
      themeSelectedLibraryUrl = t.url;
      $("theme-file-input").value = "";
      $("theme-preview-img").src = t.url;
      $("theme-preview-img").style.display = "block";
      $("theme-preview-empty").classList.add("hidden");
      $("btn-theme-save").disabled = false;
      renderThemeLibraryGrid();
    });
    grid.appendChild(item);
  });
}
// (theme-library-update handler moved into connectSocket())
$("btn-open-room-theme").addEventListener("click", () => {
  closeRoomMod();
  resetThemeModal();
  loadThemeLibrary();
  $("modal-room-theme").classList.remove("hidden");
});
$("theme-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) { resetThemeModal(); return; }
  themeSelectedFile = file;
  themeSelectedLibraryUrl = null;
  const reader = new FileReader();
  reader.onload = () => {
    $("theme-preview-img").src = reader.result;
    $("theme-preview-img").style.display = "block";
    $("theme-preview-empty").classList.add("hidden");
    $("btn-theme-save").disabled = false;
    renderThemeLibraryGrid();
  };
  reader.readAsDataURL(file);
});
$("btn-theme-cancel").addEventListener("click", () => {
  resetThemeModal();
  $("modal-room-theme").classList.add("hidden");
});
$("btn-theme-save").addEventListener("click", async () => {
  if (!themeSelectedFile && !themeSelectedLibraryUrl) return;
  const btn = $("btn-theme-save");
  btn.disabled = true;
  btn.textContent = "Saving...";
  // Library pick needs no re-upload — the image is already on the server.
  if (themeSelectedLibraryUrl) {
    socket.emit("update-room-background", { roomId: currentRoomId, url: themeSelectedLibraryUrl });
    document.documentElement.style.setProperty("--user-room-theme", `url("${String(themeSelectedLibraryUrl).replace(/["\\]/g, "")}")`);
    btn.textContent = "Save";
    toast("Theme saved ✅");
    resetThemeModal();
    $("modal-room-theme").classList.add("hidden");
    return;
  }
  const fd = new FormData();
  fd.append("background", themeSelectedFile);
  const r = await apiUpload("/api/room/background/upload", fd).catch(() => ({success:false, message:"Network error. Please try again."}));
  btn.textContent = "Save";
  if (r.success) {
    socket.emit("update-room-background", { roomId: currentRoomId, url: r.url });
    document.documentElement.style.setProperty("--user-room-theme", `url("${String(r.url).replace(/["\\]/g, "")}")`);
    toast("Theme saved ✅");
    resetThemeModal();
    $("modal-room-theme").classList.add("hidden");
  } else {
    btn.disabled = false;
    toast(r.message || "Upload failed");
  }
});
$("btn-mod-clear-chat").addEventListener("click", () => {
  socket.emit("clear-chat", { roomId: currentRoomId });
  $("modal-room-mod").classList.add("hidden");
});
$("btn-mod-close-room").addEventListener("click", () => {
  if (!confirm("Close this room? Everyone will be removed.")) return;
  socket.emit("close-room", { roomId: currentRoomId });
  $("modal-room-mod").classList.add("hidden");
  closeRoomGame();
  teardownYtPlayer();
  currentRoomId = null; currentRoom = null;
  joinedRoomId = null; joinInProgress = false; pendingJoinRequest = null; // join-lifecycle guard (2026-08-14 fix)
  roomKept = false;
  updateKeptRoomPill();
  currentRelationshipLinks = [];
  saveActiveRoom(null);
  showView("view-home"); loadRoomList();
});

// ===========================================================================
// BOOTSTRAP
// ===========================================================================
// FIX (2026-07-29, login-looks-broken): this used to render a black/green
// diagnostic overlay covering up to 40% of the screen height on every
// single app load (login, refresh, reconnect — every bootstrap() call).
// It was added temporarily to trace an earlier session bug via screenshots
// and was never meant to ship — but it stayed on, so anyone opening the
// app saw a wall of debug text sitting on top of the login/home screen,
// which is very reasonably read as "the app is broken / logging me out"
// even when the actual session logic underneath was working correctly.
// Same diagnostic detail is still fully available in the browser console
// (DevTools) via the matching console.log lines throughout bootstrap() —
// this just stops it from being drawn on screen for every real user.
function showDebugBadge(text) {
  console.log("[BOOTSTRAP-DEBUG]", text);
}

// Fix (stale/incorrect session survives refresh): previously the cached
// profile in localStorage was trusted forever and used as-is — a ban, a
// deleted account, or just stale coins/diamonds would only be corrected the
// next time the user happened to open their profile screen. Now we
// re-validate against the server once on load; if the account is gone or
// banned we clear the local session and send them back to login instead of
// letting them sit in a broken half-logged-in state.
async function bootstrap() {
  console.log("[BOOTSTRAP] start");
  showDebugBadge("BOOTSTRAP start. localStorage pp_user raw = " + (localStorage.getItem("pp_user") ? "PRESENT (" + localStorage.getItem("pp_user").length + " chars)" : "MISSING") + " | pp_auth_token = " + (localStorage.getItem("pp_auth_token") ? "PRESENT" : "MISSING"));
  loadSession();
  console.log("[BOOTSTRAP] loadSession ->", me ? { mobile: me.mobile, userId: me.userId } : null);
  if (!me || !me.mobile) {
    console.log("[BOOTSTRAP] no cached session, showing login");
    showDebugBadge("RESULT: no cached session in localStorage -> showing login screen. (If you just logged in and this still says MISSING, saveSession() itself did not persist — that's the bug. If it says PRESENT here but you still see this, the account/mobile field inside it is malformed.)");
    showView("view-login");
    return;
  }

  // Fix (auto-logout-on-refresh bug): a single "not found" response used
  // to wipe the saved session immediately and bounce the user to the
  // login screen on every refresh — but that response can also happen
  // from a transient server hiccup (brief restart, momentary DB read
  // miss) and not just a genuine deletion. Now we retry once after a
  // short pause; only a session-wiping logout if the account is still
  // confirmed missing after the retry. A saved login now survives
  // refresh and stays signed in until the user explicitly logs out.
  showDebugBadge("cached session found for mobile=" + me.mobile + ", userId=" + me.userId + ". Now validating against server...");
  let r = await api("/api/user/" + me.mobile);
  console.log("[BOOTSTRAP] server validation attempt 0 ->", r);
  showDebugBadge("server validation attempt 0 -> success=" + r.success + (r.networkError ? " (networkError!)" : "") + (r.message ? " message=" + r.message : ""));
  // Bug fix (auto-logout on refresh, take 2): one retry wasn't always enough
  // — a server restart/deploy or a slow cold-start can keep failing for a
  // couple of seconds, which used to still read as "confirmed not found"
  // and log the user out. Retry a few more times with a short backoff
  // before ever concluding the account is genuinely gone, and never trust
  // a "not found" if the browser itself thinks it's currently offline.
  let attempts = 0;
  while (!r.success && !r.networkError && attempts < 3) {
    await new Promise(res => setTimeout(res, 700));
    r = await api("/api/user/" + me.mobile);
    attempts++;
    console.log(`[BOOTSTRAP] server validation retry ${attempts} ->`, r);
  }
  if (!r.success) {
    const explicitMissingAccount = /^(user|account) not found$/i.test(String(r.message || "").trim()) || r.httpStatus === 404;
    if (!explicitMissingAccount && !r.networkError && !(typeof navigator !== "undefined" && navigator.onLine === false)) {
      // A 5xx, auth middleware hiccup, malformed response, or other unexpected
      // failure is not proof that the account was deleted. Keep the persisted
      // session and let the user continue with cached state; a later request
      // can revalidate it. Only an explicit not-found response may clear it.
      console.warn("[BOOTSTRAP] server validation failed without explicit account-not-found; preserving cached session", r);
      currentRoomId = loadActiveRoomIfFresh();
      try { connectSocket(); enterApp(); }
      catch (err) { console.error("[BOOTSTRAP] error in cached-session recovery:", err); showView("view-home"); }
      return;
    }
    if (r.networkError || (typeof navigator !== "undefined" && navigator.onLine === false)) {
      // Network hiccup during boot — don't force a logout over a transient
      // error, just proceed with the cached copy.
      console.log("[BOOTSTRAP] logout decision: KEEP SESSION (network error / offline)");
      showDebugBadge("RESULT: KEEP SESSION — server call failed as a network error (not a real 'account not found'). Entering app normally.");
      // FIX (Auto-Join Room bug, 2026-07-29) + FIX (room lost on refresh,
      // 2026-07-29): loadActiveRoomIfFresh() only returns a room if it was
      // saved within the last ROOM_REJOIN_FRESHNESS_MS — i.e. this is an
      // actual refresh/reconnect, not the app being reopened long after the
      // fact. That keeps the original Auto-Join fix's intent (no silent
      // drop into a stale room) while still seamlessly restoring the room
      // for a genuine refresh, which is what the server's 8s seat grace
      // period was already designed to support.
      currentRoomId = loadActiveRoomIfFresh();
      try { connectSocket(); enterApp(); }
      catch (err) { console.error("[BOOTSTRAP] error (network-error branch), forcing Home view:", err); showView("view-home"); }
      return;
    }
    // Still not found after a retry — the server responded and confirmed
    // this account no longer exists (e.g. an admin deleted it). Don't let
    // a deleted account keep riding on stale cached session data, log it
    // out for real — UNLESS the user has explicitly turned on Logout Lock,
    // in which case honor that and keep them on the cached session instead
    // of force-logging them out on their behalf.
    if (isLogoutLockOn()) {
      console.log("[BOOTSTRAP] logout decision: KEEP SESSION (Logout Lock is ON, account reported not-found)");
      showDebugBadge("RESULT: KEEP SESSION — server said account not found, but Logout Lock is ON so staying logged in on cached data.");
      // FIX (Auto-Join Room bug, 2026-07-29) + FIX (room lost on refresh,
      // 2026-07-29): see the matching note in the network-error branch above.
      currentRoomId = loadActiveRoomIfFresh();
      try { connectSocket(); enterApp(); }
      catch (err) { console.error("[BOOTSTRAP] error (Logout Lock branch), forcing Home view:", err); showView("view-home"); }
      return;
    }
    console.log("[BOOTSTRAP] logout decision: CLEAR SESSION (account confirmed not-found after retries, Logout Lock is OFF)");
    showDebugBadge("RESULT: CLEAR SESSION AND LOG OUT — server confirmed GET /api/user/" + me.mobile + " returned 'not found' after " + attempts + " retries. THIS IS THE ACTUAL LOGOUT CAUSE if you see this line. Check the server console for a matching [SESSION-CHECK] line for this exact mobile number at this exact time.");
    clearSession("account-not-found");
    showView("view-login");
    toast("Your account could no longer be found, please log in again");
    return;
  }
  if (r.user.banned) {
    console.log("[BOOTSTRAP] logout decision: CLEAR SESSION (banned)");
    showDebugBadge("RESULT: CLEAR SESSION — server reports this account is banned.");
    clearSession("banned");
    showView("view-login");
    toast("Your account has been banned");
    return;
  }
  console.log("[BOOTSTRAP] logout decision: none, entering app normally");
  showDebugBadge("RESULT: SESSION RESTORED SUCCESSFULLY — server confirmed the account, entering app normally. If you were still bounced to login after seeing this, something later in enterApp()/connectSocket() is navigating away — tap this badge to dismiss it and check what happens next.");
  me = r.user;
  primeRoomUiConfig();
  saveSession();
  // FIX (Auto-Join Room bug, 2026-07-29): previously called
  // `currentRoomId = loadActiveRoom()` here unconditionally, which silently
  // rejoined whatever room the user was last in the moment they opened the
  // app — no tap, no confirmation, even if that was hours/days ago.
  //
  // FIX (room lost on refresh, 2026-07-29): that fix then over-corrected —
  // it also broke the case of an actual browser refresh seconds into a
  // room session, where the server's 8s seat grace period was already
  // holding the seat open and the client just never asked to go back.
  // loadActiveRoomIfFresh() resolves both: it only restores the room if
  // pp_room was saved within the last ROOM_REJOIN_FRESHNESS_MS (a real
  // refresh/reconnect gap, kept rolling by the heartbeat near
  // connectSocket()), and returns null — same as before — for a stale
  // marker from a long-since-ended session. Room membership beyond that is
  // still only ever set by joinRoom() when the user manually taps a room
  // or joins by ID (see "VOICE ROOM" section below).
  currentRoomId = loadActiveRoomIfFresh();
  //
  // FIX (refresh-logout investigation, 2026-07-29): connectSocket()/
  // enterApp() below were previously called with no try/catch. The session
  // was already fully validated and restored above at this point — but any
  // unrelated JS error inside these (a missing DOM element, a third-party
  // script race, etc.) used to leave execution stuck wherever it threw,
  // never reaching showView("view-home"). Since "view-login" is the default
  // visible section in the raw HTML, that made a perfectly valid, restored
  // session LOOK exactly like a logout — with nothing in server logs to
  // explain it, since the failure never left the browser. Now: on any such
  // error, log it clearly (browser console) and still force the Home view,
  // since `me` is already confirmed valid at this point — the user stays
  // logged in even if some secondary widget failed to render.
  try {
    connectSocket();
    enterApp();
  } catch (err) {
    console.error("[BOOTSTRAP] error after session was already validated — session is NOT cleared, forcing Home view anyway:", err);
    showView("view-home");
  }
}
bootstrap().catch((err) => {
  // Safety net (audit fix, 2026-07-29): bootstrap() already wraps its own
  // risky calls internally, but this catches anything truly unforeseen so
  // it can never surface as a silent unhandled-rejection with the user
  // stuck on whatever the raw HTML defaults to.
  console.error("[BOOTSTRAP] uncaught fatal error, forcing login screen:", err);
  const loginView = document.getElementById("view-login");
  if (loginView) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    loginView.classList.add("active");
  }
});

// ===========================================================================
// CALL HOSTING (client) — additive, see callHosting.js on the server and
// the #hostcall-overlay markup in index.html. Deliberately its own state
// (chXxx variables) and its own "hostcall:*" socket events — no line of
// the existing private-inbox call code above (currentCall/callPc/
// call:*) is read or modified. getIceServers() is reused as-is (it's a
// pure, side-effect-free fetch) per "reuse the existing WebRTC
// architecture, don't rebuild the call engine".
// ===========================================================================
let chCall = null;      // { callId, peerId, peerName, peerPhoto, type, role }
let chLocalStream = null;
let chPc = null;
let chPendingLocalIceCandidates = [];
let chPendingRemoteIceCandidates = [];
// TIMER FIX (2026-08-30): the on-screen call timer previously showed
// nothing but the server's own billing tick text, which only arrives once
// every BILL_INTERVAL_MS (60s) — see callHosting.js billOneMinute(). That
// made the timer look completely stuck at "00:00"/"Connected" for up to a
// full minute at a time instead of counting seconds. This is a real,
// independent client-side stopwatch that ticks every second from the
// moment the call actually connects; chCallConnectedAt is resynced against
// the server's authoritative elapsedSec on every hostcall:tick so the two
// can never drift apart, but the on-screen seconds no longer wait for it.
let chCallConnectedAt = null;
let chTimerInterval = null;
function chStartLocalTimer() {
  chCallConnectedAt = Date.now();
  chStopLocalTimer();
  const render = () => {
    const elapsed = Math.max(0, Math.floor((Date.now() - chCallConnectedAt) / 1000));
    const mins = Math.floor(elapsed / 60), secs = elapsed % 60;
    chSetStatusText(`${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`);
  };
  render();
  chTimerInterval = setInterval(render, 1000);
}
function chStopLocalTimer() {
  if (chTimerInterval) { clearInterval(chTimerInterval); chTimerInterval = null; }
}

async function chApplyCallButtonVisibility(userId) {
  $("btn-call-host-audio").classList.add("hidden");
  $("btn-call-host-video").classList.add("hidden");
  try {
    const r = await api("/api/call-hosting/status/" + userId);
    if (r.success && r.isHost && r.enabled && userId !== me.userId) {
      $("btn-call-host-audio").classList.remove("hidden");
      $("btn-call-host-video").classList.remove("hidden");
    }
  } catch (e) { /* fail closed — no Call button if the check fails */ }
}

// VIDEO SECURITY (best-effort): there is no web-standard API that can
// force-prevent a screenshot or screen recording — this is fundamentally
// an OS/platform capability, not something JavaScript can guarantee. If
// this app is wrapped in a native Android WebView shell, that shell can
// expose a bridge object (e.g. `window.AndroidSecureBridge.setSecure`)
// that calls WindowManager.LayoutParams.FLAG_SECURE — this hook calls it
// if present. Without a native wrapper, this only applies the browser-
// level deterrents that exist (disabling context-menu/long-press-save on
// the video element) — genuine prevention is not achievable in a plain
// browser tab, and the call is never blocked or degraded over this.
function applyHostCallSecureMode(enable) {
  try {
    if (window.AndroidSecureBridge && typeof window.AndroidSecureBridge.setSecure === "function") {
      window.AndroidSecureBridge.setSecure(enable);
    }
  } catch (e) { /* no native bridge present — best-effort only, see comment above */ }
  const remote = $("hostcall-video-remote");
  const local = $("hostcall-video-local");
  [remote, local].forEach((el) => {
    if (!el) return;
    el.oncontextmenu = enable ? (() => false) : null;
    el.style.userSelect = enable ? "none" : "";
    el.setAttribute("controlsList", enable ? "nodownload noremoteplayback" : "");
  });
}

function chShowOverlay() { $("hostcall-overlay").classList.remove("hidden"); }
function chHideOverlay() {
  $("hostcall-overlay").classList.add("hidden");
  $("hostcall-video-remote-wrap").classList.add("hidden");
  $("hostcall-incoming-actions").classList.add("hidden");
  $("hostcall-outgoing-actions").classList.add("hidden");
  $("hostcall-active-controls").classList.add("hidden");
  $("hostcall-video-remote").srcObject = null;
  $("hostcall-video-local").srcObject = null;
  $("hostcall-video-local-wrap").classList.add("hidden"); // BLACK-SCREEN FIX (2026-08-27)
  $("hostcall-billing-text").textContent = "";
}
function chSetStatusText(t) { $("hostcall-status-text").textContent = t; }

function chTeardown() {
  chStopLocalTimer();
  applyHostCallSecureMode(false);
  if (chPc) {
    try { chPc.getSenders().forEach((s) => { if (s.track) { s.track.onended = null; s.track.stop(); } }); } catch (e) {}
    chPc.onicecandidate = null; chPc.ontrack = null;
    try { chPc.close(); } catch (e) {}
    chPc = null;
  }
  if (chLocalStream) { chLocalStream.getTracks().forEach((t) => { t.onended = null; t.stop(); }); chLocalStream = null; }
  $("btn-hostcall-mute").classList.remove("active");
  chPendingLocalIceCandidates = [];
  chPendingRemoteIceCandidates = [];
  chCall = null;
  chHideOverlay();
}

async function chAcquireLocalMedia(type) {
  const stream = await acquireCallMedia(type, "user");
  chLocalStream = stream;
  if (type === "video") {
    const lv = $("hostcall-video-local");
    await attachLiveVideo(lv, stream, "hostcall local", { showWrap: $("hostcall-video-local-wrap") });
    console.debug("[call-diag] Hostcall video track settings:", stream.getVideoTracks()[0]?.getSettings?.() || {});
  }
  return stream;
}

async function chFlushRemoteIceCandidates() {
  if (!chPc || !chPc.remoteDescription || !chPendingRemoteIceCandidates.length) return;
  const pending = chPendingRemoteIceCandidates.splice(0);
  for (const candidate of pending) {
    try { await chPc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {
      console.debug("[call-diag] Hostcall queued ICE candidate rejected:", e && e.message);
    }
  }
}

function chCreatePeerConnection(iceServers) {
  const pc = new RTCPeerConnection({ iceServers });
  const sentCandidates = new Set();
  pc.onicecandidate = (e) => {
    if (!e.candidate || !chCall) return;
    const key = e.candidate.candidate;
    if (sentCandidates.has(key)) return;
    sentCandidates.add(key);
    if (!chCall.callId) {
      chPendingLocalIceCandidates.push(e.candidate);
      return;
    }
    socket.emit("hostcall:ice-candidate", { callId: chCall.callId, data: e.candidate });
  };
  // DIAGNOSTICS + ICE-RECOVERY FIX (2026-08-30): the private call:* system
  // (createPeerConnection, above) already gets startConnectionDiagnostics()
  // console logging plus a real ICE-restart-then-give-up recovery path.
  // chCreatePeerConnection (hostcall:*) never had either —
  // it only wired onicecandidate/ontrack. That gap matters a lot here:
  // chSetStatusText("Connected")/chStartLocalTimer() fire the instant
  // signaling completes (hostcall:accepted), which is BEFORE WebRTC media
  // has actually connected. If ICE then fails silently (no TURN relay
  // reachable, symmetric NAT, etc.) the UI is left showing a live, ticking
  // "Connected" call with a permanently black remote video and no audio in
  // either direction, and nothing ever retries or tells the user — which
  // matches the reported symptom exactly. This mirrors the private call's
  // recover-first pattern: one ICE restart attempt (caller side only, same
  // as the private-call system), then a real "Reconnecting..." status, and
  // only hang up if that doesn't recover within a few seconds.
  pc._diagTimer = startConnectionDiagnostics(pc, "hostcall");
  let chIceRestartTried = false;
  let chIceFailTimer = null;
  let chConnectWatchdog = setTimeout(() => {
    if (!chCall || chPc !== pc || pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") return;
    if (chCall.role === "caller" && !chIceRestartTried && chCall.callId) {
      chIceRestartTried = true;
      chSetStatusText("Reconnecting...");
      chStopLocalTimer();
      pc.createOffer({ iceRestart: true })
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => { if (chCall && chPc === pc && chCall.callId) socket.emit("hostcall:offer", { callId: chCall.callId, data: pc.localDescription }); })
        .catch(() => {});
      setTimeout(() => {
        if (chCall && chPc === pc && pc.connectionState !== "connected" && pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") {
          toast("Video connection could not be established");
          if (chCall.callId) socket.emit("hostcall:end", { callId: chCall.callId });
          chTeardown();
        }
      }, 10000);
    } else if (chCall && chPc === pc) {
      toast("Video connection could not be established");
      if (chCall.callId) socket.emit("hostcall:end", { callId: chCall.callId });
      chTeardown();
    }
  }, 20000);
  pc.oniceconnectionstatechange = () => {
    console.debug(`[call-diag] Hostcall ICE State: ${pc.iceConnectionState}`);
    if (!chCall) return;
    const state = pc.iceConnectionState;
    if (state === "connected" || state === "completed") {
      chIceRestartTried = false;
      if (chIceFailTimer) { clearTimeout(chIceFailTimer); chIceFailTimer = null; }
      if (chConnectWatchdog) { clearTimeout(chConnectWatchdog); chConnectWatchdog = null; }
      return;
    }
    if (state === "failed" || state === "disconnected") {
      if (chCall.role === "caller" && !chIceRestartTried && state === "failed" && chCall.callId) {
        chIceRestartTried = true;
        chSetStatusText("Reconnecting...");
        chStopLocalTimer();
        pc.createOffer({ iceRestart: true })
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => { if (chCall && chCall.callId) socket.emit("hostcall:offer", { callId: chCall.callId, data: pc.localDescription }); })
          .catch(() => {});
      }
      if (chIceFailTimer) clearTimeout(chIceFailTimer);
      chIceFailTimer = setTimeout(() => {
        if (chCall && (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected")) {
          toast("Call connection lost");
          if (chCall.callId) socket.emit("hostcall:end", { callId: chCall.callId });
          chTeardown();
        }
      }, 8000);
    } else if (state === "checking") {
      chStopLocalTimer(); // don't show a live 00:00-and-counting clock while media is still negotiating
    }
  };
  pc.onconnectionstatechange = () => {
    console.debug(`[call-diag] Hostcall Connection State: ${pc.connectionState}`);
    if (!chCall) return;
    if (pc.connectionState === "connecting") chSetStatusText("Reconnecting...");
    if (pc.connectionState === "connected") {
      if (chConnectWatchdog) { clearTimeout(chConnectWatchdog); chConnectWatchdog = null; }
      if (!chTimerInterval) chStartLocalTimer();
    } // media actually flowing now — (re)start the real clock
  };
  pc.ontrack = (e) => {
    const rv = $("hostcall-video-remote");
    if (!rv) return;
    const stream = streamForTrackEvent(e, rv.srcObject instanceof MediaStream ? rv.srcObject : null);
    if (rv.srcObject !== stream) rv.srcObject = stream;
    if (e.track.kind === "video" && chCall && chCall.type === "video") {
      attachLiveVideo(rv, stream, "hostcall remote", { showWrap: $("hostcall-video-remote-wrap"), muted: false });
    } else if (e.track.kind === "audio") {
      const p = rv.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  };

  return pc;
}

async function chStartCall(hostUserId, hostName, hostPhoto, type) {
  if (chCall) { toast("You're already on a call"); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Calling isn't supported on this browser"); return; }
  chCall = { callId: null, peerId: hostUserId, peerName: hostName, peerPhoto: hostPhoto, type, role: "caller" };
  $("hostcall-peer-photo").src = hostPhoto || placeholderAvatar(hostName);
  $("hostcall-peer-name").textContent = hostName;
  chSetStatusText("Calling...");
  $("hostcall-outgoing-actions").classList.remove("hidden");
  chShowOverlay();
  try {
    const iceServers = await getIceServers();
    await chAcquireLocalMedia(type);
    chPc = chCreatePeerConnection(iceServers);
    chLocalStream.getTracks().forEach((t) => chPc.addTrack(t, chLocalStream));
  } catch (e) {
    toast("Couldn't access microphone/camera");
    chTeardown();
    return;
  }
  socket.emit("hostcall:invite", { toUserId: hostUserId, callType: type });
}
$("btn-call-host-audio").addEventListener("click", () => { if (otherProfileUser) chStartCall(otherProfileUser.userId, otherProfileUser.name, otherProfileUser.photo, "audio"); });
$("btn-call-host-video").addEventListener("click", () => { if (otherProfileUser) chStartCall(otherProfileUser.userId, otherProfileUser.name, otherProfileUser.photo, "video"); });

function chShowIncoming(callId, callType, from) {
  chCall = { callId, peerId: from.userId, peerName: from.userName, peerPhoto: from.userPhoto, type: callType, role: "callee" };
  $("hostcall-peer-photo").src = from.userPhoto || placeholderAvatar(from.userName);
  $("hostcall-peer-name").textContent = from.userName;
  chSetStatusText(callType === "video" ? "Incoming video call..." : "Incoming call...");
  $("hostcall-accept-icon").src = callType === "video" ? "images/icons/icon-video-call.jpg" : "images/icons/icon-call.jpg";
  $("hostcall-incoming-actions").classList.remove("hidden");
  chShowOverlay();
}

$("btn-hostcall-reject").addEventListener("click", () => { if (chCall) socket.emit("hostcall:reject", { callId: chCall.callId }); chTeardown(); });
$("btn-hostcall-cancel").addEventListener("click", () => {
  if (chCall) socket.emit("hostcall:end", { callId: chCall.callId });
  chTeardown();
});
$("btn-hostcall-hangup").addEventListener("click", () => { if (chCall) socket.emit("hostcall:end", { callId: chCall.callId }); chTeardown(); });
$("btn-hostcall-mute").addEventListener("click", () => {
  if (!chLocalStream) return;
  const audioTrack = chLocalStream.getAudioTracks()[0];
  if (!audioTrack) return;
  audioTrack.enabled = !audioTrack.enabled;
  $("btn-hostcall-mute").classList.toggle("active", !audioTrack.enabled);
});

$("btn-hostcall-accept").addEventListener("click", async () => {
  if (!chCall) return;
  const callId = chCall.callId;
  $("hostcall-incoming-actions").classList.add("hidden");
  chSetStatusText("Connecting...");
  try {
    const iceServers = await getIceServers();
    await chAcquireLocalMedia(chCall.type);
    chPc = chCreatePeerConnection(iceServers);
    chLocalStream.getTracks().forEach((t) => chPc.addTrack(t, chLocalStream));
  } catch (e) {
    toast("Couldn't access microphone/camera");
    socket.emit("hostcall:reject", { callId });
    chTeardown();
    return;
  }
  socket.emit("hostcall:accept", { callId });
});

function chRegisterSocketHandlers() {
  socket.on("hostcall:incoming", ({ callId, callType, from, secureMode }) => {
    chShowIncoming(callId, callType, from);
    if (secureMode) applyHostCallSecureMode(true);
  });

  socket.on("hostcall:ringing", ({ host }) => chSetStatusText(`Calling ${host.userName}...`));

  socket.on("hostcall:accepted", async ({ callId, secureMode, rate }) => {
    if (!chCall || chCall.callId !== callId && chCall.callId !== null) chCall = chCall || {};
    chCall.callId = callId;
    for (const candidate of chPendingLocalIceCandidates) socket.emit("hostcall:ice-candidate", { callId, data: candidate });
    chPendingLocalIceCandidates = [];
    $("hostcall-outgoing-actions").classList.add("hidden");
    $("hostcall-incoming-actions").classList.add("hidden");
    $("hostcall-active-controls").classList.remove("hidden");
    if (rate) $("hostcall-billing-text").textContent = `${rate} Diamonds / minute`;
    if (secureMode) applyHostCallSecureMode(true);
    // Do not start the billing timer here: accepted means signaling succeeded, not media.
    // The real timer starts only from RTCPeerConnection.connectionState=connected.
    if (chCall.role === "caller" && chPc) {
      const offer = await chPc.createOffer();
      await chPc.setLocalDescription(offer);
      socket.emit("hostcall:offer", { callId, data: offer });
    }
  });

  socket.on("hostcall:offer", async ({ callId, data }) => {
    if (!chPc || !chCall || chCall.callId !== callId) return;
    await chPc.setRemoteDescription(new RTCSessionDescription(data));
    await chFlushRemoteIceCandidates();
    const answer = await chPc.createAnswer();
    await chPc.setLocalDescription(answer);
    socket.emit("hostcall:answer", { callId, data: answer });
  });

  socket.on("hostcall:answer", async ({ data }) => {
    if (!chPc) return;
    await chPc.setRemoteDescription(new RTCSessionDescription(data));
    await chFlushRemoteIceCandidates();
  });

  socket.on("hostcall:ice-candidate", async ({ data }) => {
    if (!data) return;
    if (!chPc || !chPc.remoteDescription) {
      chPendingRemoteIceCandidates.push(data);
      return;
    }
    try { await chPc.addIceCandidate(new RTCIceCandidate(data)); } catch (e) {
      console.debug("[call-diag] Hostcall ICE candidate rejected:", e && e.message);
    }
  });

  // Server-authoritative billing display (requirement #5 — client only
  // ever displays what the server already deducted, never computes it).
  socket.on("hostcall:tick", ({ diamondsCharged, balance, elapsedSec }) => {
    // TIMER FIX (2026-08-30): this used to be the ONLY thing driving the
    // on-screen timer, and it only arrives once every 60s (one billing
    // cycle) — see callHosting.js billOneMinute(). The visible clock is now
    // chStartLocalTimer()'s own 1-second interval; this handler just
    // resyncs chCallConnectedAt against the server's authoritative
    // elapsedSec (so the two never drift) and updates the Diamonds/balance
    // text, which genuinely only changes once a minute.
    if (elapsedSec != null) chCallConnectedAt = Date.now() - elapsedSec * 1000;
    if (diamondsCharged == null) return;
    $("hostcall-billing-text").textContent = `${diamondsCharged} Diamonds charged` + (balance != null ? ` · balance: ${balance}` : "");
  });

  socket.on("hostcall:low-balance-warning", () => toast("Low balance — this call may end soon"));

  socket.on("hostcall:peer-reconnecting", () => chSetStatusText("Reconnecting..."));
  socket.on("hostcall:peer-resumed", () => chSetStatusText("Connected"));

  socket.on("hostcall:ended", ({ reason }) => {
    const messages = {
      "no-answer": "No answer", "rejected": "Call declined", "cancelled": "Call cancelled",
      "ended-by-user": "Call ended", "insufficient-balance": "Call ended — insufficient balance",
      "max-duration-reached": "Call ended — maximum duration reached",
      "daily-limit-reached": "Call ended — daily limit reached",
      "call-hosting-disabled": "Call Hosting is currently disabled",
      "host-status-changed": "This host is no longer available",
      "peer-disconnected": "Call ended — connection lost", "caller-not-found": "Call ended"
    };
    toast(messages[reason] || "Call ended");
    chTeardown();
  });

  socket.on("hostcall:error", ({ code, minBalance }) => {
    const messages = {
      "already-in-call": "You're already on a call", "host-busy": "This host is on another call",
      "not-a-host": "This user isn't an approved Call Host", "call-hosting-disabled": "Call Hosting is currently disabled",
      "insufficient-balance": `You need at least ${minBalance || 0} Diamonds to start this call`,
      "host-offline": "Host is offline", "caller-not-found": "Something went wrong"
    };
    toast(messages[code] || "Couldn't start the call");
    chTeardown();
  });
}

// Discourage casual saving/dragging of decorative app imagery; this is a UX guard, not DRM.
document.addEventListener("contextmenu", e => { if (e.target && e.target.closest && e.target.closest("img")) e.preventDefault(); });
document.addEventListener("dragstart", e => { if (e.target && e.target.closest && e.target.closest("img")) e.preventDefault(); });

// ---- Room reference-UI controls (2026-10-10) ----------------------------
// Header share → reuses the existing "Share Room" action logic.
$("btn-room-share-top")?.addEventListener("click", () => $("room-action-share")?.click());
// "Come on mic and chat together~" → take the first free, unlocked seat.
$("btn-room-mic-invite")?.addEventListener("click", () => {
  if (!currentRoom || !currentRoomId) return;
  const locked = currentRoom.lockedSeats || [];
  let free = 0;
  for (let n = 1; n <= 12; n++) {
    if (!currentRoom.seats?.[n - 1] && !locked.includes(n)) { free = n; break; }
  }
  if (!free) { toast("No free seat available"); return; }
  socket.emit("take-seat", { roomId: currentRoomId, seatNumber: free });
});
// Bottom bar: gem bag → recharge (wallet), controller → room games.
$("btn-room-bag")?.addEventListener("click", () => { try { openWallet(); } catch (_) {} });
// The controller button opens the three-game picker directly from any room.
const roomGameHub = $("room-game-hub");
function closeRoomGameHub() { roomGameHub?.classList.add("hidden"); }
$("btn-room-game-quick")?.addEventListener("click", () => {
  if (!currentRoom) { toast("Enter a room first"); return; }
  roomGameHub?.classList.remove("hidden");
});
$("btn-close-game-hub")?.addEventListener("click", closeRoomGameHub);
roomGameHub?.addEventListener("click", (event) => { if (event.target === roomGameHub) closeRoomGameHub(); });
$("btn-hub-lucky-fruit")?.addEventListener("click", () => { closeRoomGameHub(); openRoomGame("foodwheel"); });
$("btn-hub-teen-patti")?.addEventListener("click", () => {
  closeRoomGameHub();
  const sheet = $("teen-patti-sheet"), frame = $("teen-patti-frame");
  sheet?.classList.add("hidden");
  if (frame) frame.src = "/games/teen-patti/index.html";
  sheet?.classList.remove("hidden");
});
$("btn-hub-rocket")?.addEventListener("click", () => {
  closeRoomGameHub();
  const modal = $("rocket-crash-modal"), frame = $("rocket-crash-frame");
  if (frame) frame.src = "/games/rocket-crash.html";
  modal?.classList.remove("hidden");
});
$("btn-hub-classic-slot")?.addEventListener("click", () => {
  closeRoomGameHub();
  const modal = $("classic-slot-sheet"), frame = $("classic-slot-frame");
  if (frame) frame.src = "/games/classic-slot/index.html";
  modal?.classList.remove("hidden");
});
function closeClassicSlot() {
  $("classic-slot-sheet")?.classList.add("hidden");
  const frame = $("classic-slot-frame");
  if (frame) frame.src = "about:blank";
}
$("btn-close-classic-slot")?.addEventListener("click", closeClassicSlot);

$("btn-hub-lucky-pro")?.addEventListener("click", () => {
  closeRoomGameHub();
  const modal = $("lucky-pro-sheet"), frame = $("lucky-pro-frame");
  if (frame) frame.src = "/games/lucky-fruit/index.html";
  modal?.classList.remove("hidden");
});
function closeLuckyPro() {
  $("lucky-pro-sheet")?.classList.add("hidden");
  const frame = $("lucky-pro-frame");
  if (frame) frame.src = "about:blank";
}
$("btn-close-lucky-pro")?.addEventListener("click", closeLuckyPro);
$("lucky-pro-sheet")?.addEventListener("click", (event) => {
  if (event.target === $("lucky-pro-sheet")) closeLuckyPro();
});
window.addEventListener("message", (event) => {
  if (event.origin === window.location.origin && event.data?.type === "pp-lucky-pro:close") closeLuckyPro();
});

$("classic-slot-sheet")?.addEventListener("click", (event) => {
  if (event.target === $("classic-slot-sheet")) closeClassicSlot();
});
window.addEventListener("message", (event) => {
  if (event.origin === window.location.origin && event.data?.type === "pp-classic-slot:close") closeClassicSlot();
});
$("room-action-keep")?.addEventListener("click", () => { try { roomActionsClose(); } catch (_) {} $("btn-leave-room")?.click(); });
