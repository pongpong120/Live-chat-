"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { listPackages, getPackage } = require("../payments/packages");

const root = path.join(__dirname, "..");
const walletUi = fs.readFileSync(path.join(root, "public/wallet-ui.html"), "utf8");
const appJs = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const rechargeService = fs.readFileSync(path.join(root, "wallet/rechargeService.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const helperSource = fs.readFileSync(path.join(root, "public/recharge-package-state.js"), "utf8");

const context = { globalThis: {}, console };
vm.createContext(context);
vm.runInContext(helperSource, context);
const pkgState = context.globalThis.PingPongRechargePackage;

function ok(condition, message) { assert.ok(condition, message); console.log("PASS:", message); }

console.log("=== Recharge amount persistence regression suite ===");
const expected = [
  ["pkg_fixed_100", 100, 1000000],
  ["pkg_fixed_250", 250, 2600000],
  ["pkg_fixed_500", 500, 5200000],
  ["pkg_fixed_1000", 1000, 11200000]
];
for (const [id, price, diamonds] of expected) {
  const p = getPackage(id);
  ok(p && p.priceINR === price && p.diamonds === diamonds, `${id}: ₹${price} -> ${diamonds.toLocaleString("en-IN")} diamonds`);
}
ok(listPackages().length === 4, "authoritative recharge catalog contains exactly four fixed packages");

// Executable lifecycle regression: select ₹250 -> persist ID -> create a new
// state instance (simulated unmount/remount) -> restore the exact package.
const memoryStorage = {
  data: new Map(),
  getItem(k) { return this.data.get(k) || null; },
  setItem(k, v) { this.data.set(k, String(v)); }
};
const packages = listPackages();
const selected250 = pkgState.persistSelectedPackage(packages.find(p => p.id === "pkg_fixed_250"), "u-regression", memoryStorage);
ok(selected250 && selected250.id === "pkg_fixed_250" && selected250.priceINR === 250, "selecting ₹250 stores the package ID and numeric ₹250 price");
const remounted = pkgState.restoreSelectedPackage(packages, "u-regression", memoryStorage);
ok(remounted && remounted.id === "pkg_fixed_250" && remounted.priceINR === 250 && remounted.diamonds === 2600000, "unmount/remount restores ₹250 and 2,600,000 diamonds");

const switched = pkgState.persistSelectedPackage(packages.find(p => p.id === "pkg_fixed_1000"), "u-regression", memoryStorage);
const remountedAgain = pkgState.restoreSelectedPackage(packages, "u-regression", memoryStorage);
ok(switched.id === "pkg_fixed_1000" && remountedAgain.id === "pkg_fixed_1000" && remountedAgain.priceINR === 1000 && remountedAgain.diamonds === 11200000, "repeated package switching remains synchronized after remount");

const invalid = pkgState.persistSelectedPackage({ id: "bad", priceINR: "", diamonds: "" }, "u-regression", memoryStorage);
ok(invalid === null, "missing/invalid amount is rejected instead of becoming ₹0");
ok(pkgState.restoreSelectedPackage([{ id: "bad", priceINR: 0, diamonds: 100 }], "u-regression", memoryStorage) === null, "an invalid package list never produces a fake zero-price selection");

ok(walletUi.includes("pingpong:selected-recharge:"), "selected package is persisted per user in sessionStorage");
ok(walletUi.includes("restoreSelectedPackage(valid,userId,sessionStorage)"), "async package loading restores the saved selection only after valid packages arrive");
ok(walletUi.includes("const pkg=H.find(x=>x.id===C.id)"), "payment order resolves the package by ID, never by display amount");
ok(walletUi.includes("/payment-data"), "manual UPI launch fetches server-generated payment data");
ok(walletUi.includes("d.upiLink"), "client launches only the server-provided encoded UPI link");
ok(!walletUi.includes('const q=new URLSearchParams({pa:"labib3@axl"'), "client no longer constructs the UPI amount/link itself");
ok(!walletUi.includes("Pay exactly ₹0"), "wallet UI has no hard-coded zero payment amount");
ok(rechargeService.includes("upiId: \"labib3@axl\""), "development/manual UPI destination is configured to the supplied UPI ID");
ok(rechargeService.includes('require("../payments/packages").getPackage'), "manual recharge validates package IDs against the authoritative catalog");
ok(!indexHtml.includes('id="recharge-pay-qr"'), "legacy Recharge modal no longer renders a manual QR section");
ok(appJs.includes("/api/wallet/recharge/order/${orderRes.transaction.id}/payment-data"), "legacy Recharge modal fetches server payment data");

console.log("ALL RECHARGE AMOUNT REGRESSION CHECKS PASSED");
