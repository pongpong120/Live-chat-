const fs = require("fs");
const assert = require("assert");

const server = fs.readFileSync("server.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/style.css", "utf8");

assert(server.includes('app.post("/api/room/create", userAuth.requireUserAuth, async (req, res) => {'));
assert(server.includes("withRoomCreateLock(userId"));
assert(server.includes('const existing = Object.values(rooms).find((r) => r.hostId === userId);'));
assert(server.includes('app.post("/api/room/rename", userAuth.requireUserAuth'));
assert(server.includes("room.hostId !== actor.userId"));

assert(html.includes('id="mod-room-name-input"'));
assert(html.includes('id="btn-mod-room-name-save"'));
assert(app.includes('api("/api/room/rename", "POST"'));
assert(app.includes('function closeProfileVisitors()'));
assert(app.includes('e.stopPropagation();'));
assert(app.includes('@${escapeHtml(data.toName || "User")}'));
assert(css.includes("#modal-profile-visitors{z-index:1200;pointer-events:auto}"));

console.log("roomPremiumFinalFix: PASS");
