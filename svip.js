// ==================================================
// SVIP Privilege System — Backend Core (additive module)
// ==================================================
// This file is self-contained and does not modify any existing wallet/VIP
// logic in server.js. It adds a *separate* SVIP1-8 "wealth level" system on
// top of the existing coins/diamonds/vipLevel fields, following the SRS:
//   - SVIP Resource Management (per-level resource mapping, cumulative)
//   - Dynamic Configuration (thresholds editable without app restart)
//   - Expiry System (permanent vs timed membership, auto-downgrade)
//   - Wealth History (audit log)
//   - SVIP History (level-change audit log)
//   - Socket Events (svip_level_changed, svip_resource_update, wealth_update)
//   - Notifications (level up, wealth added, expiring soon, expired)
//   - Anti-cheat helper (wealth_history vs current wealth consistency check)
//   - Leaderboard helper (daily/weekly/monthly/all-time)
//
// server.js is expected to call `initSvip({...})` once, after `users`,
// `io`, `socketsByUserId`, `findUserByUserId`, `saveUsers`, `safeRead`,
// `safeWrite` and `DATA_FOLDER` already exist, and to wire the returned
// functions in at the relevant points (login, gift-send, periodic sweep).
//
// NOTE ON "WEALTH": in this codebase gifts are bought with Coins (not
// Diamonds — see the "Changed on request" comments in server.js). SVIP
// wealth here is defined as *cumulative coins spent sending gifts*, which
// is the standard "Wealth level" definition used by BIGO/YoHo-style apps
// (a consumption metric, separate from the existing diamond-balance-based
// `vipLevel`). If a different definition is wanted (e.g. tied to Diamond
// recharge instead), only the call sites that invoke `addWealth()` need to
// change — the module itself is metric-agnostic.

const path = require("path");

