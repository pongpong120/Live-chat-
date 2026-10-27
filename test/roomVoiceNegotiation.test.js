// test/roomVoiceNegotiation.test.js
// Regression coverage for room mesh audio negotiation. This suite tests the
// actual transceiver helper extracted from public/app.js with a small fake
// RTCPeerConnection, and guards the offer/answer handlers against regressing
// to addTrack()-based duplicate audio sections.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0;
let fail = 0;
function assert(condition, message) {
  if (condition) { pass++; console.log("  ✓", message); }
  else { fail++; console.error("  ✗ FAIL:", message); }
}

const appPath = path.join(__dirname, "..", "public", "app.js");
const source = fs.readFileSync(appPath, "utf8");
const helperStart = source.indexOf("function ensureRoomAudioTransceiver(pc) {");
const helperEnd = source.indexOf("\nfunction getOrCreatePeer(", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "audio transceiver helper exists before peer creation");

if (helperStart >= 0 && helperEnd > helperStart) {
  const helperSource = source.slice(helperStart, helperEnd);
  const context = {};
  vm.runInNewContext(helperSource + "\nthis.ensureRoomAudioTransceiver = ensureRoomAudioTransceiver;", context);

  function fakePeer() {
    return {
      transceivers: [],
      getTransceivers() { return this.transceivers; },
      addTransceiver(kind, options) {
        const sender = {
          track: null,
          replaceTrack(track) { this.track = track; return Promise.resolve(); }
        };
        const transceiver = {
          direction: options.direction,
          sender,
          receiver: { track: { kind } }
        };
        this.transceivers.push(transceiver);
        return transceiver;
      }
    };
  }

  // Audience-created offer: the peer has no microphone, but its offer must
  // still include an audio m-line and remain able to receive the speaker.
  const audiencePc = fakePeer();
  const audienceTransceiver = context.ensureRoomAudioTransceiver(audiencePc);
  assert(audienceTransceiver.direction === "sendrecv", "audience-created offer reserves a receive-capable audio m-line");
  assert(audienceTransceiver.sender.track === null, "audience transceiver does not publish a microphone by default");

  // Speaker-created offer: attach the microphone to that same audio sender.
  const speakerPc = fakePeer();
  const speakerTransceiver = context.ensureRoomAudioTransceiver(speakerPc);
  const microphone = { kind: "audio", readyState: "live" };
  speakerTransceiver.sender.replaceTrack(microphone);
  assert(speakerTransceiver.sender.track === microphone, "seated speaker publishes through the reserved audio sender");

  // Both peers later transition roles on an existing connection. The helper
  // must reuse the existing transceiver, not create a second audio m-line.
  const reused = context.ensureRoomAudioTransceiver(speakerPc);
  assert(reused === speakerTransceiver, "seat/audience transition reuses the same transceiver");
  assert(speakerPc.transceivers.length === 1, "only one audio transceiver exists per peer connection");
}

// The actual peer creation and offer handler must use the reserved sender.
// This guards both initial offer directions and incoming offer handling.
const peerStart = source.indexOf("function getOrCreatePeer(remoteSocketId) {");
const peerEnd = source.indexOf("\nasync function connectToPeer(", peerStart);
const peerSource = source.slice(peerStart, peerEnd);
const offerStart = source.indexOf('socket.on("voice-offer", async (data) => {');
const answerStart = source.indexOf('socket.on("voice-answer", async (data) => {', offerStart);
const offerSource = source.slice(offerStart, answerStart);
assert(peerSource.includes("ensureRoomAudioTransceiver(pc)"), "peer creation ensures audio transceiver before initial offer");
assert(!peerSource.includes("pc.addTrack("), "peer creation cannot add a duplicate audio transceiver with addTrack");
assert(offerSource.includes("pc._ppVoiceAudioTransceiver") && offerSource.includes("audioSender.replaceTrack(audioTrack)"), "incoming offers reuse the existing audio sender");
assert(offerSource.includes("pc.createAnswer()"), "answer direction still generates an SDP answer");
assert(source.includes('socket.on("voice-answer", async (data) => {'), "answer handler remains wired for speaker- and audience-created offers");

// TURN availability is environment-dependent; the code must preserve the
// configured ICE path, while the staged-mode request must be room-aware.
const modeStart = source.indexOf("async function refreshVoiceMode()");
const modeEnd = source.indexOf("\nfunction connectSocket(", modeStart);
const modeSource = source.slice(modeStart, modeEnd);
assert(modeSource.includes("encodeURIComponent(currentRoomId)"), "staged voice-mode lookup includes the current room ID");
assert(modeSource.includes("data.effectiveVoiceMode || data.voiceMode"), "staged voice-mode lookup honors the room's effective mode");
assert(source.includes("await primeRoomIceServers();"), "mesh microphone setup still primes configured ICE/TURN servers");

console.log(`\nRoom voice negotiation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
