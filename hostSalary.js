// ==================================================
// HOST SALARY / BEANS PAYOUT ENGINE
// ==================================================
// Server-authoritative salary calculation for Party Hosts.
// Party policy: achieved target (confirmed host gift value) × 3 = salary Beans.
// Agency membership is NOT required.
//
// Salary source is confirmed host gift target value. Salary is always target × 3
// and is credited to the separate `beans` wallet; diamonds are never moved.
//
// Important safety properties:
//   - Owner-only permission (host-salary:manage).
//   - Only users who are currently active Hosts qualify.
//   - Gift history is the source of truth for earned diamonds.
//   - Same host + same period + automatic method is idempotent.
//   - Manual host bean adjustments remain separate from automatic salary.
//   - Every payout is permanently recorded and audit logged.

const path = require("path");
const crypto = require("crypto");

const LEVEL_TARGETS = [100000, 200000, 500000, 1200000, 2000000, 2800000, 3600000, 4500000, 6000000, 8500000, 11000000, 27500000, 35000000, 50000000, 70000000, 85000000, 100000000, 125000000, 150000000, 170000000, 200000000];
const LEVELS = LEVEL_TARGETS.map((targetDiamonds, index) => ({
    level: index + 1, targetDiamonds, rewardBeans: targetDiamonds * 3
}));

const DEFAULT_POLICY = {
    version: 1,
    periodType: "monthly",
    rewardMultiplier: 3,
    beansPerUsd: 200000,
    exchangeRate: 0.30,
    countries: {
        BD: { name: "Bangladesh", currency: "BDT", usdLocalRate: 120 },
        IN: { name: "India", currency: "INR", usdLocalRate: 90 },
        DEFAULT: { name: "Other Countries", currency: "LOCAL", usdLocalRate: 1 }
    },
    levels: LEVELS
};

