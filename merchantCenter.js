// ================================================================
// MERCHANT CENTER — Merchant -> Seller hierarchy
// ================================================================
// A merchant is linked to one real PingPong User ID. Each merchant can have
// at most 10 subordinate sellers. Merchant inventory is funded only from the
// Control Panel. Seller inventory is funded only by its parent merchant.
// Sellers can then sell Diamonds into the normal user wallet.
//
// This module is intentionally separate from the legacy Diamond Center so
// existing Diamond Center accounts/routes remain backward compatible.
// ================================================================
const path = require("path");
const crypto = require("crypto");

function initMerchantCenter(deps) {
  const {
    app, DATA_FOLDER, safeRead, safeWrite,
    users, findUserByUserId, saveUsers,
    clampDiamondBalance, logTransaction, pushWalletUpdate,
    userAuth, rbac, requireAdmin, requirePermission, reqUserAgent,
    actorCanAccessCountry, countryDeniedResponse, merchantRegistry,
    emitToUser
  } = deps;

  const SELLERS_FILE = path.join(DATA_FOLDER, "merchant_sellers.json");
  const TX_FILE = path.join(DATA_FOLDER, "merchant_transactions.json");
  const ACTIONS_FILE = path.join(DATA_FOLDER, "merchant_actions.json");
  const sellers = safeRead(SELLERS_FILE, {});
  const transactions = safeRead(TX_FILE, []);
  const actions = safeRead(ACTIONS_FILE, {});

  const MAX_SELLERS = 10;
  const MAX_BALANCE = 10000000000;
  const MAX_SALE = 10000000000;
  const RATE_PRICE_INR = 1;
  const RATE_DIAMONDS = 10000;

  function diamondsForINR(amountINR) {
    const amount = Math.floor(Number(amountINR));
    if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
    return Math.floor(amount * RATE_DIAMONDS);
  }

  function clean(v) { return String(v || "").trim(); }
  function actorTag(req) { return { id: req.adminAccount.id, username: req.adminAccount.username }; }

  function save() {
    safeWrite(SELLERS_FILE, sellers);
    safeWrite(TX_FILE, transactions);
    safeWrite(ACTIONS_FILE, actions);
  }

  function currentMonthKey() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
  }

  function getUnbanUsage(merchantId) {
    const month = currentMonthKey();
    const key = `${merchantId}:${month}`;
    if (!actions[key]) actions[key] = { merchantId, month, unbans: 0 };
    return actions[key];
  }

  function addTx(tx) {
    transactions.push(tx);
    if (transactions.length > 100000) transactions.splice(0, transactions.length - 100000);
  }

  // Merchant inventory is a separate balance from the user's normal wallet.
  // Push it explicitly so the Merchant/Seller Center on the recipient device
  // can update immediately after a parent-Merchant top-up.
  function pushCenterBalance(userId, merchantId) {
    if (!emitToUser || !userId) return;
    const center = publicUserCenter(userId);
    if (!center) return;
    emitToUser(userId, "merchant-center-balance-update", {
      merchantId: merchantId || center.merchant?.id || null,
      role: center.role,
      merchant: center.merchant ? publicMerchant(center.merchant) : null,
      seller: center.seller ? publicSeller(center.seller) : null
    });
  }

  function getMerchant(merchantId) {
    return merchantRegistry && merchantRegistry.describe(merchantId);
  }

  function merchantSellers(merchantId) {
    return Object.values(sellers)
      .filter(s => s.merchantId === merchantId && s.status === "active")
      .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  function findSellerByUserId(userId) {
    return Object.values(sellers).find(s => s.userId === userId && s.status === "active") || null;
  }

  function addBadge(userId, badgeId) {
    const found = findUserByUserId(userId);
    if (!found || !found.user) return false;
    const u = found.user;
    u.activeBadges = Array.isArray(u.activeBadges) ? u.activeBadges : [];
    if (!u.activeBadges.includes(badgeId)) u.activeBadges.push(badgeId);
    saveUsers();
    if (emitToUser) emitToUser(userId, "user_badges_update", { userId, activeBadges: u.activeBadges });
    return true;
  }

  function removeBadge(userId, badgeId) {
    const found = findUserByUserId(userId);
    if (!found || !found.user) return false;
    const u = found.user;
    u.activeBadges = Array.isArray(u.activeBadges) ? u.activeBadges.filter(x => x !== badgeId) : [];
    saveUsers();
    if (emitToUser) emitToUser(userId, "user_badges_update", { userId, activeBadges: u.activeBadges });
    return true;
  }

  function publicSeller(s) {
    const found = findUserByUserId(s.userId);
    const u = found && found.user;
    return {
      sellerId: s.sellerId,
      merchantId: s.merchantId,
      userId: s.userId,
      userName: u ? (u.name || u.userId) : "Unknown User",
      avatar: u ? (u.photo || "") : "",
      countryId: u ? (u.countryId || "OTHERS") : "OTHERS",
      status: s.status,
      enabled: s.status === "active",
      balanceDiamonds: Number(s.balanceDiamonds || 0),
      totalReceivedFromMerchant: Number(s.totalReceivedFromMerchant || 0),
      totalDiamondsSold: Number(s.totalDiamondsSold || 0),
      totalSalesCount: Number(s.totalSalesCount || 0),
      createdAt: s.createdAt
    };
  }

  function publicMerchant(m) {
    if (!m) return null;
    const found = m.userId ? findUserByUserId(m.userId) : null;
    const u = found && found.user;
    return {
      id: m.id,
      name: m.name,
      userId: m.userId || null,
      userName: u ? (u.name || u.userId) : null,
      avatar: u ? (u.photo || "") : "",
      countryId: m.countryId,
      status: m.status,
      balanceDiamonds: Number(m.balanceDiamonds || 0),
      totalDiamondsFunded: Number(m.totalDiamondsFunded || 0),
      totalDiamondsToSellers: Number(m.totalDiamondsToSellers || 0),
      totalDiamondsSold: Number(m.totalDiamondsSold || 0),
      totalSalesCount: Number(m.totalSalesCount || 0),
      sellerCount: merchantSellers(m.id).length,
      maxSellers: MAX_SELLERS,
      createdAt: m.createdAt
    };
  }

  function adminScope(req, m) {
    return !!m && actorCanAccessCountry(req.adminAccount, m.countryId);
  }

  function ensureUser(userId) {
    const found = findUserByUserId(clean(userId));
    return found && found.user ? found.user : null;
  }

  // ---------------- PUBLIC USER CENTER ----------------
  function getCenterForUser(userId) {
    const uid = clean(userId);
    const merchants = merchantRegistry ? merchantRegistry._store.getAll() : {};
    const merchant = Object.values(merchants).find(m => m.userId === uid) || null;
    if (merchant) {
      return { role: "merchant", merchant, seller: null };
    }
    const seller = findSellerByUserId(uid);
    if (seller) {
      return { role: "seller", merchant: getMerchant(seller.merchantId), seller };
    }
    return null;
  }

  function publicUserCenter(uid) {
    const ctx = getCenterForUser(uid);
    if (!ctx || !ctx.merchant) return null;
    const recent = transactions.filter(t =>
      t.merchantId === ctx.merchant.id && t.type === "seller_sale" && t.targetUserId
    ).filter(t => ctx.role === "seller" ? t.sellerUserId === ctx.seller.userId : true)
      .slice(-100).reverse();
    const out = {
      role: ctx.role,
      merchant: publicMerchant(ctx.merchant),
      seller: ctx.seller ? publicSeller(ctx.seller) : null,
      sellers: ctx.role === "merchant" ? merchantSellers(ctx.merchant.id).map(publicSeller) : [],
      history: recent
    };
    return out;
  }

  app.get("/api/merchant-center/status", userAuth.requireUserAuth, (req,res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({ success:false, message:"Unauthorized" });
    const ctx = getCenterForUser(found.userId);
    res.json({ success:true, enabled:!!ctx, role:ctx ? ctx.role : null });
  });

  app.get("/api/merchant-center/me", userAuth.requireUserAuth, (req,res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({ success:false, message:"Unauthorized" });
    const center = publicUserCenter(found.userId);
    if (!center) return res.json({ success:false, message:"Merchant Center is not assigned to this account" });
    res.json({ success:true, ...center });
  });

  // ---------------- MERCHANT OWNER CONTROLS ----------------
  // These actions are deliberately authenticated as the Merchant owner, not
  // as a Control Panel admin. Seller creation/top-up never creates Diamonds;
  // it only moves the Merchant's existing inventory into Seller inventory.
  app.post("/api/merchant-center/sellers", userAuth.requireUserAuth, (req,res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({success:false,message:"Unauthorized"});
    const ctx = getCenterForUser(found.userId);
    if (!ctx || ctx.role !== "merchant" || !ctx.merchant || ctx.merchant.status !== "active") {
      return res.status(403).json({success:false,message:"Only an active Merchant can create Sellers"});
    }
    const current = merchantSellers(ctx.merchant.id);
    if (current.length >= MAX_SELLERS) return res.json({success:false,message:`A Merchant can have maximum ${MAX_SELLERS} Sellers`});
    const userId = clean(req.body && req.body.userId);
    if (!userId) return res.json({success:false,message:"Provide Seller User ID"});
    if (userId === ctx.merchant.userId) return res.json({success:false,message:"Merchant owner cannot be added as their own Seller"});
    const u = ensureUser(userId);
    if (!u) return res.json({success:false,message:"Seller User ID not found"});
    if (u.countryId !== ctx.merchant.countryId) return res.json({success:false,message:"Seller must belong to the Merchant's country"});
    if (findSellerByUserId(userId)) return res.json({success:false,message:"This user is already a Merchant Seller"});
    const sellerId = "msl_" + crypto.randomBytes(7).toString("hex");
    sellers[sellerId] = {
      sellerId, merchantId:ctx.merchant.id, userId, status:"active",
      balanceDiamonds:0, autoSellerTag:true, totalReceivedFromMerchant:0,
      totalDiamondsSold:0, totalSalesCount:0, createdAt:new Date().toISOString(),
      createdBy:{ merchantUserId:ctx.merchant.userId }
    };
    addBadge(userId,"seller_tag");
    addTx({ id:"mct_"+Date.now().toString(36)+"_"+crypto.randomBytes(4).toString("hex"),
      type:"merchant_seller_create", status:"completed", merchantId:ctx.merchant.id,
      sellerId, sellerUserId:userId, targetUserId:null, diamonds:0,
      time:new Date().toISOString(), merchantUserId:ctx.merchant.userId });
    save();
    // The newly-created Seller immediately receives Seller Center access.
    pushCenterBalance(userId, ctx.merchant.id);
    res.json({success:true,seller:publicSeller(sellers[sellerId]),sellerCount:merchantSellers(ctx.merchant.id).length,maxSellers:MAX_SELLERS,center:publicUserCenter(found.userId)});
  });

  app.post("/api/merchant-center/sellers/:sellerId/topup", userAuth.requireUserAuth, (req,res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({success:false,message:"Unauthorized"});
    const ctx = getCenterForUser(found.userId);
    if (!ctx || ctx.role !== "merchant" || !ctx.merchant || ctx.merchant.status !== "active") {
      return res.status(403).json({success:false,message:"Only an active Merchant can top up Sellers"});
    }
    const s = sellers[req.params.sellerId];
    if (!s || s.merchantId !== ctx.merchant.id || s.status !== "active") return res.status(404).json({success:false,message:"Seller not found"});
    const amountINR = Math.floor(Number(req.body && (req.body.amountINR ?? req.body.priceINR)));
    const amount = diamondsForINR(amountINR);
    if (!Number.isSafeInteger(amountINR) || amountINR <= 0 || amount <= 0) return res.json({success:false,message:"Enter a valid INR amount"});
    const mb = Math.floor(Number(ctx.merchant.balanceDiamonds)||0);
    if (mb < amount) return res.json({success:false,message:`Merchant balance is insufficient. Need ${amount.toLocaleString()}.`});
    const sb = Math.floor(Number(s.balanceDiamonds)||0);
    if (sb + amount > MAX_BALANCE) return res.json({success:false,message:"Seller Diamond balance ceiling reached"});
    ctx.merchant.balanceDiamonds = mb - amount;
    s.balanceDiamonds = sb + amount;
    s.totalReceivedFromMerchant = Number(s.totalReceivedFromMerchant||0) + amount;
    ctx.merchant.totalDiamondsToSellers = Number(ctx.merchant.totalDiamondsToSellers||0) + amount;
    const id = "mct_"+Date.now().toString(36)+"_"+crypto.randomBytes(4).toString("hex");
    addTx({id,type:"merchant_seller_topup",status:"completed",merchantId:ctx.merchant.id,sellerId:s.sellerId,sellerUserId:s.userId,targetUserId:null,amountINR,priceINR:amountINR,ratePriceINR:RATE_PRICE_INR,rateDiamonds:RATE_DIAMONDS,diamonds:amount,merchantBalanceAfter:ctx.merchant.balanceDiamonds,sellerBalanceAfter:s.balanceDiamonds,time:new Date().toISOString(),merchantUserId:ctx.merchant.userId});
    merchantRegistry._store.set(ctx.merchant.id,ctx.merchant);
    save();
    pushCenterBalance(ctx.merchant.userId, ctx.merchant.id);
    pushCenterBalance(s.userId, ctx.merchant.id);
    res.json({success:true,amountINR,diamonds:amount,merchant:publicMerchant(ctx.merchant),seller:publicSeller(s),center:publicUserCenter(found.userId)});
  });

  app.post("/api/merchant-center/unban", userAuth.requireUserAuth, (req,res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({success:false,message:"Unauthorized"});
    const ctx = getCenterForUser(found.userId);
    if (!ctx || ctx.role !== "merchant" || !ctx.merchant || ctx.merchant.status !== "active") {
      return res.status(403).json({success:false,message:"Only an active Merchant can unban users"});
    }
    const usage = getUnbanUsage(ctx.merchant.id);
    const used = Number(usage.unbans||0);
    const limit = 10;
    if (used >= limit) return res.json({success:false,message:"Monthly unban limit reached (10 IDs)",unbanUsed:used,unbanLimit:limit,unbanRemaining:0,month:usage.month});
    const targetUserId = clean(req.body && req.body.targetUserId);
    if (!targetUserId) return res.json({success:false,message:"Provide User ID to unban"});
    const target = ensureUser(targetUserId);
    if (!target) return res.json({success:false,message:"User ID not found"});
    if ((target.countryId || "OTHERS") !== (ctx.merchant.countryId || "OTHERS")) return res.json({success:false,message:"User must belong to the Merchant's country"});
    if (!target.banned) return res.json({success:false,message:"This User ID is not currently banned"});
    target.banned = false;
    saveUsers();
    usage.unbans = used + 1;
    actions[`${ctx.merchant.id}:${usage.month}`] = usage;
    const id = "mct_"+Date.now().toString(36)+"_"+crypto.randomBytes(4).toString("hex");
    addTx({id,type:"merchant_unban",status:"completed",merchantId:ctx.merchant.id,sellerId:null,sellerUserId:null,targetUserId:target.userId,diamonds:0,time:new Date().toISOString(),merchantUserId:ctx.merchant.userId,month:usage.month,unbanNumber:usage.unbans});
    save();
    if (emitToUser) emitToUser(target.userId,"account-unbanned",{userId:target.userId,by:"merchant"});
    res.json({success:true,targetUserId:target.userId,unbanUsed:usage.unbans,unbanLimit:limit,unbanRemaining:Math.max(0,limit-usage.unbans),month:usage.month,center:publicUserCenter(found.userId)});
  });

  app.get("/api/merchant-center/unban-status", userAuth.requireUserAuth, (req,res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({success:false,message:"Unauthorized"});
    const ctx = getCenterForUser(found.userId);
    if (!ctx || ctx.role !== "merchant" || !ctx.merchant) return res.status(403).json({success:false,message:"Merchant Center is not active"});
    const usage = getUnbanUsage(ctx.merchant.id);
    const used = Number(usage.unbans||0);
    res.json({success:true,month:usage.month,unbanUsed:used,unbanLimit:10,unbanRemaining:Math.max(0,10-used)});
  });

  // Merchant owner or any active subordinate seller can sell Diamonds to a
  // normal user. Inventory is always deducted before the target is credited.
  app.post("/api/merchant-center/sell", userAuth.requireUserAuth, (req,res) => {
    const mobile = req.authedMobile;
    const found = mobile ? users[mobile] : null;
    if (!found) return res.status(401).json({ success:false, message:"Unauthorized" });

    const ctx = getCenterForUser(found.userId);
    if (!ctx || !ctx.merchant || ctx.merchant.status !== "active") {
      return res.status(403).json({ success:false, message:"Merchant Center is not active" });
    }

    const targetUserId = clean(req.body && req.body.targetUserId);
    const priceINR = Math.floor(Number(req.body && req.body.priceINR));
    if (!targetUserId) return res.json({success:false,message:"Enter a target User ID"});
    if (!Number.isSafeInteger(priceINR) || priceINR <= 0) {
      return res.json({success:false,message:"Enter a valid recharge amount in INR"});
    }
    const amount = Math.floor((priceINR * RATE_DIAMONDS) / RATE_PRICE_INR);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_SALE) {
      return res.json({success:false,message:"Recharge amount is outside the supported Diamond range"});
    }
    const targetFound = ensureUser(targetUserId);
    if (!targetFound) return res.json({ success:false, message:"Target User ID not found" });

    let walletOwner = ctx.role === "seller" ? ctx.seller : ctx.merchant;
    const oldBalance = Math.floor(Number(walletOwner.balanceDiamonds) || 0);
    if (oldBalance < amount) return res.json({ success:false, message:`Not enough Diamonds. Need ${amount.toLocaleString()}.` });

    const oldTarget = Math.floor(Number(targetFound.diamonds) || 0);
    const newTarget = clampDiamondBalance(targetFound.userId, oldTarget + amount, "merchant-center-sale");
    if (newTarget - oldTarget !== amount) {
      return res.json({ success:false, message:"Target user's Diamond balance ceiling was reached" });
    }

    walletOwner.balanceDiamonds = oldBalance - amount;
    targetFound.diamonds = newTarget;
    saveUsers();
    if (ctx.role === "seller") {
      ctx.seller.totalDiamondsSold = Number(ctx.seller.totalDiamondsSold || 0) + amount;
      ctx.seller.totalSalesCount = Number(ctx.seller.totalSalesCount || 0) + 1;
    }
    ctx.merchant.totalDiamondsSold = Number(ctx.merchant.totalDiamondsSold || 0) + amount;
    ctx.merchant.totalSalesCount = Number(ctx.merchant.totalSalesCount || 0) + 1;

    const id = "mct_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
    addTx({
      id, type:"seller_sale", status:"completed",
      merchantId:ctx.merchant.id, sellerId:ctx.role === "seller" ? ctx.seller.sellerId : null,
      sellerUserId:ctx.role === "seller" ? ctx.seller.userId : ctx.merchant.userId,
      targetUserId:targetFound.userId, priceINR, ratePriceINR:RATE_PRICE_INR,
      rateDiamonds:RATE_DIAMONDS, diamonds:amount, balanceAfter:walletOwner.balanceDiamonds,
      time:new Date().toISOString()
    });
    saveUsers();
    merchantRegistry._store.set(ctx.merchant.id, ctx.merchant);
    save();
    pushCenterBalance(ctx.merchant.userId, ctx.merchant.id);
    pushCenterBalance(ctx.seller ? ctx.seller.userId : ctx.merchant.userId, ctx.merchant.id);
    logTransaction(targetFound.userId, "diamonds", amount,
      `Merchant Center sale ${id} by ${ctx.role === "seller" ? ctx.seller.userId : ctx.merchant.userId}`);
    pushWalletUpdate(targetFound.userId);
    pushWalletUpdate(found.userId);

    res.json({ success:true, transaction:{id,targetUserId:targetFound.userId,priceINR,ratePriceINR:RATE_PRICE_INR,rateDiamonds:RATE_DIAMONDS,diamonds:amount}, center:publicUserCenter(found.userId) });
  });

  // ---------------- ADMIN / CONTROL PANEL ----------------
  app.get("/api/admin/merchants/:merchantId/dashboard", requireAdmin, requirePermission("merchant:view"), (req,res) => {
    const m = getMerchant(req.params.merchantId);
    if (!m) return res.status(404).json({success:false,message:"Merchant not found"});
    if (!adminScope(req,m)) return countryDeniedResponse(res);
    res.json({
      success:true,
      merchant:publicMerchant(m),
      sellers:merchantSellers(m.id).map(publicSeller),
      // Admin dashboard history follows the same user-delivery rule as the
      // user-facing Center: internal Merchant funding/control actions are not
      // shown in the history feed.
      history:transactions.filter(t => t.merchantId === m.id && t.type === "seller_sale" && t.targetUserId).slice(-500).reverse()
    });
  });

  app.post("/api/admin/merchants/:merchantId/balance", requireAdmin, requirePermission("merchant:manage"), (req,res) => {
    const m = getMerchant(req.params.merchantId);
    if (!m) return res.status(404).json({success:false,message:"Merchant not found"});
    if (!adminScope(req,m)) return countryDeniedResponse(res);
    const amountINR = Math.floor(Number(req.body && (req.body.amountINR ?? req.body.priceINR)));
    const amount = diamondsForINR(amountINR);
    const mode = clean(req.body && req.body.mode) || "add";
    if (!Number.isSafeInteger(amountINR) || amountINR < 0 || (amountINR > 0 && amount <= 0)) return res.json({success:false,message:"Enter a valid INR amount"});
    const before = Math.floor(Number(m.balanceDiamonds) || 0);
    const after = mode === "set" ? amount : before + amount;
    if (after > MAX_BALANCE) return res.json({success:false,message:"Merchant Diamond balance ceiling reached"});
    m.balanceDiamonds = after;
    if (mode !== "set") m.totalDiamondsFunded = Number(m.totalDiamondsFunded || 0) + amount;
    const id = "mct_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
    addTx({
      id, type: mode === "set" ? "merchant_balance_set" : "merchant_topup",
      status:"completed", merchantId:m.id, sellerId:null, sellerUserId:null,
      targetUserId:null, diamonds:amount, balanceBefore:before, balanceAfter:after,
      amountINR, priceINR:amountINR, ratePriceINR:RATE_PRICE_INR, rateDiamonds:RATE_DIAMONDS,
      time:new Date().toISOString(), admin:actorTag(req)
    });
    merchantRegistry._store.set(m.id,m);
    save();
    pushCenterBalance(m.userId, m.id);
    rbac.logAction({admin:req.adminAccount,action:"merchant-balance-update",module:"merchant",targetType:"merchant",targetId:m.id,after:{mode,amountINR,diamonds:amount,balanceAfter:after},ip:req.ip,userAgent:reqUserAgent(req)});
    res.json({success:true,amountINR,diamonds:amount,merchant:publicMerchant(m)});
  });

  app.post("/api/admin/merchants/:merchantId/sellers", requireAdmin, requirePermission("merchant:manage"), (req,res) => {
    const m = getMerchant(req.params.merchantId);
    if (!m) return res.status(404).json({success:false,message:"Merchant not found"});
    if (!adminScope(req,m)) return countryDeniedResponse(res);
    const current = merchantSellers(m.id);
    if (current.length >= MAX_SELLERS) return res.json({success:false,message:`A Merchant can have maximum ${MAX_SELLERS} Sellers`});

    const userId = clean(req.body && req.body.userId);
    if (!userId) return res.json({success:false,message:"Provide Seller User ID"});
    const u = ensureUser(userId);
    if (!u) return res.json({success:false,message:"Seller User ID not found"});
    if (u.countryId !== m.countryId) return res.json({success:false,message:"Seller must belong to the Merchant's country"});
    if (findSellerByUserId(userId)) return res.json({success:false,message:"This user is already a Merchant Seller"});

    const sellerId = "msl_" + crypto.randomBytes(7).toString("hex");
    sellers[sellerId] = {
      sellerId, merchantId:m.id, userId,
      status:"active", balanceDiamonds:0, autoSellerTag:true,
      totalReceivedFromMerchant:0, totalDiamondsSold:0, totalSalesCount:0,
      createdAt:new Date().toISOString(), createdBy:actorTag(req)
    };
    addBadge(userId,"seller_tag");
    save();
    pushCenterBalance(userId, m.id);
    rbac.logAction({admin:req.adminAccount,action:"merchant-seller-create",module:"merchant",targetType:"merchant-seller",targetId:sellerId,after:publicSeller(sellers[sellerId]),ip:req.ip,userAgent:reqUserAgent(req)});
    res.json({success:true,seller:publicSeller(sellers[sellerId]),sellerCount:merchantSellers(m.id).length,maxSellers:MAX_SELLERS});
  });

  app.get("/api/admin/merchants/:merchantId/sellers/daily-report/pdf", requireAdmin, requirePermission("merchant:view"), (req,res) => {
    const m = getMerchant(req.params.merchantId);
    if (!m) return res.status(404).send("Merchant not found");
    if (!adminScope(req,m)) return countryDeniedResponse(res);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query && req.query.date || ""))
      ? String(req.query.date) : new Date().toISOString().slice(0,10);
    const start = new Date(`${date}T00:00:00.000Z`).getTime(), end = start + 86400000;
    const allSellerRows = Object.values(sellers).filter(s => s.merchantId === m.id)
      .sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt));
    const lines = [
      `Merchant: ${m.name} | Merchant ID: ${m.id}`,
      `Report Date (UTC): ${date}`,
      `Rate: INR ${RATE_PRICE_INR} = ${RATE_DIAMONDS.toLocaleString()} Diamonds`,
      `Seller Count: ${allSellerRows.length}`, "", "SELLER DAILY RECHARGE SUMMARY",
      "Seller ID | User ID | Status | Recharge Count | INR Total | Diamonds Delivered"
    ];
    allSellerRows.forEach(s => {
      const txs = transactions.filter(t => t.merchantId === m.id && t.type === "seller_sale" &&
        t.sellerUserId === s.userId && new Date(t.time).getTime() >= start && new Date(t.time).getTime() < end);
      const inr = txs.reduce((n,t) => n + Math.max(0, Number(t.priceINR)||0), 0);
      const diamonds = txs.reduce((n,t) => n + Math.max(0, Number(t.diamonds)||0), 0);
      lines.push(`${s.sellerId} | ${s.userId} | ${s.status} | ${txs.length} | INR ${inr.toLocaleString()} | ${diamonds.toLocaleString()} Diamonds`);
    });
    lines.push("", "TRANSACTION DETAILS", "Time | Seller | Target User | Amount INR | Diamonds");
    transactions.filter(t => t.merchantId === m.id && t.type === "seller_sale" &&
      new Date(t.time).getTime() >= start && new Date(t.time).getTime() < end)
      .sort((a,b)=>new Date(a.time)-new Date(b.time))
      .forEach(t => lines.push(`${new Date(t.time).toISOString()} | ${t.sellerUserId||"-"} | ${t.targetUserId||"-"} | INR ${Number(t.priceINR||0).toLocaleString()} | ${Number(t.diamonds||0).toLocaleString()}`));
    const pdf = makePdf(`PingPong Seller Daily Recharge Report — ${date}`, lines);
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",`attachment; filename="merchant-${m.id}-seller-daily-${date}.pdf"`);
    res.send(pdf);
  });

  app.post("/api/admin/merchants/:merchantId/sellers/:sellerId/topup", requireAdmin, requirePermission("merchant:manage"), (req,res) => {
    return res.status(403).json({success:false,message:"Seller balance can only be topped up by the Merchant from Merchant Center"});
  });

  app.post("/api/admin/merchants/:merchantId/sellers/:sellerId/remove", requireAdmin, requirePermission("merchant:manage"), (req,res) => {
    const m = getMerchant(req.params.merchantId);
    if (!m) return res.status(404).json({success:false,message:"Merchant not found"});
    if (!adminScope(req,m)) return countryDeniedResponse(res);
    const s = sellers[req.params.sellerId];
    if (!s || s.merchantId !== m.id) return res.status(404).json({success:false,message:"Seller not found"});
    const refund = Math.floor(Number(s.balanceDiamonds)||0);
    const mb = Math.floor(Number(m.balanceDiamonds)||0);
    if (mb + refund > MAX_BALANCE) return res.json({success:false,message:"Merchant balance ceiling reached"});
    m.balanceDiamonds = mb + refund;
    s.status = "removed";
    s.removedAt = new Date().toISOString();
    if (refund > 0) {
      addTx({id:"mct_"+Date.now().toString(36)+"_"+crypto.randomBytes(4).toString("hex"),type:"seller_balance_return",status:"completed",merchantId:m.id,sellerId:s.sellerId,sellerUserId:s.userId,targetUserId:null,diamonds:refund,merchantBalanceAfter:m.balanceDiamonds,time:new Date().toISOString(),admin:actorTag(req)});
    }
    if (s.autoSellerTag) removeBadge(s.userId,"seller_tag");
    merchantRegistry._store.set(m.id,m); save();
    rbac.logAction({admin:req.adminAccount,action:"merchant-seller-remove",module:"merchant",targetType:"merchant-seller",targetId:s.sellerId,before:publicSeller(s),after:{status:"removed",refund},ip:req.ip,userAgent:reqUserAgent(req)});
    res.json({success:true,merchant:publicMerchant(m)});
  });

  // ---------------- PDF EXPORT ----------------
  function pdfEscape(s) {
    return String(s == null ? "" : s)
      .replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)")
      .replace(/[^\x20-\x7E]/g,"?");
  }
  function makePdf(title, lines) {
    const chunks = [];
    const pageLines = 48;
    for (let i=0;i<lines.length;i+=pageLines) chunks.push(lines.slice(i,i+pageLines));
    if (!chunks.length) chunks.push([]);
    const objects = [];
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    const pageIds = [];
    let nextId = 3;
    // page objects are allocated after font + streams are known
    const fontId = 3 + chunks.length * 2;
    let streamId = fontId + 1;
    chunks.forEach((page,idx) => {
      const pageId = nextId++;
      const contentId = nextId++;
      pageIds.push(pageId);
      const content = ["BT","/F1 11 Tf","50 760 Td",`(${pdfEscape(title)} ) Tj`];
      page.forEach((line,j) => {
        content.push("0 -14 Td",`(${pdfEscape(line).slice(0,180)}) Tj`);
      });
      content.push("ET");
      objects[pageId-1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
      const raw = content.join("\n");
      objects[contentId-1] = `<< /Length ${Buffer.byteLength(raw,"latin1")} >>\nstream\n${raw}\nendstream`;
    });
    objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id=>id+" 0 R").join(" ")}] /Count ${pageIds.length} >>`;
    objects[fontId-1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    // Keep object numbers contiguous if an earlier slot was unused.
    const out = ["%PDF-1.4\n%\xE2\xE3\xCF\xD3"];
    const offsets = [0];
    for (let id=1;id<=objects.length;id++) {
      if (!objects[id-1]) objects[id-1] = "<<>>";
      offsets[id] = Buffer.byteLength(out.join(""),"latin1");
      out.push(`${id} 0 obj\n${objects[id-1]}\nendobj\n`);
    }
    const xref = Buffer.byteLength(out.join(""),"latin1");
    out.push(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`);
    for (let id=1;id<=objects.length;id++) out.push(String(offsets[id]).padStart(10,"0")+" 00000 n \n");
    out.push(`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return Buffer.from(out.join(""),"latin1");
  }

  app.get("/api/admin/merchants/:merchantId/report/pdf", requireAdmin, requirePermission("merchant:view"), (req,res) => {
    const m = getMerchant(req.params.merchantId);
    if (!m) return res.status(404).send("Merchant not found");
    if (!adminScope(req,m)) return countryDeniedResponse(res);
    const sellerList = merchantSellers(m.id);
    const txs = transactions.filter(t => t.merchantId === m.id).slice().sort((a,b)=>new Date(a.time)-new Date(b.time));
    const lines = [
      `Merchant: ${m.name}`,
      `Merchant ID: ${m.id}`,
      `User ID: ${m.userId || "-"}`,
      `Country: ${m.countryId}`,
      `Status: ${m.status}`,
      `Current Balance: ${Number(m.balanceDiamonds||0).toLocaleString()} Diamonds`,
      `Total Funded: ${Number(m.totalDiamondsFunded||0).toLocaleString()}`,
      `Transferred to Sellers: ${Number(m.totalDiamondsToSellers||0).toLocaleString()}`,
      `Total Sold to Users: ${Number(m.totalDiamondsSold||0).toLocaleString()}`,
      `Total Sales: ${Number(m.totalSalesCount||0)}`,
      `Active Sellers: ${sellerList.length}/${MAX_SELLERS}`,
      "",
      "SELLERS",
      ...sellerList.map(s => `${s.sellerId} | ${s.userId} | Balance ${Number(s.balanceDiamonds||0)} | Received ${Number(s.totalReceivedFromMerchant||0)} | Sold ${Number(s.totalDiamondsSold||0)} | Sales ${Number(s.totalSalesCount||0)}`),
      "",
      "TRANSACTION LEDGER",
      "Time | Type | Seller | Target | Diamonds | Balance After",
      ...txs.map(t => `${new Date(t.time).toISOString()} | ${t.type} | ${t.sellerUserId||"-"} | ${t.targetUserId||"-"} | ${Number(t.diamonds||0)} | ${Number(t.balanceAfter||t.sellerBalanceAfter||t.merchantBalanceAfter||0)}`)
    ];
    const pdf = makePdf("PingPong Merchant Report", lines);
    res.setHeader("Content-Type","application/pdf");
    res.setHeader("Content-Disposition",`attachment; filename="merchant-${m.id}-report.pdf"`);
    res.send(pdf);
  });

  return { sellers, transactions, getCenterForUser, publicUserCenter, MAX_SELLERS };
}

module.exports = { initMerchantCenter };
