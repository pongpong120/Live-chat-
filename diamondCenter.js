
// ================================================================
// DIAMOND CENTER — Seller/Reseller Diamond Distribution
// Diamond-only. No Coins are created, credited, deducted, or referenced.
// Admin creates a Center against an existing User ID. That user then
// gets a "Diamond Center" entry in the app and can distribute Diamonds
// to another User ID against a configured INR recharge package.
// Center inventory is the only funding source for a distribution.
// ================================================================
const path = require("path");
const crypto = require("crypto");

function initDiamondCenter(deps) {
  const {
    app, DATA_FOLDER, safeRead, safeWrite,
    users, findUserByUserId, saveUsers,
    clampDiamondBalance, logTransaction, pushWalletUpdate,
    userAuth, rbac, requireAdmin, requirePermission, reqUserAgent,
    actorCanAccessCountry, countryDeniedResponse, svip
  } = deps;

  const CENTERS_FILE = path.join(DATA_FOLDER, "diamond_centers.json");
  const TX_FILE = path.join(DATA_FOLDER, "diamond_center_transactions.json");

  const centers = safeRead(CENTERS_FILE, {});
  const transactions = safeRead(TX_FILE, []);

  const MAX_BONUS_PERCENT = 20;
  const MAX_PACKAGE_PRICE = 100000000;
  const MAX_PACKAGE_DIAMONDS = 10000000000;
  const MAX_CENTER_BALANCE = 10000000000;

  const cleanId = (v) => String(v || "").trim();
  const num = (v) => Number(v);

  function persist() {
    safeWrite(CENTERS_FILE, centers);
    safeWrite(TX_FILE, transactions);
  }

  function owner(actor) {
    return actor && actor.role === rbac.ROLES.OWNER;
  }

  function actorTag(req) {
    return { id: req.adminAccount.id, username: req.adminAccount.username };
  }

  function getCenter(userId) {
    return centers[cleanId(userId)] || null;
  }

  function publicCenter(c) {
    const found = findUserByUserId(c.userId);
    const u = found && found.user;
    return {
      userId: c.userId,
      userName: u ? (u.name || u.userId) : "Unknown User",
      avatar: u ? (u.photo || "") : "",
      country: u ? (u.country || "") : "",
      enabled: !!c.enabled,
      balanceDiamonds: Number(c.balanceDiamonds || 0),
      bonusPercent: Number(c.bonusPercent || 0),
      packages: (c.packages || []).map(p => ({
        id: p.id, priceINR: p.priceINR, diamonds: p.diamonds,
        label: p.label || ""
      })),
      totalRechargeCount: Number(c.totalRechargeCount || 0),
      totalDiamondsDistributed: Number(c.totalDiamondsDistributed || 0),
      totalBonusDiamonds: Number(c.totalBonusDiamonds || 0),
      createdAt: c.createdAt
    };
  }

  function validatePackage(priceINR, diamonds, label) {
    priceINR = Math.floor(num(priceINR));
    diamonds = Math.floor(num(diamonds));
    if (!Number.isSafeInteger(priceINR) || priceINR <= 0 || priceINR > MAX_PACKAGE_PRICE) return "Invalid INR amount";
    if (!Number.isSafeInteger(diamonds) || diamonds <= 0 || diamonds > MAX_PACKAGE_DIAMONDS) return "Invalid Diamond amount";
    return { priceINR, diamonds, label: String(label || "").trim().slice(0, 80) };
  }

  // Custom recharge uses the Party canonical rate: ₹1 = 10,000 Coins.
  // Exact configured packages still win.
  // This lets a Center recharge ANY whole-rupee amount without allowing the
  // client to invent a Diamond price/rate.
  function resolveRechargePackage(center, requestedPriceINR, packageId) {
    const activePackages = (center.packages || []).filter(p => p && p.active !== false);
    const requested = requestedPriceINR === undefined || requestedPriceINR === null || requestedPriceINR === ""
      ? null : Math.floor(num(requestedPriceINR));

    if (packageId) {
      const exactById = activePackages.find(p => p.id === packageId);
      if (exactById) return {
        priceINR: Math.floor(Number(exactById.priceINR)),
        baseDiamonds: Math.floor(Number(exactById.diamonds)),
        packageId: exactById.id,
        custom: false
      };
    }

    if (!Number.isSafeInteger(requested) || requested <= 0 || requested > MAX_PACKAGE_PRICE) {
      return { error: "Enter a valid recharge amount" };
    }

    const exact = activePackages.find(p => Math.floor(Number(p.priceINR)) === requested);
    if (exact) return {
      priceINR: requested,
      baseDiamonds: Math.floor(Number(exact.diamonds)),
      packageId: exact.id,
      custom: false
    };

    // Prefer the Party ₹1 = 10,000 Coins rate. If an admin removed that package,
    // fall back to the lowest configured active package so custom recharge
    // remains deterministic and admin-controlled.
    const base = activePackages.find(p => Math.floor(Number(p.priceINR)) === 300) ||
      activePackages.slice().sort((a, b) => Number(a.priceINR) - Number(b.priceINR))[0];
    if (!base) return { error: "No active recharge package is configured in this Diamond Center" };

    const basePrice = Math.floor(Number(base.priceINR));
    const baseDiamonds = Math.floor(Number(base.diamonds));
    if (!Number.isSafeInteger(basePrice) || basePrice <= 0 ||
        !Number.isSafeInteger(baseDiamonds) || baseDiamonds <= 0) {
      return { error: "Diamond Center base recharge package is invalid" };
    }

    // Floor keeps the server authoritative and guarantees we never mint a
    // fractional Coin. Example: ₹150 at the Party rate => 1,500,000 Coins.
    const customDiamonds = Math.floor((requested * baseDiamonds) / basePrice);
    if (!Number.isSafeInteger(customDiamonds) || customDiamonds <= 0 || customDiamonds > MAX_PACKAGE_DIAMONDS) {
      return { error: "Recharge amount is too small for the configured Diamond rate" };
    }
    return {
      priceINR: requested,
      baseDiamonds: customDiamonds,
      packageId: base.id,
      custom: true,
      rateBasePriceINR: basePrice,
      rateBaseDiamonds: baseDiamonds
    };
  }

  function addTx(tx) {
    transactions.push(tx);
    if (transactions.length > 100000) transactions.splice(0, transactions.length - 100000);
  }

  // ---------------- PUBLIC USER API ----------------
  // Must be registered before /api/wallet/:userId.
  app.get("/api/diamond-center/status", userAuth.requireUserAuth, (req, res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({ success: false, message: "Unauthorized" });
    const c = getCenter(found.userId);
    if (!c || !c.enabled) return res.json({ success: true, enabled: false });
    res.json({ success: true, enabled: true, center: publicCenter(c) });
  });

  app.get("/api/diamond-center/me", userAuth.requireUserAuth, (req, res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({ success: false, message: "Unauthorized" });
    const c = getCenter(found.userId);
    if (!c || !c.enabled) return res.json({ success: false, message: "Diamond Center is not assigned to this account" });
    const history = transactions.filter(t => t.centerUserId === found.userId).slice(-100).reverse();
    res.json({ success: true, center: publicCenter(c), history });
  });

  app.post("/api/diamond-center/recharge", userAuth.requireUserAuth, (req, res) => {
    const mobile = req.authedMobile;
    const sellerFound = mobile ? users[mobile] : null;
    if (!sellerFound) return res.status(401).json({ success: false, message: "Unauthorized" });

    const center = getCenter(sellerFound.userId);
    if (!center || !center.enabled) return res.status(403).json({ success: false, message: "Diamond Center is not active" });

    const targetUserId = cleanId(req.body && req.body.targetUserId);
    const packageId = cleanId(req.body && req.body.packageId);
    const requestedPriceINR = req.body && req.body.priceINR !== undefined ? Math.floor(num(req.body.priceINR)) : null;
    if (!targetUserId) return res.json({ success: false, message: "Enter a target User ID" });

    // A Center owner is allowed to recharge ANY valid User ID, including
    // their own ID. The Center inventory is still the sole funding source,
    // so self-recharge cannot mint Diamonds.
    const targetFound = findUserByUserId(targetUserId);
    if (!targetFound || !targetFound.user) return res.json({ success: false, message: "Target User ID not found" });

    const resolved = resolveRechargePackage(center, requestedPriceINR, packageId);
    if (resolved.error) return res.json({ success: false, message: resolved.error });

    const priceINR = resolved.priceINR;
    const baseDiamonds = resolved.baseDiamonds;
    const bonusPercent = Math.min(MAX_BONUS_PERCENT, Math.max(0, Number(center.bonusPercent) || 0));
    const bonusDiamonds = Math.floor(baseDiamonds * bonusPercent / 100);
    const totalDiamonds = baseDiamonds + bonusDiamonds;

    if (!Number.isSafeInteger(totalDiamonds) || totalDiamonds <= 0) return res.json({ success: false, message: "Invalid Diamond calculation" });
    const centerBalance = Math.floor(Number(center.balanceDiamonds) || 0);
    if (centerBalance < totalDiamonds) return res.json({ success: false, message: `Not enough Center Diamonds. Need ${totalDiamonds.toLocaleString()}.` });

    // Atomic-in-process mutation: deduct Center inventory first, then credit
    // the target. If the target disappears, no deduction is committed.
    const target = targetFound.user;
    const oldTarget = Math.floor(Number(target.diamonds) || 0);
    const newTarget = clampDiamondBalance(target.userId, oldTarget + totalDiamonds, "diamond-center-recharge");
    if (newTarget - oldTarget !== totalDiamonds) return res.json({ success: false, message: "Diamond balance ceiling reached for target user" });

    center.balanceDiamonds = centerBalance - totalDiamonds;
    target.diamonds = newTarget;
    center.totalRechargeCount = Number(center.totalRechargeCount || 0) + 1;
    center.totalDiamondsDistributed = Number(center.totalDiamondsDistributed || 0) + totalDiamonds;
    center.totalBonusDiamonds = Number(center.totalBonusDiamonds || 0) + bonusDiamonds;

    const id = "dct_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
    addTx({
      id, type: "recharge", status: "completed",
      centerUserId: sellerFound.userId, targetUserId: target.userId,
      priceINR, baseDiamonds, bonusPercent, bonusDiamonds, totalDiamonds,
      packageId: resolved.packageId,
      customAmount: !!resolved.custom,
      rateBasePriceINR: resolved.rateBasePriceINR || priceINR,
      rateBaseDiamonds: resolved.rateBaseDiamonds || baseDiamonds,
      time: new Date().toISOString()
    });

    saveUsers();
    persist();
    logTransaction(target.userId, "diamonds", totalDiamonds,
      `Diamond Center recharge ₹${priceINR} by ${sellerFound.userId} (base ${baseDiamonds}, bonus ${bonusPercent}%)`);
    pushWalletUpdate(target.userId);
    pushWalletUpdate(sellerFound.userId);
    // Diamond Center recharge is a real Diamond credit, so it contributes
    // to the same cumulative SVIP recharge total.
    if (svip && typeof svip.recordRecharge === "function") {
      svip.recordRecharge(target.userId, totalDiamonds, id, "diamond-center");
    }

    res.json({ success: true, transaction: {
      id, targetUserId: target.userId, priceINR, baseDiamonds, bonusPercent, bonusDiamonds, totalDiamonds,
      packageId: resolved.packageId, customAmount: !!resolved.custom,
      rateBasePriceINR: resolved.rateBasePriceINR || priceINR,
      rateBaseDiamonds: resolved.rateBaseDiamonds || baseDiamonds
    }, center: publicCenter(center) });
  });

  // ---------------- ADMIN ----------------
  app.get("/api/admin/diamond-centers", requireAdmin, requirePermission("diamond-center:view"), (req, res) => {
    const list = Object.values(centers).map(publicCenter).sort((a,b) => String(a.userName).localeCompare(String(b.userName)));
    res.json({ success: true, centers: list });
  });

  app.post("/api/admin/diamond-centers/create", requireAdmin, requirePermission("diamond-center:manage"), (req, res) => {
    const userId = cleanId(req.body && req.body.userId);
    const found = findUserByUserId(userId);
    if (!found || !found.user) return res.json({ success: false, message: "User ID not found" });
    if (centers[userId]) return res.json({ success: false, message: "Diamond Center already exists for this user" });

    const bonusPercent = Number(req.body && req.body.bonusPercent);
    const packagesInput = Array.isArray(req.body && req.body.packages) ? req.body.packages : [];
    const packages = [];
    for (const raw of packagesInput) {
      const v = validatePackage(raw.priceINR, raw.diamonds, raw.label);
      if (typeof v === "string") return res.json({ success: false, message: v });
      packages.push({ id: "pkg_" + crypto.randomBytes(5).toString("hex"), ...v, active: true });
    }
    if (!packages.length) packages.push({ id: "pkg_default_100_1m", priceINR: 100, diamonds: 1000000, label: "₹100 • 1,000,000 Coins • Custom amount supported", active: true });

    centers[userId] = {
      userId, enabled: true, balanceDiamonds: 0,
      bonusPercent: Math.min(MAX_BONUS_PERCENT, Math.max(0, Number.isFinite(bonusPercent) ? bonusPercent : 0)),
      packages, totalRechargeCount: 0, totalDiamondsDistributed: 0, totalBonusDiamonds: 0,
      createdAt: new Date().toISOString(),
      createdBy: actorTag(req)
    };
    persist();
    rbac.logAction({ admin: req.adminAccount, action: "diamond-center-create", module: "diamond-center", targetType: "user", targetId: userId, after: publicCenter(centers[userId]), ip: req.ip, userAgent: reqUserAgent(req) });
    res.json({ success: true, center: publicCenter(centers[userId]) });
  });

  app.put("/api/admin/diamond-centers/:userId/settings", requireAdmin, requirePermission("diamond-center:manage"), (req, res) => {
    const userId = cleanId(req.params.userId);
    const c = getCenter(userId);
    if (!c) return res.json({ success: false, message: "Diamond Center not found" });
    if (req.body && req.body.enabled !== undefined) c.enabled = !!req.body.enabled;
    if (req.body && req.body.bonusPercent !== undefined) {
      const n = Number(req.body.bonusPercent);
      if (!Number.isFinite(n) || n < 0 || n > MAX_BONUS_PERCENT) return res.json({ success: false, message: `Bonus must be 0-${MAX_BONUS_PERCENT}%` });
      c.bonusPercent = n;
    }
    if (Array.isArray(req.body && req.body.packages)) {
      const out = [];
      for (const raw of req.body.packages) {
        const v = validatePackage(raw.priceINR, raw.diamonds, raw.label);
        if (typeof v === "string") return res.json({ success: false, message: v });
        out.push({ id: cleanId(raw.id) || "pkg_" + crypto.randomBytes(5).toString("hex"), ...v, active: raw.active !== false });
      }
      if (!out.length) return res.json({ success: false, message: "At least one recharge package is required" });
      c.packages = out;
    }
    persist();
    rbac.logAction({ admin: req.adminAccount, action: "diamond-center-settings", module: "diamond-center", targetType: "user", targetId: userId, after: publicCenter(c), ip: req.ip, userAgent: reqUserAgent(req) });
    res.json({ success: true, center: publicCenter(c) });
  });

  app.post("/api/admin/diamond-centers/:userId/topup", requireAdmin, requirePermission("diamond-center:topup"), (req, res) => {
    const userId = cleanId(req.params.userId);
    const c = getCenter(userId);
    if (!c) return res.json({ success: false, message: "Diamond Center not found" });
    const amount = Math.floor(num(req.body && req.body.diamonds));
    if (!Number.isSafeInteger(amount) || amount <= 0) return res.json({ success: false, message: "Enter a valid Diamond amount" });
    const before = Math.floor(Number(c.balanceDiamonds) || 0);
    const after = before + amount;
    if (after > MAX_CENTER_BALANCE) return res.json({ success: false, message: "Center Diamond balance ceiling reached" });
    c.balanceDiamonds = after;
    const id = "dct_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
    addTx({ id, type: "center_topup", status: "completed", centerUserId: userId, targetUserId: null, diamonds: amount, balanceAfter: after, time: new Date().toISOString(), admin: actorTag(req) });
    persist();
    rbac.logAction({ admin: req.adminAccount, action: "diamond-center-topup", module: "diamond-center", targetType: "user", targetId: userId, after: { diamonds: amount, balanceAfter: after }, ip: req.ip, userAgent: reqUserAgent(req) });
    res.json({ success: true, center: publicCenter(c) });
  });

  app.post("/api/admin/diamond-centers/:userId/remove", requireAdmin, requirePermission("diamond-center:manage"), (req, res) => {
    const userId = cleanId(req.params.userId);
    const c = getCenter(userId);
    if (!c) return res.json({ success: false, message: "Diamond Center not found" });
    c.enabled = false;
    persist();
    rbac.logAction({ admin: req.adminAccount, action: "diamond-center-disable", module: "diamond-center", targetType: "user", targetId: userId, ip: req.ip, userAgent: reqUserAgent(req) });
    res.json({ success: true });
  });

  app.get("/api/admin/diamond-centers/:userId/history", requireAdmin, requirePermission("diamond-center:view"), (req, res) => {
    const userId = cleanId(req.params.userId);
    res.json({ success: true, history: transactions.filter(t => t.centerUserId === userId).slice(-500).reverse() });
  });
}

module.exports = { initDiamondCenter };
