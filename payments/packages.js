'use strict';
// Single trusted source of truth for gateway recharge packages.
// Approved values (owner-confirmed 2026-10-14) — do not change, round or reinterpret.
// Used by PhonePe, Cashfree, the manual UPI flow display, and the tests.
// Prices are integer INR; amounts sent to providers are derived from these
// values on the server and NEVER from client input.

const PACKAGES = Object.freeze([
  Object.freeze({ id: 'pkg_fixed_100',  name: 'Starter Pack', priceINR: 100,  diamonds: 1000000 }),
  Object.freeze({ id: 'pkg_fixed_250',  name: 'Popular Pack', priceINR: 250,  diamonds: 2600000 }),
  Object.freeze({ id: 'pkg_fixed_500',  name: 'Premium Pack', priceINR: 500,  diamonds: 5200000 }),
  Object.freeze({ id: 'pkg_fixed_1000', name: 'Mega Pack',    priceINR: 1000, diamonds: 11200000 })
]);

const BY_ID = new Map(PACKAGES.map((p) => [p.id, p]));

function listPackages() { return PACKAGES.map((p) => ({ ...p })); }
function getPackage(id) {
  const p = BY_ID.get(String(id));
  return p ? { ...p } : null;
}
function isFixedPackageId(id) { return BY_ID.has(String(id)); }
// INR (integer rupees) -> paise (integer) for providers that need it.
function toPaise(priceINR) { return Math.round(Number(priceINR) * 100); }

module.exports = { PACKAGES, listPackages, getPackage, isFixedPackageId, toPaise };
