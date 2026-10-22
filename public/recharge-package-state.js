(function (root) {
  "use strict";
  function normalizeRechargePackage(u) {
    if (!u || u.id == null) return null;
    const id = String(u.id);
    const price = Number(u.priceINR);
    const diamonds = Number(u.diamonds);
    const bonus = Number(u.bonusDiamonds ?? 0);
    if (!id || !Number.isFinite(price) || price <= 0 || !Number.isInteger(price) ||
        !Number.isFinite(diamonds) || diamonds <= 0 || !Number.isInteger(diamonds) ||
        !Number.isFinite(bonus) || bonus < 0 || !Number.isInteger(bonus)) return null;
    return { ...u, id, priceINR: price, diamonds, bonusDiamonds: bonus,
      totalDiamonds: diamonds + bonus, price, label: String(u.label || u.name || "Package") };
  }
  function storageKey(userId) { return `pingpong:selected-recharge:${userId || "guest"}`; }
  function restoreSelectedPackage(packages, userId, storage) {
    const valid = (Array.isArray(packages) ? packages : []).map(normalizeRechargePackage).filter(Boolean);
    if (!valid.length) return null;
    let savedId = "";
    try { savedId = storage.getItem(storageKey(userId)) || ""; } catch (_) {}
    const selected = valid.find(p => p.id === savedId) || valid[0];
    try { storage.setItem(storageKey(userId), selected.id); } catch (_) {}
    return selected;
  }
  function persistSelectedPackage(pkg, userId, storage) {
    const valid = normalizeRechargePackage(pkg);
    if (!valid) return null;
    try { storage.setItem(storageKey(userId), valid.id); } catch (_) {}
    return valid;
  }
  root.PingPongRechargePackage = { normalizeRechargePackage, storageKey, restoreSelectedPackage, persistSelectedPackage };
})(typeof window !== "undefined" ? window : globalThis);