function initHostSalary(deps) {
    const {
        app, DATA_FOLDER, safeRead, safeWrite, users, findUserByUserId,
        saveUsers, agencies, giftHistory, registerGiftRecordedHook,
        emitToUser, logTransaction, pushWalletUpdate, clampBeansBalance,
        sendSystemMessage, rbac, requireAdmin, requirePermission, actorCanAccessCountry,
        countryDeniedResponse, reqUserAgent
    } = deps;

    const POLICY_FILE = path.join(DATA_FOLDER, "host_salary_policy.json");
    const PAYOUTS_FILE = path.join(DATA_FOLDER, "host_salary_payouts.json");
    const REPORTS_FILE = path.join(DATA_FOLDER, "host_salary_reports.json");

    const loadedPolicy = safeRead(POLICY_FILE, null);
    let policy = normalizePolicy(loadedPolicy || DEFAULT_POLICY);
    let payouts = safeRead(PAYOUTS_FILE, []);
    let reports = safeRead(REPORTS_FILE, {});
    if (!Array.isArray(payouts)) payouts = [];
    if (!reports || typeof reports !== "object" || Array.isArray(reports)) reports = {};
    function saveReports() { safeWrite(REPORTS_FILE, reports, { immediate: true }); }
    // Post-salary cycle markers. A successful salary closes the old target
    // immediately; subsequent gifts start a fresh target cycle even if an
    // operator previews the same date range again.
    const cycleResets = safeRead(path.join(DATA_FOLDER, "host_salary_cycle_resets.json"), {});
    function saveCycleResets(){ safeWrite(path.join(DATA_FOLDER, "host_salary_cycle_resets.json"), cycleResets, { immediate:true }); }


    // In-memory host gift index; it is derived from the existing permanent
    // gift history and does not create a second persistent gift store.
    const giftByHost = Object.create(null);
    for (const entry of giftHistory) indexGift(entry);
    registerGiftRecordedHook((entry) => indexGift(entry));

    function indexGift(entry) {
        if (!entry || !entry.hostId) return;
        if (!giftByHost[entry.hostId]) giftByHost[entry.hostId] = [];
        giftByHost[entry.hostId].push(entry);
    }

    function savePolicy() { safeWrite(POLICY_FILE, policy, { immediate: true }); }
    function savePayouts() { safeWrite(PAYOUTS_FILE, payouts, { immediate: true }); }

    // Seed the policy file once. It is intentionally a separate data file so
    // the Owner can change country conversion settings without touching code.
    if (!loadedPolicy) savePolicy();

    function normalizePolicy(raw) {
        const src = raw && typeof raw === "object" ? raw : DEFAULT_POLICY;
        const countries = { ...DEFAULT_POLICY.countries, ...(src.countries || {}) };
        const levels = Array.isArray(src.levels) && src.levels.length ? src.levels : DEFAULT_POLICY.levels;
        const cleanLevels = levels.map((l, i) => ({
            level: Math.max(1, Math.floor(Number(l.level) || i + 1)),
            targetDiamonds: Math.max(0, Math.floor(Number(l.targetDiamonds) || 0)),
            rewardBeans: Math.max(0, Math.floor(Number(l.rewardBeans) || 0))
        })).sort((a, b) => a.targetDiamonds - b.targetDiamonds || a.level - b.level);
        return {
            version: Number(src.version) || 1,
            periodType: src.periodType === "monthly" ? "monthly" : "monthly",
            rewardMultiplier: Number.isFinite(Number(src.rewardMultiplier)) && Number(src.rewardMultiplier) > 0 ? Number(src.rewardMultiplier) : 3,
            beansPerUsd: Math.max(1, Math.floor(Number(src.beansPerUsd) || 200000)),
            exchangeRate: Math.min(1, Math.max(0, Number(src.exchangeRate) || 0.30)),
            countries,
            levels: cleanLevels
        };
    }

    function countryForUser(user) {
        const real = String(user && user.country || "").toUpperCase();
        if (policy.countries[real]) return real;
        const region = String(user && user.countryId || "").toUpperCase();
        if (policy.countries[region]) return region;
        return "DEFAULT";
    }

    function countryPolicy(user) {
        const id = countryForUser(user);
        return { id, ...(policy.countries[id] || policy.countries.DEFAULT) };
    }

    function periodBounds(start, end) {
        const now = new Date();
        let from = start ? new Date(start) : new Date(now.getFullYear(), now.getMonth(), 1);
        let to = end ? new Date(end) : new Date(now.getTime());
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
        // Treat date-only end values as inclusive through 23:59:59.999 local/UTC
        // by moving the exclusive boundary to the next day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(end || ""))) to = new Date(to.getTime() + 86400000 - 1);
        if (from > to) return null;
        return { start: from.toISOString(), end: to.toISOString() };
    }

    function periodKey(bounds) { return `${bounds.start}|${bounds.end}`; }

    function diamondsForHost(hostId, bounds) {
        const start = Date.parse(bounds.start), end = Date.parse(bounds.end);
        let total = 0;
        for (const e of (giftByHost[hostId] || [])) {
            const t = Date.parse(e.timestamp);
            if (!Number.isFinite(t) || t < start || t > end) continue;
            const resetAt = cycleResets[String(hostId)];
            if (resetAt && t <= Date.parse(resetAt)) continue;
            const amount = Math.floor(Number(e.diamondAmount) || 0);
            if (amount > 0) total += amount;
        }
        return total;
    }

    function tierForDiamonds(diamonds) {
        let best = null;
        for (const level of policy.levels) {
            if (diamonds >= level.targetDiamonds) best = level;
            else break;
        }
        return best;
    }

    function cashEstimate(rewardBeans, user) {
        const cp = countryPolicy(user);
        const usd = rewardBeans / policy.beansPerUsd;
        return {
            usd: Number(usd.toFixed(6)),
            local: Number((usd * cp.usdLocalRate * policy.exchangeRate).toFixed(2)),
            currency: cp.currency,
            exchangeRate: policy.exchangeRate,
            usdLocalRate: cp.usdLocalRate
        };
    }

    function hostCandidates(bounds, country) {
        const result = [];
        for (const u of Object.values(users)) {
            if (!u || !u.userId || !u.isHost) continue;
            if (country && !actorCountryMatches(u, country)) continue;
            const diamonds = diamondsForHost(u.userId, bounds);
            const tier = tierForDiamonds(diamonds);
            const cp = countryPolicy(u);
            const autoPaid = payouts.some((p) => p.method === "automatic" && p.userId === u.userId && p.periodKey === periodKey(bounds) && p.status === "completed");
            const rewardBeans = diamonds > 0 ? Math.floor(diamonds * 3) : 0;
            result.push({
                userId: u.userId,
                name: u.name || "User",
                agencyId: null,
                agencyName: null,
                countryId: u.countryId || "OTHERS",
                country: cp.name,
                diamonds,
                level: tier ? tier.level : null,
                targetDiamonds: diamonds,
                rewardBeans,
                cashEstimate: cashEstimate(rewardBeans, u),
                eligible: rewardBeans > 0,
                alreadyPaid: autoPaid,
                payoutStatus: autoPaid ? "paid" : rewardBeans > 0 ? "eligible" : "not_eligible"
            });
        }
        return result;
    }

    function actorCountryMatches(user, country) {
        const c = String(country).toUpperCase();
        return String(user.country || "").toUpperCase() === c || String(user.countryId || "").toUpperCase() === c;
    }

    function ownerOnly(req, res, next) {
        if (!req.adminAccount || req.adminAccount.role !== rbac.ROLES.OWNER) {
            return res.status(403).json({ success: false, message: "Host Salary is Owner-only" });
        }
        next();
    }

    function makePayoutId(prefix = "salary") {
        return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
    }

    function completeBeanCredit({ userId, amount, note, payoutId, actor, notifyLabel = "Beans Received" }) {
        const found = findUserByUserId(userId);
        const creditAmount = Math.floor(Number(amount));
        if (!found) return { success: false, message: "User not found" };
        if (!Number.isSafeInteger(creditAmount) || creditAmount <= 0) return { success: false, message: "Invalid beans amount" };

        const user = found.user;
        const before = Math.max(0, Math.floor(Number(user.beans) || 0));
        const next = clampBeansBalance(userId, before + creditAmount, "host-salary");
        if (!Number.isSafeInteger(next) || next <= before) return { success: false, message: "Invalid beans amount" };

        // The user object is the authoritative wallet record. Persist it before
        // publishing the live update so refresh/re-login can never observe a
        // notification for a credit that was not written to users.json.
        user.beans = next;
        saveUsers({ immediate: true });
        logTransaction(userId, "beans", creditAmount, `${note} [${payoutId}]`);
        pushWalletUpdate(userId);

        // Notification is deliberately after the wallet mutation. A failed
        // notification must never roll back or invalidate a successful credit.
        if (typeof sendSystemMessage === "function") {
            const label = String(notifyLabel || "Beans Received").trim() || "Beans Received";
            sendSystemMessage(userId, `${label} — ${creditAmount.toLocaleString()} Beans credited to your account.`);
        }

        return { success: true, before, after: next };
    }

    function recordPayout(entry) {
        payouts.push(entry);
        // Keep a long audit history but avoid pathological growth.
        if (payouts.length > 100000) payouts.splice(0, payouts.length - 100000);
        savePayouts();
    }

    function payoutAutomatic(item, bounds, req) {
        const pKey = periodKey(bounds);
        if (payouts.some((p) => p.method === "automatic" && p.userId === item.userId && p.periodKey === pKey && p.status === "completed")) {
            return { success: false, skipped: true, message: "Already paid for this period" };
        }
        const userFound = findUserByUserId(item.userId);
        if (!userFound || !userFound.user.isHost) {
            return { success: false, skipped: true, message: "Host is no longer active" };
        }
        const payoutId = makePayoutId();
        const entry = {
            payoutId, method: "automatic", status: "pending",
            userId: item.userId, agencyId: item.agencyId,
            countryId: userFound.user.countryId || "OTHERS",
            periodKey: pKey, periodStart: bounds.start, periodEnd: bounds.end,
            diamonds: item.diamonds, level: item.level,
            targetDiamonds: item.targetDiamonds, beans: item.rewardBeans,
            createdAt: new Date().toISOString(),
            adminId: req.adminAccount.id, adminUsername: req.adminAccount.username
        };
        // A pending entry makes concurrent requests converge on the same
        // period/user pair. It is upgraded to completed only after the
        // actual wallet mutation and transaction log succeed.
        recordPayout(entry);
        const credit = completeBeanCredit({ userId: item.userId, amount: item.rewardBeans, note: `Host salary level ${item.level}`, payoutId, actor: req.adminAccount, notifyLabel: "Salary Received" });
        if (!credit.success) {
            entry.status = "failed"; entry.failureReason = credit.message; entry.updatedAt = new Date().toISOString(); savePayouts();
            return { success: false, message: credit.message };
        }
        entry.status = "completed"; entry.beansBefore = credit.before; entry.beansAfter = credit.after; entry.completedAt = new Date().toISOString();
        entry.targetResetAt = entry.completedAt;
        cycleResets[String(item.userId)] = entry.completedAt;
        saveCycleResets();
        savePayouts();
        rbac.logAction({ admin: req.adminAccount, action: "host-salary-auto-send", module: "host-salary", targetType: "user", targetId: item.userId, after: entry, ip: req.ip, userAgent: reqUserAgent(req) });
        return { success: true, payout: entry };
    }

    // ==================================================
    // ADMIN API
    // ==================================================
    const requireSalary = [requireAdmin, requirePermission("host-salary:manage"), ownerOnly];

    app.get("/api/admin/host-salary/policy", ...requireSalary, (req, res) => {
        res.json({ success: true, policy });
    });

    app.put("/api/admin/host-salary/policy", ...requireSalary, (req, res) => {
        const next = normalizePolicy({ ...policy, ...(req.body || {}), countries: { ...policy.countries, ...((req.body || {}).countries || {}) } });
        const before = policy;
        policy = next; savePolicy();
        rbac.logAction({ admin: req.adminAccount, action: "host-salary-policy-update", module: "host-salary", before, after: next, ip: req.ip, userAgent: reqUserAgent(req) });
        res.json({ success: true, policy });
    });

    app.get("/api/admin/host-salary/preview", ...requireSalary, (req, res) => {
        const bounds = periodBounds(req.query.from, req.query.to);
        if (!bounds) return res.status(400).json({ success: false, message: "Invalid period" });
        const country = req.query.country ? String(req.query.country).toUpperCase() : null;
        if (country && !rbac.COUNTRY_IDS.includes(country) && !policy.countries[country]) return res.status(400).json({ success: false, message: "Unknown country" });
        const rows = hostCandidates(bounds, country);
        const eligible = rows.filter((r) => r.eligible && !r.alreadyPaid);
        res.json({ success: true, period: bounds, periodKey: periodKey(bounds), rows, eligibleCount: eligible.length, totalBeans: eligible.reduce((s, r) => s + r.rewardBeans, 0) });
    });

    app.post("/api/admin/host-salary/send-all", ...requireSalary, (req, res) => {
        const bounds = periodBounds(req.body && req.body.from, req.body && req.body.to);
        if (!bounds) return res.status(400).json({ success: false, message: "Invalid period" });
        const country = req.body && req.body.country ? String(req.body.country).toUpperCase() : null;
        if (country && !rbac.COUNTRY_IDS.includes(country) && !policy.countries[country]) return res.status(400).json({ success: false, message: "Unknown country" });
        const rows = hostCandidates(bounds, country).filter((r) => r.eligible && !r.alreadyPaid);
        const results = [];
        for (const item of rows) results.push(payoutAutomatic(item, bounds, req));
        const sent = results.filter((r) => r.success);
        const failed = results.filter((r) => !r.success && !r.skipped);
        const batchId = makePayoutId("host-batch");
        const sentPayouts = sent.map((r) => r.payout);
        sentPayouts.forEach((p) => { p.batchId = batchId; });
        if (sentPayouts.length) savePayouts();
        const report = {
            reportId: batchId, batchId, type: "host-salary", createdAt: new Date().toISOString(),
            periodStart: bounds.start, periodEnd: bounds.end, country: country || "ALL",
            adminId: req.adminAccount.id, adminUsername: req.adminAccount.username,
            eligible: rows.length, sent: sent.length, failed: failed.length,
            totalBeans: sentPayouts.reduce((sum, p) => sum + Number(p.beans || 0), 0),
            payoutIds: sentPayouts.map((p) => p.payoutId)
        };
        reports[report.reportId] = report;
        saveReports();
        rbac.logAction({ admin: req.adminAccount, action: "host-salary-auto-batch", module: "host-salary", targetType: "batch", targetId: batchId, meta: { country, eligible: rows.length, sent: sent.length, failed: failed.length, beans: report.totalBeans, reportId: report.reportId }, ip: req.ip, userAgent: reqUserAgent(req), result: failed.length ? "failed" : "success", failureReason: failed.length ? "one or more payouts failed" : null });
        res.json({ success: true, period: bounds, eligible: rows.length, sent: sent.length, failed: failed.length, skipped: results.filter((r) => r.skipped).length, batchId, reportId: report.reportId, payouts: sentPayouts, failures: failed });
    });

    app.post("/api/admin/host-salary/manual-host", ...requireSalary, (req, res) => {
        const userId = String(req.body && req.body.userId || "").trim();
        const amount = Math.floor(Number(req.body && req.body.beans));
        const reason = String(req.body && req.body.reason || "Manual host salary").trim().slice(0, 300) || "Manual host salary";
        if (!userId || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "Valid User ID and positive Beans amount are required" });
        const found = findUserByUserId(userId);
        if (!found || !found.user.isHost) return res.status(400).json({ success: false, message: "User must be an active Host" });
        const payoutId = makePayoutId("manual");
        const credit = completeBeanCredit({ userId, amount, note: reason, payoutId, actor: req.adminAccount, notifyLabel: "Beans Received" });
        if (!credit.success) return res.status(400).json(credit);
        const entry = { payoutId, method: "manual-host", status: "completed", userId, agencyId: found.user.agencyId, countryId: found.user.countryId || "OTHERS", beans: amount, beansBefore: credit.before, beansAfter: credit.after, reason, createdAt: new Date().toISOString(), targetResetAt:new Date().toISOString(), adminId: req.adminAccount.id, adminUsername: req.adminAccount.username };
        cycleResets[String(userId)] = entry.targetResetAt;
        saveCycleResets();
        recordPayout(entry);
        rbac.logAction({ admin: req.adminAccount, action: "host-salary-manual-host", module: "host-salary", targetType: "user", targetId: userId, after: entry, ip: req.ip, userAgent: reqUserAgent(req) });
        res.json({ success: true, payout: entry });
    });


    app.get("/api/admin/host-salary/pdf", ...requireSalary, (req, res) => {
        const reportId = String(req.query.reportId || "").trim();
        const report = reports[reportId];
        if (!report || report.type !== "host-salary") return res.status(404).json({ success: false, message: "Salary report not found" });
        const reportPayouts = (report.payoutIds || []).map((id) => payouts.find((p) => p && p.payoutId === id)).filter(Boolean);
        if (!reportPayouts.length) return res.status(409).json({ success: false, message: "No salary payouts found for this report" });
        const pdf = buildHostSalaryBatchPdf(report, reportPayouts);
        res.set("Content-Type", "application/pdf");
        res.set("Content-Disposition", `attachment; filename="PINGPONG-HOST-SALARY-${report.batchId}.pdf"`);
        res.set("Cache-Control", "no-store");
        res.send(pdf);
    });

    app.get("/api/admin/host-salary/payouts", ...requireSalary, (req, res) => {
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
        const list = payouts.slice().reverse().slice(0, limit);
        res.json({ success: true, payouts: list });
    });

    return { getPolicy: () => policy, getPayouts: () => payouts, getReports: () => reports };
}


