const assert = require("assert");
const fs = require("fs");
const server = fs.readFileSync("server.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const admin = fs.readFileSync("admin/app.js", "utf8");
const html = fs.readFileSync("admin/index.html", "utf8");

assert(server.includes('const VIDEO_GIFT_CATEGORIES = new Set(["gift", "lucky", "cp", "svip", "country", "customize"])'), "video gift categories exist");
assert(server.includes('const category = VIDEO_GIFT_CATEGORIES.has(rawCategory) ? rawCategory : "customize";'), "video gift category is preserved");
assert(server.includes('unitPrice: quantity > 0 ? Math.floor(diamondAmount / quantity) : 0'), "profile gift history exposes unit price");
assert(app.includes('This gift: ${unitPrice.toLocaleString()}'), "Gift Box shows unit gift amount");
assert(app.includes('Send total: ${total.toLocaleString()}'), "Gift Box shows total send amount");
assert(app.includes('const qtyBurst = qty >= 1717 ? 12'), "repeat gifts render a visible staggered burst");
assert(admin.includes('const category = $("vgift-category")?.value || "customize";'), "admin Video Gifts category is submitted");
assert(html.includes('id="vgift-category"'), "admin Video Gifts category selector exists");
console.log("giftVideoCategoryAndAmount.test.js: PASS");