function initSvip({ DATA_FOLDER, safeRead, safeWrite, io, socketsByUserId, emitToUser: crossInstanceEmitToUser, findUserByUserId, saveUsers, users, syncProfileToRoom }) {
    const SVIP_CONFIG_FILE = path.join(DATA_FOLDER, "svip_config.json");
    const SVIP_RESOURCE_FILE = path.join(DATA_FOLDER, "svip_resource.json");
    const WEALTH_HISTORY_FILE = path.join(DATA_FOLDER, "svip_wealth_history.json");
    const SVIP_HISTORY_FILE = path.join(DATA_FOLDER, "svip_history.json");
    const NOTIFICATIONS_FILE = path.join(DATA_FOLDER, "svip_notifications.json");

    const LEVEL_ORDER = Array.from({ length: 12 }, (_, i) => `SVIP${i + 1}`);

    // ---- Recharge-based SVIP Configuration ----
    // Visible SVIP is driven ONLY by cumulative Diamond recharge.
    // A successful recharge activates the entitlement for exactly 30 days
    // from the latest successful recharge.
    const RECHARGE_VALIDITY_DAYS = 30;
    const RECHARGE_VALIDITY_MS = RECHARGE_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
    const DEFAULT_CONFIG = {
        levels: {
            SVIP1: 1500000,
            SVIP2: 3000000,
            SVIP3: 7500000,
            SVIP4: 10500000,
            SVIP5: 15000000,
            SVIP6: 30000000,
            SVIP7: 45000000,
            SVIP8: 60000000,
            SVIP9: 75000000,
            SVIP10: 105000000,
            SVIP11: 150000000,
            SVIP12: 300000000
        }
    };

    // ---- SVIP Resource Management ----
    // Placeholder/CSS-class-style resource identifiers per level (per your
    // choice) — real asset URLs/animation files can replace these string
    // IDs later without touching this module's logic. Levels are cumulative:
    // a SVIP5 user also has everything granted at SVIP1-4.
    const DEFAULT_RESOURCES = {
        SVIP1: { tag: "/images/premium-haco/tags/svip1-tag.png", badge: "svip1-badge", bubble: "svip1-bubble", frame: "/images/premium-haco/frames/svip1-frame.webp" },
        SVIP2: { tag: "/images/premium-haco/tags/svip2-tag.png", bubble: "svip2-bubble", frame: "/images/premium-haco/frames/svip2-frame.webp" },
        SVIP3: { tag: "/images/premium-haco/tags/svip3-tag.png", bubble: "svip3-bubble", frame: "/images/premium-haco/frames/svip3-frame.webp", nicknameColor: "#E5B84B" },
        SVIP4: { tag: "/images/premium-haco/tags/svip4-tag.png", roomCard: "svip4-room-card", frame: "/images/premium-haco/frames/svip4-frame.webp", nicknameColor: "#E5B84B" },
        SVIP5: { tag: "/images/premium-haco/tags/svip5-tag.png", entryEffect: "/images/premium-haco/effects/vip_upgrade_notice_lv5_bg.mp4", frame: "/images/premium-haco/frames/svip5-frame.webp" },
        SVIP6: { tag: "/images/premium-haco/tags/svip6-tag.png", entryEffect: "/images/premium-haco/effects/vip_upgrade_notice_lv6_bg.mp4", frame: "/images/premium-haco/frames/svip6-frame.webp", nicknameColor: "#FF7A45" },
        SVIP7: { tag: "/images/premium-haco/tags/svip7-tag.png", frame: null, nicknameColor: "#E7D7FF" },
        SVIP8: { tag: "/images/premium-haco/tags/svip8-tag.png", frame: null, nicknameColor: "#9DDCFF" },
        SVIP9: { tag: "/images/premium-haco/tags/svip9-tag.png", frame: null, nicknameColor: "#D6B8FF" },
        SVIP10: { tag: "/images/premium-haco/tags/svip10-tag.png", frame: null, nicknameColor: "#FFB45E" },
        SVIP11: { tag: "/images/premium-haco/tags/svip11-tag.png", frame: null, nicknameColor: "#FF8C8C" },
        SVIP12: { tag: "/images/premium-haco/tags/svip12-tag.png", frame: null, nicknameColor: "#FFE17A" }
    };

    let config = safeRead(SVIP_CONFIG_FILE, DEFAULT_CONFIG);
    if (!config.levels || !Object.keys(config.levels).length) {
        config.levels = Object.assign({}, DEFAULT_CONFIG.levels);
    } else {
        // Migrate both the old gift-spend defaults and the previous 150k-based
        // recharge thresholds to the new 10x recharge thresholds.
        const legacy = [300000, 1100000, 2500000, 5000000, 9000000, 15000000, 25000000];
        const previousRecharge = [150000, 300000, 750000, 1050000, 1500000, 3000000, 4500000];
        const current = LEVEL_ORDER.slice(0, 7).map((k) => Number(config.levels[k]));
        if (current.every((v, i) => v === legacy[i]) || current.every((v, i) => v === previousRecharge[i])) {
            config.levels = Object.assign({}, DEFAULT_CONFIG.levels);
        } else {
            LEVEL_ORDER.forEach((k) => {
                if (!Number.isFinite(Number(config.levels[k]))) config.levels[k] = DEFAULT_CONFIG.levels[k];
            });
        }
    }
    // SVIP privilege gates mirror the supplied reference screens. The first
    // recharge target is 1,500,000 Diamonds (SVIP1); higher levels continue
    // through SVIP12 so every privilege shown in the reference UI has a real
    // server-side level gate. All privilege switches are persisted per user.
    const PRIVILEGES = {
        visitorDetails: { minLevel: 1, label: "Visitor details" },
        hideLastOnline: { minLevel: 3, label: "Hide Last Online" },
        antiTracking: { minLevel: 4, label: "Anti-Tracking" },
        hideOnlineStatus: { minLevel: 7, label: "Hide Online Status" },
        unbanAccount: { minLevel: 8, label: "Unban Account" },
        sid: { minLevel: 8, label: "SID" },
        anonymousRanking: { minLevel: 9, label: "Anonymous Ranking" },
        banAccount: { minLevel: 10, label: "Ban Account" },
        roomSecretLord: { minLevel: 11, label: "Room Secret Lord" }
    };
    const BAN_QUOTAS = { 10: 3, 11: 6, 12: 10 };
    const UNBAN_QUOTAS = { 8: 1, 9: 2, 10: 3, 11: 4, 12: 5 };

    let privilegeApplications = safeRead(path.join(DATA_FOLDER, "svip_privilege_applications.json"), []);
    function savePrivilegeApplications() {
        if (privilegeApplications.length > 10000) privilegeApplications.splice(0, privilegeApplications.length - 10000);
        safeWrite(path.join(DATA_FOLDER, "svip_privilege_applications.json"), privilegeApplications);
    }
    function currentMonthKey() { return new Date().toISOString().slice(0, 7); }
    function ensurePrivilegeFields(u) {
        if (!u || typeof u !== "object") return;
        if (!u.svipPrivileges || typeof u.svipPrivileges !== "object") u.svipPrivileges = {};
        Object.keys(PRIVILEGES).forEach((key) => { if (typeof u.svipPrivileges[key] !== "boolean") u.svipPrivileges[key] = false; });
        if (!u.svipPrivilegeUsage || typeof u.svipPrivilegeUsage !== "object") u.svipPrivilegeUsage = {};
        if (u.svipPrivilegeUsage.month !== currentMonthKey()) {
            u.svipPrivilegeUsage = { month: currentMonthKey(), banCount: 0, unbanCount: 0 };
        } else {
            if (!Number.isFinite(Number(u.svipPrivilegeUsage.banCount))) u.svipPrivilegeUsage.banCount = 0;
            if (!Number.isFinite(Number(u.svipPrivilegeUsage.unbanCount))) u.svipPrivilegeUsage.unbanCount = 0;
        }
        if (!Array.isArray(u.svipSidApplications)) u.svipSidApplications = [];
    }

    let resourceMap = safeRead(SVIP_RESOURCE_FILE, DEFAULT_RESOURCES);
    // Visual migration: preserve any admin-customized resource values, while
    // filling missing/legacy placeholders with the curated premium assets.
    // This is intentionally additive and idempotent, so persistent Railway/
    // Termux data gets the same visual upgrade without losing custom tags.
    Object.keys(DEFAULT_RESOURCES).forEach((key) => {
        const defaults = DEFAULT_RESOURCES[key];
        resourceMap[key] = Object.assign({}, defaults, resourceMap[key] || {});
        ["tag", "frame", "entryEffect"].forEach((field) => {
            const current = String(resourceMap[key][field] || "");
            const legacyTag = field === "tag" && (/\/tags\/svip\d+-tag\.webp$/i.test(current) || /^svip\d+-tag$/i.test(current));
            const legacyPlaceholder = /^svip\d+-(tag|frame|entry)$/i.test(current);
            if (defaults[field] && (!current || legacyTag || legacyPlaceholder)) {
                resourceMap[key][field] = defaults[field];
            }
        });
    });
    // No SVIP7 frame asset was supplied in the source ZIP/PDF; never fall
    // back to an older/unrelated frame for SVIP7.
    if (resourceMap.SVIP7) resourceMap.SVIP7.frame = null;
    safeWrite(SVIP_CONFIG_FILE, config);
    safeWrite(SVIP_RESOURCE_FILE, resourceMap);

    let wealthHistory = safeRead(WEALTH_HISTORY_FILE, []);
    let svipHistory = safeRead(SVIP_HISTORY_FILE, []);
    let notifications = safeRead(NOTIFICATIONS_FILE, []);

    function saveConfig() { safeWrite(SVIP_CONFIG_FILE, config); }
    function saveResources() { safeWrite(SVIP_RESOURCE_FILE, resourceMap); }
    function saveWealthHistory() {
        if (wealthHistory.length > 20000) wealthHistory.splice(0, wealthHistory.length - 20000);
        safeWrite(WEALTH_HISTORY_FILE, wealthHistory);
    }
    function saveSvipHistory() { safeWrite(SVIP_HISTORY_FILE, svipHistory); }
    function saveNotifications() {
        if (notifications.length > 5000) notifications.splice(0, notifications.length - 5000);
        safeWrite(NOTIFICATIONS_FILE, notifications);
    }

    function levelFromWealth(wealth) {
        let level = 0;
        for (const key of LEVEL_ORDER) {
            const threshold = config.levels[key];
            if (typeof threshold === "number" && wealth >= threshold) level = Number(key.replace("SVIP", ""));
        }
        return level;
    }

    // Cumulative resource set for a level (merges SVIP1..level).
    function resourcesForLevel(level) {
        let merged = {};
        for (let i = 1; i <= level; i++) {
            const key = "SVIP" + i;
            if (resourceMap[key]) merged = Object.assign({}, merged, resourceMap[key]);
        }
        return merged;
    }

    // Called for every user record on load/login so old accounts (created
    // before this module existed) get the new fields without disturbing
    // anything else already on the object.
    function isRechargeEntitlementActive(u, now = Date.now()) {
        return !!(u && u.svipRechargeExpireAt && new Date(u.svipRechargeExpireAt).getTime() > now && Number(u.svipRechargeLevel || 0) >= 1);
    }

    function activeRechargeLevel(u, now = Date.now()) {
        return isRechargeEntitlementActive(u, now) ? Math.min(12, Math.max(0, Number(u.svipRechargeLevel) || 0)) : 0;
    }

    // Legacy gift-spend SVIP fields are retained for audit compatibility, but
    // they no longer grant the visible SVIP tag/frame. Visible SVIP is recharge-only.
    function ensureUserSvipFields(u) {
        if (typeof u.svipWealth !== "number") u.svipWealth = 0;
        if (typeof u.svipRechargeTotal !== "number" || !Number.isFinite(u.svipRechargeTotal) || u.svipRechargeTotal < 0) u.svipRechargeTotal = 0;
        if (typeof u.svipRechargeLevel !== "number" || !Number.isFinite(u.svipRechargeLevel) || u.svipRechargeLevel < 0) u.svipRechargeLevel = 0;
        if (u.svipRechargeActivatedAt === undefined) u.svipRechargeActivatedAt = null;
        if (u.svipRechargeExpireAt === undefined) u.svipRechargeExpireAt = null;
        if (u.svipMembershipType === undefined) u.svipMembershipType = "timed";
        if (u.svipExpireAt === undefined) u.svipExpireAt = u.svipRechargeExpireAt;
        if (u.svipExpiryWarned === undefined) u.svipExpiryWarned = false;
        ensurePrivilegeFields(u);
        if (u.assignedTagLevel === undefined) u.assignedTagLevel = null;

        u.svipLevel = activeRechargeLevel(u);
        if (!isRechargeEntitlementActive(u)) {
            u.svipMembershipType = "timed";
            u.svipExpireAt = null;
            u.svipExpiryWarned = false;
        } else {
            u.svipMembershipType = "timed";
            u.svipExpireAt = u.svipRechargeExpireAt;
        }
    }

    function resourcesForUser(u) {
        const level = activeRechargeLevel(u);
        if (level < 1) return {};
        return resourcesForLevel(level);
    }

    // GAP #1 — was socketsByUserId[userId]-gated (local-instance only);
    // now delegates to server.js's cross-instance-safe emitToUser()
    // (per-user Socket.IO room + Redis adapter) if injected, falling back
    // to the old local-socket path only if a caller/test doesn't supply it.
    function emitToUser(userId, event, payload) {
        if (typeof crossInstanceEmitToUser === "function") { crossInstanceEmitToUser(userId, event, payload); return; }
        const sid = socketsByUserId[userId];
        if (sid) io.to(sid).emit(event, payload);
    }

    function pushNotification(userId, type, message) {
        const n = { userId, type, message, time: new Date().toISOString(), read: false };
        notifications.push(n);
        saveNotifications();
        emitToUser(userId, "svip_notification", n);
        return n;
    }

    // ---- Wealth History (audit log) ----
    function logWealth(userId, diamondAmount, wealthAfter, referenceId, type) {
        wealthHistory.push({
            uid: userId,
            type: type || "wealth_added",
            diamond: diamondAmount,
            wealth: wealthAfter,
            date: new Date().toISOString(),
            referenceId: referenceId || null
        });
        saveWealthHistory();
    }

    // ---- Legacy wealth audit ----
    // Kept for compatibility with older callers/history. Gift sending no
    // longer changes visible SVIP tags or frames.
    function addWealth(userId, amount, referenceId, type) {
        if (!amount || amount <= 0) return null;
        const found = findUserByUserId(userId);
        if (!found) return null;
        const u = found.user;
        ensureUserSvipFields(u);
        u.svipWealth += amount;
        logWealth(userId, amount, u.svipWealth, referenceId, type);
        saveUsers();
        const effectiveLevel = activeRechargeLevel(u);
        emitToUser(userId, "wealth_update", { userId, svipWealth: u.svipWealth, svipLevel: effectiveLevel });
        pushNotification(userId, "wealth_added", `+${amount} wealth`);
        return { svipWealth: u.svipWealth, svipLevel: effectiveLevel, leveledUp: false };
    }

    // ---- Recharge authority ----
    // Called only AFTER a server-authoritative Diamond recharge has actually
    // credited the target User ID. All supported recharge sources use this
    // single function, keeping cumulative thresholds consistent.
    function recordRecharge(userId, diamondAmount, referenceId, source) {
        const amount = Math.floor(Number(diamondAmount) || 0);
        if (amount <= 0) return null;
        const found = findUserByUserId(userId);
        if (!found) return null;

        const u = found.user;
        ensureUserSvipFields(u);
        const now = Date.now();
        const previousLevel = Number(u.svipRechargeLevel || 0);
        const previousEffectiveLevel = activeRechargeLevel(u, now);

        u.svipRechargeTotal += amount;
        const newLevel = levelFromWealth(u.svipRechargeTotal);
        u.svipRechargeLevel = newLevel;
        u.svipRechargeActivatedAt = new Date(now).toISOString();
        u.svipRechargeExpireAt = new Date(now + RECHARGE_VALIDITY_MS).toISOString();
        u.svipMembershipType = "timed";
        u.svipExpireAt = u.svipRechargeExpireAt;
        u.svipExpiryWarned = false;
        u.svipLevel = newLevel;

        // Auto-equip the newly earned/current SVIP frame only when the user
        // has no other frame selected (or the previous selected frame was an
        // SVIP frame). A manually selected normal frame is never overridden.
        if (newLevel >= 1 && newLevel <= 6 && resourcesForUser(u).frame) {
            const currentFrameIsSvip = !!(u.activeFrame && u.activeFrame.svip);
            if (!u.activeFrame || currentFrameIsSvip) {
                u.activeFrame = {
                    frameId: `svip-${newLevel}-premium`,
                    name: `SVIP${newLevel} Premium Frame`,
                    imageUrl: resourcesForUser(u).frame,
                    expiresAt: u.svipRechargeExpireAt,
                    system: true,
                    svip: true
                };
            }
        }

        wealthHistory.push({
            uid: userId,
            type: "diamond_recharge",
            diamond: amount,
            wealth: u.svipRechargeTotal,
            date: new Date(now).toISOString(),
            referenceId: referenceId || null,
            source: source || "recharge"
        });
        saveWealthHistory();
        saveUsers();

        const resources = resourcesForUser(u);
        const payload = {
            userId,
            level: newLevel,
            resources,
            expireAt: u.svipRechargeExpireAt,
            rechargeTotal: u.svipRechargeTotal,
            source: source || "recharge"
        };

        if (newLevel !== previousLevel || previousEffectiveLevel === 0) {
            svipHistory.push({
                uid: userId,
                fromLevel: previousEffectiveLevel,
                toLevel: newLevel,
                date: new Date(now).toISOString(),
                reason: newLevel > previousEffectiveLevel ? "recharge_level_up" : "recharge_renewed"
            });
            saveSvipHistory();
            if (newLevel > previousEffectiveLevel) {
                pushNotification(userId, "level_up", `Congratulations! You are now SVIP${newLevel}.`);
            }
            emitToUser(userId, "svip_level_changed", {
                userId,
                fromLevel: previousEffectiveLevel,
                toLevel: newLevel,
                resources,
                expireAt: u.svipRechargeExpireAt,
                rechargeTotal: u.svipRechargeTotal
            });
        }

        emitToUser(userId, "svip_resource_update", payload);
        emitToUser(userId, "profile_frame_update", {
            userId,
            // Send the actual selected frame. A user may have deliberately
            // equipped another owned frame while keeping the SVIP entitlement.
            frame: u.activeFrame && u.activeFrame.imageUrl ? u.activeFrame : null
        });
        emitToUser(userId, "wealth_update", {
            userId,
            svipWealth: u.svipWealth,
            svipLevel: newLevel,
            svipRechargeTotal: u.svipRechargeTotal,
            svipRechargeExpireAt: u.svipRechargeExpireAt
        });
        if (typeof syncProfileToRoom === "function") {
            try { syncProfileToRoom(userId); } catch (_) {}
        }
        pushNotification(userId, "recharge_svip_activated", `Diamond recharge +${amount.toLocaleString()} activated SVIP${newLevel} for ${RECHARGE_VALIDITY_DAYS} days.`);
        return {
            svipRechargeTotal: u.svipRechargeTotal,
            svipRechargeLevel: newLevel,
            svipLevel: newLevel,
            expireAt: u.svipRechargeExpireAt,
            resources
        };
    }

    // ---- 30-day recharge entitlement expiry ----
    function grantMembership(userId, { type = "timed", days = RECHARGE_VALIDITY_DAYS } = {}) {
        const found = findUserByUserId(userId);
        if (!found) return null;
        const u = found.user;
        ensureUserSvipFields(u);
        const now = Date.now();
        u.svipMembershipType = "timed";
        u.svipRechargeActivatedAt = new Date(now).toISOString();
        u.svipRechargeExpireAt = new Date(now + Math.max(1, Number(days) || RECHARGE_VALIDITY_DAYS) * 86400000).toISOString();
        u.svipExpireAt = u.svipRechargeExpireAt;
        u.svipExpiryWarned = false;
        u.svipLevel = activeRechargeLevel(u);
        const membershipResources = resourcesForUser(u);
        if (u.svipLevel >= 1 && u.svipLevel <= 6 && membershipResources.frame) {
            if (!u.activeFrame || u.activeFrame.svip) {
                u.activeFrame = {
                    frameId: `svip-${u.svipLevel}-premium`,
                    name: `SVIP${u.svipLevel} Premium Frame`,
                    imageUrl: membershipResources.frame,
                    expiresAt: u.svipRechargeExpireAt,
                    system: true,
                    svip: true
                };
            }
        }
        saveUsers();
        const resources = resourcesForUser(u);
        emitToUser(userId, "svip_resource_update", { userId, level: u.svipLevel, resources, expireAt: u.svipRechargeExpireAt, rechargeTotal: u.svipRechargeTotal });
        emitToUser(userId, "profile_frame_update", {
            userId,
            frame: u.activeFrame && u.activeFrame.imageUrl ? u.activeFrame : null
        });
        if (typeof syncProfileToRoom === "function") { try { syncProfileToRoom(userId); } catch (_) {} }
        return u;
    }

    const EXPIRY_WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

    function checkExpiry(userId) {
        const found = findUserByUserId(userId);
        if (!found) return;
        const u = found.user;
        ensureUserSvipFields(u);
        if (!u.svipRechargeExpireAt) return;

        const msLeft = new Date(u.svipRechargeExpireAt).getTime() - Date.now();
        if (msLeft <= 0) {
            const prevLevel = Number(u.svipLevel || 0);
            u.svipLevel = 0;
            // Only remove the automatically selected SVIP frame. Any other
            // frame the user explicitly equipped remains untouched.
            if (u.activeFrame && u.activeFrame.svip) u.activeFrame = null;
            u.svipMembershipType = "timed";
            u.svipExpireAt = null;
            u.svipExpiryWarned = false;
            saveUsers();
            if (prevLevel > 0) {
                svipHistory.push({ uid: userId, fromLevel: prevLevel, toLevel: 0, date: new Date().toISOString(), reason: "recharge_30d_expired" });
                saveSvipHistory();
                pushNotification(userId, "membership_expired", "Your SVIP tag and frame expired after 30 days.");
            }
            emitToUser(userId, "svip_level_changed", { userId, fromLevel: prevLevel, toLevel: 0, resources: {}, expireAt: null, rechargeTotal: u.svipRechargeTotal });
            emitToUser(userId, "svip_resource_update", { userId, level: 0, resources: {}, expireAt: null, rechargeTotal: u.svipRechargeTotal });
            emitToUser(userId, "profile_frame_update", {
                userId,
                // If the user had switched to another owned frame, keep that
                // frame visible after SVIP expiry. Only the SVIP frame is removed.
                frame: u.activeFrame && u.activeFrame.imageUrl ? u.activeFrame : null
            });
            if (typeof syncProfileToRoom === "function") { try { syncProfileToRoom(userId); } catch (_) {} }
        } else if (msLeft <= EXPIRY_WARNING_WINDOW_MS && !u.svipExpiryWarned) {
            u.svipExpiryWarned = true;
            saveUsers();
            pushNotification(userId, "membership_expiring_soon", "Your SVIP tag and frame expire soon.");
        }
    }

    function onUserLoaded(u) {
        if (!u) return;
        ensureUserSvipFields(u);
        checkExpiry(u.userId);
    }

    function sweepAllExpiries() {
        Object.values(users).forEach((u) => {
            if (u && u.userId) checkExpiry(u.userId);
        });
    }
    const svipExpiryTimer = setInterval(sweepAllExpiries, 30 * 60 * 1000);
    if (svipExpiryTimer && typeof svipExpiryTimer.unref === "function") svipExpiryTimer.unref();

    function statusFor(userId) {
        const found = findUserByUserId(userId);
        if (!found) return null;
        const u = found.user;
        ensureUserSvipFields(u);
        checkExpiry(userId);
        const effectiveLevel = activeRechargeLevel(u);
        const nextKey = LEVEL_ORDER.find((key) => Number(config.levels[key]) > Number(u.svipRechargeTotal || 0));
        const nextTarget = nextKey ? Number(config.levels[nextKey]) : null;
        return {
            userId,
            svipWealth: u.svipWealth,
            svipLevel: effectiveLevel,
            svipRechargeTotal: u.svipRechargeTotal,
            nextTarget,
            remainingToNext: nextTarget == null ? 0 : Math.max(0, nextTarget - Number(u.svipRechargeTotal || 0)),
            svipRechargeLevel: u.svipRechargeLevel,
            membershipType: "timed",
            expireAt: effectiveLevel ? u.svipRechargeExpireAt : null,
            resources: resourcesForUser(u),
            assignedTagLevel: null
        };
    }

    // ---- SVIP Tag Assignment (Admin: give any uploaded level-tag to any User ID) ----
    // Independent of the wealth/level system — Admin picks a User ID and one of
    // the already-uploaded PNG tags (by level) from the Tag list, and it shows
    // on that user's profile immediately, in real time, and survives refresh/
    // re-login because it's stored on the user record.
    function assignTagToUser(userId, level) {
        const found = findUserByUserId(userId);
        if (!found) return null;
        const lvl = Number(level);
        if (!Number.isInteger(lvl) || lvl < 1 || lvl > 7) return { error: "bad_level" };
        const key = "SVIP" + lvl;
        if (!resourceMap[key] || !resourceMap[key].tag) return { error: "no_tag" };
        const u = found.user;
        ensureUserSvipFields(u);
        u.assignedTagLevel = lvl;
        saveUsers();
        const resources = resourcesForUser(u);
        emitToUser(userId, "svip_resource_update", { userId, level: u.svipLevel, resources });
        return { userId, assignedTagLevel: lvl, tag: resourceMap[key].tag, tagVersion: resourceMap[key].tagVersion };
    }

    function removeAssignedTag(userId) {
        const found = findUserByUserId(userId);
        if (!found) return null;
        const u = found.user;
        ensureUserSvipFields(u);
        u.assignedTagLevel = null;
        saveUsers();
        const resources = resourcesForUser(u);
        emitToUser(userId, "svip_resource_update", { userId, level: u.svipLevel, resources });
        return { userId, assignedTagLevel: null };
    }

    function getAssignedTag(userId) {
        const found = findUserByUserId(userId);
        if (!found) return null;
        ensureUserSvipFields(found.user);
        return { userId, assignedTagLevel: found.user.assignedTagLevel || null };
    }

    // ---- Anti-cheat: consistency check between wealth_history and the
    // live svipWealth field (should always match; a mismatch means the
    // field was changed some other way than addWealth()). ----
    function verifyWealthConsistency(userId) {
        const found = findUserByUserId(userId);
        if (!found) return null;
        const sum = wealthHistory.filter((h) => h.uid === userId).reduce((s, h) => s + (h.diamond || 0), 0);
        const current = found.user.svipWealth || 0;
        return { userId, historySum: sum, currentWealth: current, matches: sum === current };
    }

    // ---- Leaderboard (daily/weekly/monthly/all-time), from wealth_history ----
    function getLeaderboard(period = "all", limit = 20) {
        const now = Date.now();
        const windowMs = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000, monthly: 30 * 24 * 60 * 60 * 1000, all: Infinity }[period] || Infinity;
        const totals = {};
        wealthHistory.forEach((h) => {
            if (now - new Date(h.date).getTime() > windowMs) return;
            totals[h.uid] = (totals[h.uid] || 0) + (h.diamond || 0);
        });
        return Object.entries(totals)
            .map(([userId, wealth]) => {
                const found = findUserByUserId(userId);
                return { userId, wealth, name: found ? found.user.name : userId, svipLevel: found ? found.user.svipLevel || 0 : 0 };
            })
            .sort((a, b) => b.wealth - a.wealth)
            .slice(0, limit);
    }

    // ---- Config/resource getters+setters (for the future admin panel phase) ----
    function getConfig() { return config; }
    function setLevels(newLevels) {
        config.levels = Object.assign({}, config.levels, newLevels);
        saveConfig();
        return config;
    }
    function getResourceMap() { return resourceMap; }
    function setResourceMap(newMap) {
        resourceMap = Object.assign({}, resourceMap, newMap);
        saveResources();
        return resourceMap;
    }

    // ---- SVIP Tag Management (PNG upload per level) ----
    // Called by the admin upload endpoint once a validated, resized PNG has
    // been written to disk. Stores the URL + a version stamp (for
    // cache-busting) inside the same cumulative resourceMap used by
    // resourcesForLevel(), so uploading a tag "just works" everywhere the
    // level's resources are already read from.
    function setTagAsset(level, urlPath) {
        const key = "SVIP" + level;
        resourceMap[key] = Object.assign({}, resourceMap[key], { tag: urlPath, tagVersion: Date.now() });
        saveResources();
        return resourceMap[key];
    }
    function clearTagAsset(level) {
        const key = "SVIP" + level;
        if (resourceMap[key]) {
            delete resourceMap[key].tag;
            delete resourceMap[key].tagVersion;
            saveResources();
        }
    }
    // Flat list for the admin Tag Management screen: one row per level.
    function listTags() {
        return LEVEL_ORDER.map((key, i) => ({
            level: i + 1,
            tag: (resourceMap[key] && resourceMap[key].tag) || null,
            tagVersion: (resourceMap[key] && resourceMap[key].tagVersion) || null
        }));
    }

    function privilegeStatus(userId) {
        const found = findUserByUserId(userId);
        if (!found) return null;
        const u = found.user;
        ensureUserSvipFields(u);
        const level = activeRechargeLevel(u);
        const next = LEVEL_ORDER.find((key) => Number(config.levels[key]) > Number(u.svipRechargeTotal || 0));
        const currentTarget = level > 0 ? Number(config.levels["SVIP" + level] || 0) : 0;
        const nextTarget = next ? Number(config.levels[next] || 0) : null;
        const usage = u.svipPrivilegeUsage || { month: currentMonthKey(), banCount: 0, unbanCount: 0 };
        const banQuota = BAN_QUOTAS[Math.min(12, level)] || 0;
        const unbanQuota = UNBAN_QUOTAS[Math.min(12, level)] || 0;
        const features = {};
        Object.entries(PRIVILEGES).forEach(([key, meta]) => {
            features[key] = { label: meta.label, minLevel: meta.minLevel, unlocked: level >= meta.minLevel, enabled: level >= meta.minLevel && !!u.svipPrivileges[key] };
        });
        return {
            userId, level, rechargeTotal: Number(u.svipRechargeTotal || 0), expireAt: activeRechargeLevel(u) ? u.svipRechargeExpireAt : null,
            thresholds: config.levels, currentTarget, nextTarget, remainingToNext: nextTarget == null ? 0 : Math.max(0, nextTarget - Number(u.svipRechargeTotal || 0)),
            features, usage: { month: currentMonthKey(), banCount: Number(usage.banCount || 0), banQuota, unbanCount: Number(usage.unbanCount || 0), unbanQuota },
            sid: { customId: u.customId || null, applications: u.svipSidApplications.slice(-10).reverse() }
        };
    }

    function setPrivilege(userId, key, enabled) {
        const found = findUserByUserId(userId);
        if (!found) return { success: false, message: "User not found" };
        if (!PRIVILEGES[key]) return { success: false, message: "Unknown SVIP privilege" };
        const u = found.user;
        ensureUserSvipFields(u);
        const level = activeRechargeLevel(u);
        if (level < PRIVILEGES[key].minLevel) return { success: false, message: `SVIP${PRIVILEGES[key].minLevel} required` };
        u.svipPrivileges[key] = !!enabled;
        saveUsers();
        return { success: true, status: privilegeStatus(userId) };
    }

    function monthlyQuotaFor(level, map) {
        let q = 0;
        Object.keys(map).forEach((k) => { if (level >= Number(k)) q = map[k]; });
        return q;
    }

    function createUnbanApplication(actorId, targetUserId, reason) {
        const found = findUserByUserId(actorId);
        const target = findUserByUserId(targetUserId);
        if (!found || !target) return { success: false, message: "User ID not found" };
        ensureUserSvipFields(found.user);
        const level = activeRechargeLevel(found.user);
        if (level < 8) return { success: false, message: "SVIP8 required" };
        if (!target.user.banned) return { success: false, message: "That account is not currently banned" };
        const month = currentMonthKey();
        if (found.user.svipPrivilegeUsage.month !== month) ensurePrivilegeFields(found.user);
        const quota = monthlyQuotaFor(level, UNBAN_QUOTAS);
        if (Number(found.user.svipPrivilegeUsage.unbanCount || 0) >= quota) return { success: false, message: `Monthly unban application limit reached (${quota})` };
        const pending = privilegeApplications.find((a) => a.type === "unban" && a.applicantId === actorId && a.targetUserId === targetUserId && a.status === "pending");
        if (pending) return { success: false, message: "An unban application for this User ID is already pending" };
        found.user.svipPrivilegeUsage.unbanCount = Number(found.user.svipPrivilegeUsage.unbanCount || 0) + 1;
        const app = { id: "svip-unban-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8), type: "unban", applicantId: actorId, targetUserId, reason: String(reason || "").slice(0, 300), level, status: "pending", createdAt: new Date().toISOString(), reviewedAt: null, reviewer: null };
        privilegeApplications.push(app); savePrivilegeApplications(); saveUsers();
        return { success: true, application: app, status: privilegeStatus(actorId) };
    }

    function createBanAction(actorId, targetUserId, reason) {
        const found = findUserByUserId(actorId);
        const target = findUserByUserId(targetUserId);
        if (!found || !target) return { success: false, message: "User ID not found" };
        ensureUserSvipFields(found.user);
        const level = activeRechargeLevel(found.user);
        if (level < 10) return { success: false, message: "SVIP10 required" };
        if (actorId === targetUserId) return { success: false, message: "You cannot ban your own account" };
        if (target.user.is_immune || target.user.can_manage_all) return { success: false, message: "This account is protected" };
        const wealthLevel = Number(target.user.level || target.user.idLevel || 1);
        if (wealthLevel > 5) return { success: false, message: "Only accounts with wealth level 5 or below can be banned by SVIP" };
        const quota = monthlyQuotaFor(level, BAN_QUOTAS);
        if (Number(found.user.svipPrivilegeUsage.banCount || 0) >= quota) return { success: false, message: `Monthly ban limit reached (${quota})` };
        const now = Date.now();
        const until = new Date(now + 24 * 60 * 60 * 1000).toISOString();
        found.user.svipPrivilegeUsage.banCount = Number(found.user.svipPrivilegeUsage.banCount || 0) + 1;
        target.user.banned = true;
        target.user.svipBanUntil = until;
        target.user.svipBanBy = actorId;
        target.user.svipBanReason = String(reason || "SVIP Ban Account").slice(0, 300);
        const app = { id: "svip-ban-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8), type: "ban", applicantId: actorId, targetUserId, reason: target.user.svipBanReason, level, status: "applied", createdAt: new Date().toISOString(), expiresAt: until };
        privilegeApplications.push(app); savePrivilegeApplications(); saveUsers();
        return { success: true, application: app, status: privilegeStatus(actorId), banUntil: until };
    }

    function createSidApplication(actorId, requestedSid) {
        const found = findUserByUserId(actorId);
        if (!found) return { success: false, message: "User not found" };
        ensureUserSvipFields(found.user);
        const level = activeRechargeLevel(found.user);
        if (level < 8) return { success: false, message: "SVIP8 required" };
        const sid = String(requestedSid || "").trim();
        if (!/^[0-9]{4,12}$/.test(sid)) return { success: false, message: "SID must contain 4–12 digits" };
        const taken = Object.values(users).some((u) => String(u.customId || "") === sid && u.userId !== actorId);
        if (taken) return { success: false, message: "That SID is already in use" };
        found.user.svipSidApplications.unshift({ sid, status: "pending", createdAt: new Date().toISOString() });
        found.user.svipSidApplications = found.user.svipSidApplications.slice(0, 20);
        privilegeApplications.push({ id: "svip-sid-" + Date.now().toString(36), type: "sid", applicantId: actorId, targetUserId: actorId, requestedSid: sid, level, status: "pending", createdAt: new Date().toISOString() });
        savePrivilegeApplications(); saveUsers();
        return { success: true, sid, status: privilegeStatus(actorId) };
    }

    function listPrivilegeApplications(status) {
        return privilegeApplications.filter((a) => !status || a.status === status).slice().reverse();
    }

    function reviewApplication(applicationId, action, reviewer) {
        const app = privilegeApplications.find((a) => a.id === applicationId);
        if (!app) return { success: false, message: "Application not found" };
        if (!['approve','reject'].includes(action)) return { success: false, message: "Invalid review action" };
        if (app.status !== "pending") return { success: false, message: "Application already reviewed" };
        const target = findUserByUserId(app.targetUserId);
        if (!target) return { success: false, message: "Target user not found" };
        if (app.type === "unban" && action === "approve") {
            target.user.banned = false; delete target.user.svipBanUntil;
            emitToUser(target.user.userId, "account-unbanned", { message: "Your account has been unbanned after review." });
        }
        if (app.type === "sid" && action === "approve") {
            const requested = String(app.requestedSid || "");
            const taken = Object.values(users).some((u) => String(u.customId || "") === requested && u.userId !== target.user.userId);
            if (taken) return { success: false, message: "Requested SID is already in use" };
            target.user.customId = requested;
            emitToUser(target.user.userId, "custom-id-updated", { customId: requested });
        }
        app.status = action === "approve" ? "approved" : "rejected"; app.reviewedAt = new Date().toISOString(); app.reviewer = reviewer || null;
        savePrivilegeApplications(); saveUsers();
        return { success: true, application: app };
    }

    function expireSvipBans() {
        const now = Date.now();
        Object.values(users).forEach((u) => {
            if (u && u.svipBanUntil && new Date(u.svipBanUntil).getTime() <= now) {
                if (u.banned) u.banned = false;
                delete u.svipBanUntil; delete u.svipBanBy; delete u.svipBanReason;
                emitToUser(u.userId, "account-unbanned", { message: "Your 24-hour SVIP ban has expired." });
            }
        });
        saveUsers();
    }
    const svipBanTimer = setInterval(expireSvipBans, 60 * 1000);
    if (svipBanTimer && typeof svipBanTimer.unref === "function") svipBanTimer.unref();

    return {
        ensureUserSvipFields,
        onUserLoaded,
        addWealth,
        recordRecharge,
        grantMembership,
        checkExpiry,
        sweepAllExpiries,
        statusFor,
        verifyWealthConsistency,
        getLeaderboard,
        getConfig,
        setLevels,
        getResourceMap,
        setResourceMap,
        levelFromWealth,
        resourcesForLevel,
        setTagAsset,
        clearTagAsset,
        listTags,
        assignTagToUser,
        removeAssignedTag,
        getAssignedTag,
        privilegeStatus,
        setPrivilege,
        createUnbanApplication,
        createBanAction,
        createSidApplication,
        listPrivilegeApplications,
        reviewApplication,
        expireSvipBans,
        PRIVILEGES
    };
}

module.exports = { initSvip };
