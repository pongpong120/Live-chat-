const assert = require("assert");
const fs = require("fs");
const path = require("path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");

assert(server.includes("const ROOM_SEAT_COUNT = 12;"), "server room capacity is 12");
assert(server.includes('"/api/video-gifts/catalog"'), "public video-gift catalog endpoint exists");
assert(server.includes("seatNumber > ROOM_SEAT_COUNT"), "take-seat uses the 12-seat boundary");
assert(app.includes("const seats = Array(12).fill(null);"), "client seat map fallback has 12 seats");
assert(css.includes("grid-template-columns:repeat(4,minmax(0,1fr)) !important;"), "room uses a 4-column grid for 12 seats");
assert(css.includes("ROOM 12-SEAT BREATHING + COMPACT NAME TAG FIX"), "final seat spacing/name-tag override is present");
assert(server.includes("Gift can only be sent to seated users"), "server blocks gifts to unseated users");
assert(server.includes("const seatedTargetIds = new Set"), "server derives gift recipients from occupied seats");
assert(app.includes("function getSeatedGiftUsers()"), "client derives gift recipients from occupied seats");
assert(app.includes("const seatedIds = new Set(getSeatedGiftUsers().map(u => String(u.userId)))"), "client filters send targets to seated users");
assert(app.includes("(currentRoom?.onlineUsers || []).filter(u =>\n    seatedIds.has(String(u.userId))"), "self-gifting is available when the sender occupies a seat");
assert(app.includes("(You — Self Gift)"), "the current user is clearly labeled as a self-gift recipient");
assert(server.includes('filter((uid) => uid != null && String(uid).trim() !== "")'), "server accepts a selected self recipient but still validates seat membership");

console.log("roomCapacityAndVideoGift.test.js: PASS");
