const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const adminApp = fs.readFileSync(path.join(root, "admin", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");

assert(server.includes('const VIDEO_GIFT_CATEGORIES = new Set(["gift", "lucky", "cp", "svip", "country", "customize"])'), "Video Gift categories are supported");
assert(server.includes('const category = VIDEO_GIFT_CATEGORIES.has(rawCategory) ? rawCategory : "customize";'), "Video Gift category is preserved and defaults to Customize");
assert(server.includes('giftType: "video"'), "Video Gifts keep explicit video type");
assert(server.includes('function publicVideoGiftCatalog()'), "Customize catalog endpoint is present");
assert(server.includes('const giftType = String(req.body?.giftType || "image").toLowerCase() === "video" ? "video" : "image";'), "Gift Manager supports unified Video Gift creation");
assert(server.includes('uploadGiftAssets.fields([{ name: "image", maxCount: 1 }, { name: "sound", maxCount: 1 }, { name: "video", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }])'), "Unified Gift Manager accepts video and thumbnail uploads");
assert(app.includes('String(g.category || "customize").toLowerCase() === "customize"'), "Gift Box Customize renders only Customize video gifts");
assert(app.includes('giftCategory(g) === activeGiftTier'), "Category-assigned video gifts render in their selected Gift Box section");
assert(adminApp.includes('const giftTypeSelect = $("gift-type")'), "Control Panel Gift Manager has unified gift type selector");
assert(adminApp.includes('Custom Video Gift added to Customize'), "Control Panel publishes Video Gifts to Customize");
assert(app.includes('/api/video-gifts/catalog?ts='), "Customize tab refreshes the authoritative video catalog");
assert(css.includes('width:32px!important') && css.includes('height:32px!important'), "Room message icon is reduced to 32px");
assert(css.includes('width:18px!important') && css.includes('height:18px!important'), "Room message icon image is reduced further");

console.log("customizeVideoGiftAndMessageIcon.test.js: PASS");
