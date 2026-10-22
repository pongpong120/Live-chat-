const assert = require("assert");
const fs = require("fs");
const path = require("path");

const publicApp = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const publicIndex = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
const adminApp = fs.readFileSync(path.join(__dirname, "..", "admin", "app.js"), "utf8");
const adminIndex = fs.readFileSync(path.join(__dirname, "..", "admin", "index.html"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

assert(publicIndex.includes('id="gift-tabs"'));
assert(publicIndex.includes('data-category="customize"'));
assert(publicApp.includes('api("/api/video-gifts/catalog?ts=" + Date.now())'));
assert(publicApp.includes('sendVideoGift(selectedVideoGiftId)'));
assert(adminIndex.includes('value="video">Custom Video Gift'));
assert(adminApp.includes('/api/admin/gifts/upload'));
assert(server.includes('app.post("/api/admin/video-gifts/upload"'));
assert(server.includes('videoGiftCatalog.push(gift)'));
assert(server.includes('broadcastVideoGiftCatalog()'));
assert(!adminIndex.includes('value="legend">Legend'));
assert(!adminIndex.includes('value="vip">VIP'));
assert(!adminApp.includes('gift-tier'));
assert(!publicApp.includes('if ((g?.tier || "normal") === "vip")'));
assert(!publicApp.includes('if ((g?.tier || "normal") === "legend")'));
assert(publicIndex.includes('id="room-online-count-value"'));
assert(publicIndex.includes('id="private-message-indicator"'));

console.log("currentGiftBox.test.js: PASS");