function buildHostSalaryBatchPdf(report, payouts) {
    const esc = (value) => String(value == null ? "" : value)
        .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
        .replace(/[^\x20-\x7E]/g, "?");
    const fmt = (n) => Number(n || 0).toLocaleString("en-US");
    const pages = [];
    let current = [
        ["PINGPONG", 805, 22], ["HOST SALARY PAYMENT REPORT", 778, 16],
        [`Batch ID: ${report.batchId}`, 752, 9],
        [`Period: ${report.periodStart} to ${report.periodEnd}`, 730, 9],
        [`Country: ${report.country || "ALL"}   Admin: ${report.adminUsername || report.adminId || "-"}`, 708, 9],
        [`Eligible: ${report.eligible}   Paid: ${report.sent}   Failed: ${report.failed}   Total Beans: ${fmt(report.totalBeans)}`, 686, 10],
        ["HOST ID / TARGET / LEVEL / BEANS / PAYOUT ID", 654, 10]
    ];
    let y = 632;
    const flush = () => { pages.push(current); current = [["PINGPONG — HOST SALARY (CONTINUED)", 805, 16], [`Batch ID: ${report.batchId}`, 778, 9], ["HOST ID / TARGET / LEVEL / BEANS / PAYOUT ID", 754, 10]]; y = 732; };
    payouts.forEach((p) => {
        if (y < 92) flush();
        current.push([`${p.userId} | Target ${fmt(p.diamonds)} | Lv.${p.level || "-"} | ${fmt(p.beans)} Beans`, y, 9]); y -= 15;
        current.push([`Payout: ${p.payoutId} | Status: ${String(p.status || "").toUpperCase()} | ${p.completedAt || p.createdAt || "-"}`, y, 7]); y -= 20;
    });
    current.push(["This document is an official PingPong host salary batch record.", Math.max(50, y - 8), 8]); pages.push(current);

    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    add("<< /Type /Catalog /Pages 2 0 R >>"); // 1
    // 2 is filled after pages are known
    const pagesObjIndex = add("");
    const pageIds = [];
    pages.forEach((pageLines) => {
        const content = ["BT", ...pageLines.map(([text, yy, size]) => `/F1 ${size} Tf 1 0 0 1 42 ${yy} Tm (${esc(text)}) Tj`), "ET"].join("\n");
        const contentId = add(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
        const pageId = add(`<< /Type /Page /Parent ${pagesObjIndex} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 0 0 R >> >> /Contents ${contentId} 0 R >>`);
        pageIds.push(pageId);
    });
    const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    // Patch font reference in page objects now that the font object exists.
    pageIds.forEach(id => { objects[id - 1] = objects[id - 1].replace("/F1 0 0 R", `/F1 ${fontId} 0 R`); });
    objects[pagesObjIndex - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let pdf = "%PDF-1.4\n"; const offsets = [0];
    objects.forEach((obj, i) => { offsets[i + 1] = Buffer.byteLength(pdf, "ascii"); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf, "ascii");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(pdf, "ascii");
}
module.exports = { initHostSalary, DEFAULT_POLICY, LEVELS, buildHostSalaryBatchPdf };
