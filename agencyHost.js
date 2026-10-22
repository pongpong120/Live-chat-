// ==================================================
// PHASE 3 — AGENCY & HOST SYSTEM
// ==================================================
// Additive module, same pattern as svip.js / coinCenter.js: server.js hands
// this its live in-memory state (users, rooms, agencies, sockets) and a few
// helper functions, and this file only ever reads that state or appends to
// it through the functions it was given (saveUsers, saveAgencies, ...). It
// never touches Wallet, Login, Session, Room, or core Gift logic.
//
// Gift History reuse: this module builds ONE extra in-memory index —
// giftHistoryByHost — from the existing `giftHistory` array server.js
// already maintains. It does not create a second gift-tracking table and
// does not write to gift_history.json itself; recordGiftHistory() in
// server.js remains the only writer. New gifts reach this module through
// registerGiftRecordedHook(), which server.js calls once per successful
// gift, right after it's already been written to gift_history.json.
//
// Gift Tracking Rule (mandatory, see README/spec): a gift only counts
// toward a host/agency if entry.hostId === that host's userId. Since
// server.js already sets hostId to `rooms[roomId].hostId` (the room's
// owner) at the moment the gift is recorded — not to whoever the gift was
// visually aimed at — a host only ever accumulates gifts sent while inside
// their OWN room. If that same person joins someone else's room, gifts
// sent there carry that other room's hostId instead, so they never count
// here. No extra filtering logic was needed for this rule; it falls out of
// how Gift History was already being recorded.

const path = require("path");
const crypto = require("crypto");

function initAgencyHost(deps) {
    const {
        app, io, DATA_FOLDER, safeRead, safeWrite,
        users, findUserByUserId, saveUsers,
        agencies, saveAgencies,
        rooms, socketsByUserId, emitToUser,
        giftHistory, registerGiftRecordedHook, periodStart,
        privateMessages, saveMessages, conversationKey,
        INSTANT_EXCHANGE_ESTIMATE_RATE, userAuth, rbac, requireAdmin, requirePermission, actorCanAccessCountry, countryDeniedResponse, reqUserAgent
    } = deps;
    const requireUserAuth = userAuth && typeof userAuth.requireUserAuth === "function"
        ? userAuth.requireUserAuth
        : (req, res, next) => next();
    // Some isolated module tests inject only the dependencies they exercise.
    // Production always supplies requirePermission; keep route registration
    // test-safe without weakening production RBAC.
    const requireAgencyView = typeof requirePermission === "function"
        ? requirePermission("agencies:view")
        : (req, res, next) => next();
    const requireAgencyManage = typeof requirePermission === "function"
        ? requirePermission("agencies:manage")
        : (req, res, next) => next();

    // ---------- Agency Invites (separate small store; PM messages just
    // carry a pointer (inviteId) to a record here, same pattern gift
    // history uses roomId as a pointer rather than duplicating room data) ----------
    const AGENCY_INVITES_FILE = path.join(DATA_FOLDER, "agency_invites.json");
    let agencyInvites = safeRead(AGENCY_INVITES_FILE, {});
    function saveAgencyInvites() { safeWrite(AGENCY_INVITES_FILE, agencyInvites); }

    // Premium Agency Center support stores. These are intentionally separate
    // from gift history and wallet ledgers: applications/sub-agencies are
    // management metadata, while all money/diamonds remain server-authoritative
    // in the existing gift + wallet systems.
    const AGENCY_APPLICATIONS_FILE = path.join(DATA_FOLDER, "agency_applications.json");
    let agencyApplications = safeRead(AGENCY_APPLICATIONS_FILE, {});
    if (!agencyApplications || typeof agencyApplications !== "object" || Array.isArray(agencyApplications)) agencyApplications = {};
    function saveAgencyApplications() { safeWrite(AGENCY_APPLICATIONS_FILE, agencyApplications); }

    const AGENCY_SUBAGENCIES_FILE = path.join(DATA_FOLDER, "agency_subagencies.json");
    let agencySubAgencies = safeRead(AGENCY_SUBAGENCIES_FILE, {});
    if (!agencySubAgencies || typeof agencySubAgencies !== "object" || Array.isArray(agencySubAgencies)) agencySubAgencies = {};
    function saveAgencySubAgencies() { safeWrite(AGENCY_SUBAGENCIES_FILE, agencySubAgencies); }

    function ownerActor(req) {
        const actor = users[req.authedMobile];
        return actor && actor.userId ? actor : null;
    }
    function ownerAgency(req, agencyId) {
        const actor = ownerActor(req);
        const agency = agencies[String(agencyId)];
        return actor && agency && agency.ownerUserId === actor.userId ? agency : null;
    }
    function agencyPeriodEntries(agencyId, period) {
        const since = periodStart(period);
        return giftHistory.filter((e) => String(e && e.agencyId) === String(agencyId) &&
            ["confirmed", "success", "completed"].includes(String(e.status || "confirmed").toLowerCase()) &&
            new Date(e.timestamp || e.time || 0).getTime() >= since);
    }
    function agencyLevel(monthlyDiamonds) {
        const n = Number(monthlyDiamonds) || 0;
        if (n >= 20000000) return { key: "S", label: "Level S", next: 50000000 };
        if (n >= 10000000) return { key: "A+", label: "Level A+", next: 20000000 };
        if (n >= 4000000) return { key: "A", label: "Level A", next: 10000000 };
        return { key: "B", label: "Level B", next: 4000000 };
    }

    // Owner-only applications: Hosts can request to join an Agency by ID;
    // the Agency owner reviews/approves from Application Review.
    app.post("/api/agency/apply", requireUserAuth, (req, res) => {
        const actor = ownerActor(req);
        const agencyId = String(req.body && req.body.agencyId || "").trim();
        const agency = agencies[agencyId];
        if (!actor) return res.status(401).json({ success: false, message: "Authentication required" });
        if (!agency) return res.status(404).json({ success: false, message: "Agency not found" });
        if (actor.agencyId) return res.status(409).json({ success: false, message: "You already belong to an Agency" });
        const duplicate = Object.values(agencyApplications).find((x) => x && x.agencyId === agencyId && x.userId === actor.userId && x.status === "pending");
        if (duplicate) return res.json({ success: false, message: "Application already pending" });
        const applicationId = "app_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
        agencyApplications[applicationId] = { applicationId, agencyId, userId: actor.userId, name: actor.name || "User", photo: actor.photo || "", status: "pending", createdAt: new Date().toISOString() };
        saveAgencyApplications();
        emitToUser(agency.ownerUserId, "agency-application-update", { agencyId });
        res.json({ success: true, application: agencyApplications[applicationId] });
    });

    app.get("/api/agency/applications/:agencyId", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.params.agencyId);
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        const applications = Object.values(agencyApplications).filter((x) => x && x.agencyId === agency.agencyId && x.status === "pending").sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
        res.json({ success: true, applications });
    });

    app.post("/api/agency/applications/:applicationId/respond", requireUserAuth, (req, res) => {
        const appRecord = agencyApplications[req.params.applicationId];
        if (!appRecord) return res.status(404).json({ success: false, message: "Application not found" });
        const agency = ownerAgency(req, appRecord.agencyId);
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        const action = String(req.body && req.body.action || "").toLowerCase();
        if (!["accept","reject"].includes(action) || appRecord.status !== "pending") return res.status(400).json({ success: false, message: "Invalid application action" });
        if (action === "accept") {
            const found = findUserByUserId(appRecord.userId);
            if (!found) return res.status(404).json({ success: false, message: "Applicant not found" });
            if (found.user.agencyId && found.user.agencyId !== agency.agencyId) return res.status(409).json({ success: false, message: "Applicant already belongs to another Agency" });
            found.user.isHost = true; found.user.agencyId = agency.agencyId;
            agency.hostIds = Array.isArray(agency.hostIds) ? agency.hostIds : [];
            if (!agency.hostIds.includes(appRecord.userId)) agency.hostIds.push(appRecord.userId);
            saveUsers(); saveAgencies();
            appRecord.status = "accepted"; appRecord.resolvedAt = new Date().toISOString(); saveAgencyApplications();
            emitToUser(appRecord.userId, "host-status-update", { isHost: true, agencyId: agency.agencyId });
        } else {
            appRecord.status = "rejected"; appRecord.resolvedAt = new Date().toISOString(); saveAgencyApplications();
        }
        res.json({ success: true, status: appRecord.status });
    });

    // Owner-only host removal. Historical gifts stay intact; only the live
    // Agency membership changes, so reporting remains auditable.
    app.post("/api/agency/hosts/remove", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.body && req.body.agencyId);
        const hostUserId = String(req.body && req.body.hostUserId || "").trim();
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        if (!agency.hostIds.includes(hostUserId)) return res.status(404).json({ success: false, message: "Host is not in this Agency" });
        // Critical invariant: removing a host must NEVER detach/delete the Agency
        // from its owner. The owner may appear in hostIds in legacy data, so guard
        // this case explicitly instead of clearing owner.agencyId.
        if (String(agency.ownerUserId) === hostUserId) {
            return res.status(409).json({ success: false, message: "Agency Owner cannot be removed from Host Management. Change the Agency Owner first." });
        }
        const before = {
            agencyId: agency.agencyId,
            hostIds: Array.isArray(agency.hostIds) ? agency.hostIds.slice() : [],
            hostUserId
        };
        agency.hostIds = agency.hostIds.filter((id) => id !== hostUserId);
        const found = findUserByUserId(hostUserId);
        if (found && found.user.agencyId === agency.agencyId) { delete found.user.agencyId; found.user.isHost = false; saveUsers(); }
        saveAgencies();
        if (rbac && typeof rbac.logAction === "function") {
            rbac.logAction({
                admin: null, action: "agency-host-remove", module: "agency",
                targetType: "agency", targetId: agency.agencyId,
                before, after: { agencyId: agency.agencyId, hostIds: agency.hostIds.slice(), hostUserId },
                meta: { actorType: "agency-owner", hostUserId },
                result: "success"
            });
        }
        emitToUser(hostUserId, "host-status-update", { isHost: false, agencyId: null });
        emitToUser(agency.ownerUserId, "agency-host-list-update", { agencyId: agency.agencyId });
        res.json({ success: true });
    });

    // Admin Agency Control Center: inspect a single Agency's live membership
    // and append-only activity without exposing wallet internals.
    app.get("/api/admin/agency/:agencyId/control", requireAdmin, requireAgencyView, (req, res) => {
        const agencyId = String(req.params.agencyId || "").trim();
        const agency = agencies[agencyId];
        if (!agency) return res.status(404).json({ success: false, message: "Agency not found" });
        if (!actorCanAccessCountry(req.adminAccount, agency.countryId || "OTHERS")) return countryDeniedResponse(res);
        const hosts = (Array.isArray(agency.hostIds) ? agency.hostIds : []).map((id) => {
            const found = findUserByUserId(id);
            const u = found && found.user;
            return {
                userId: id,
                name: u ? (u.name || u.username || id) : id,
                username: u ? (u.username || "") : "",
                photo: u ? (u.photo || "") : "",
                online: !!(socketsByUserId && socketsByUserId[id]),
                isHost: !!(u && u.isHost),
                agencyId: u ? (u.agencyId || null) : null
            };
        });
        let activity = [];
        if (rbac && typeof rbac.listLogs === "function") {
            const result = rbac.listLogs(req.adminAccount, { page: 1, pageSize: 500 });
            activity = (result.entries || []).filter((l) => {
                if (!String(l.module || "").startsWith("agency")) return false;
                if (l.targetId === agencyId) return true;
                const blobs = [l.before, l.after, l.meta];
                return blobs.some((x) => {
                    try { return JSON.stringify(x || {}).includes(agencyId); } catch (_) { return false; }
                });
            }).slice(0, 200);
        }
        res.json({
            success: true,
            agency: {
                agencyId: agency.agencyId, name: agency.name, ownerUserId: agency.ownerUserId,
                countryId: agency.countryId || "OTHERS",
                commissionRate: Number(agency.commissionRate) || 0,
                weeklyTargetValue: Math.max(0, Math.floor(Number(agency.weeklyTargetValue) || 0)),
                status: agency.status || "active",
                hostCount: hosts.length,
                createdAt: agency.createdAt || null
            },
            hosts, activity
        });
    });

    app.post("/api/admin/agency/:agencyId/remove-host", requireAdmin, requireAgencyManage, (req, res) => {
        const agencyId = String(req.params.agencyId || "").trim();
        const hostUserId = String(req.body && req.body.hostUserId || "").trim();
        const agency = agencies[agencyId];
        if (!agency) return res.status(404).json({ success: false, message: "Agency not found" });
        if (!actorCanAccessCountry(req.adminAccount, agency.countryId || "OTHERS")) return countryDeniedResponse(res);
        if (!hostUserId || !Array.isArray(agency.hostIds) || !agency.hostIds.includes(hostUserId)) {
            return res.status(404).json({ success: false, message: "Host is not in this Agency" });
        }
        if (String(agency.ownerUserId) === hostUserId) {
            return res.status(409).json({ success: false, message: "Agency Owner cannot be removed from Host Management." });
        }
        const found = findUserByUserId(hostUserId);
        const before = {
            agencyId: agency.agencyId,
            hostIds: agency.hostIds.slice(),
            hostUserId,
            userAgencyId: found && found.user ? (found.user.agencyId || null) : null,
            isHost: found && found.user ? !!found.user.isHost : false
        };
        agency.hostIds = agency.hostIds.filter((id) => id !== hostUserId);
        if (found && found.user && found.user.agencyId === agency.agencyId) {
            delete found.user.agencyId;
            found.user.isHost = false;
            saveUsers();
        }
        saveAgencies();
        rbac.logAction({
            admin: req.adminAccount, action: "agency-host-remove", module: "agency",
            targetType: "agency", targetId: agency.agencyId, before,
            after: { agencyId: agency.agencyId, hostIds: agency.hostIds.slice(), hostUserId, removed: true },
            meta: { actorType: "admin", hostUserId },
            ip: req.ip, userAgent: reqUserAgent(req), result: "success"
        });
        emitToUser(hostUserId, "host-status-update", { isHost: false, agencyId: null });
        emitToUser(agency.ownerUserId, "agency-host-list-update", { agencyId: agency.agencyId });
        res.json({ success: true, agencyId, hostUserId });
    });

    // Admin-only Host Transfer: move one live Host from this Agency to another
    // Agency without creating a duplicate membership. Historical gift records are
    // intentionally left untouched; the Host's current agencyId changes only.
    app.post("/api/admin/agency/:agencyId/transfer-host", requireAdmin, requireAgencyManage, (req, res) => {
        const sourceAgencyId = String(req.params.agencyId || "").trim();
        const targetAgencyId = String(req.body && req.body.targetAgencyId || "").trim();
        const hostUserId = String(req.body && req.body.hostUserId || "").trim();
        const source = agencies[sourceAgencyId];
        const target = agencies[targetAgencyId];

        if (!source) return res.status(404).json({ success: false, message: "Source Agency not found" });
        if (!target) return res.status(404).json({ success: false, message: "Target Agency not found" });
        if (sourceAgencyId === targetAgencyId) return res.status(400).json({ success: false, message: "Source and target Agency must be different" });
        if (!actorCanAccessCountry(req.adminAccount, source.countryId || "OTHERS") ||
            !actorCanAccessCountry(req.adminAccount, target.countryId || "OTHERS")) {
            return countryDeniedResponse(res);
        }
        if ((source.status || "active") !== "active") return res.status(409).json({ success: false, message: "Source Agency is not active" });
        if ((target.status || "active") !== "active") return res.status(409).json({ success: false, message: "Target Agency is not active" });
        if ((source.countryId || "OTHERS") !== (target.countryId || "OTHERS")) {
            return res.status(409).json({ success: false, message: "Host transfer is allowed only within the same country" });
        }
        if (!hostUserId || !Array.isArray(source.hostIds) || !source.hostIds.includes(hostUserId)) {
            return res.status(404).json({ success: false, message: "Host is not in the source Agency" });
        }
        if (String(source.ownerUserId) === hostUserId) {
            return res.status(409).json({ success: false, message: "Agency Owner cannot be transferred as a Host." });
        }
        target.hostIds = Array.isArray(target.hostIds) ? target.hostIds : [];
        if (target.hostIds.includes(hostUserId)) {
            return res.status(409).json({ success: false, message: "Host is already in the target Agency" });
        }

        const found = findUserByUserId(hostUserId);
        if (!found || !found.user) return res.status(404).json({ success: false, message: "Host User not found" });
        if (found.user.agencyId && found.user.agencyId !== sourceAgencyId) {
            return res.status(409).json({ success: false, message: "Host's current Agency does not match the source Agency" });
        }

        const before = {
            sourceAgencyId,
            targetAgencyId,
            hostUserId,
            sourceHostIds: source.hostIds.slice(),
            targetHostIds: target.hostIds.slice(),
            userAgencyId: found.user.agencyId || null,
            isHost: !!found.user.isHost
        };

        // Mutate the three authoritative membership fields together, then persist.
        source.hostIds = source.hostIds.filter((id) => id !== hostUserId);
        target.hostIds.push(hostUserId);
        found.user.agencyId = targetAgencyId;
        found.user.isHost = true;
        saveUsers();
        saveAgencies();

        const after = {
            sourceAgencyId,
            targetAgencyId,
            hostUserId,
            sourceHostIds: source.hostIds.slice(),
            targetHostIds: target.hostIds.slice(),
            userAgencyId: found.user.agencyId,
            isHost: !!found.user.isHost
        };
        const auditBase = {
            admin: req.adminAccount,
            module: "agency",
            targetType: "host",
            targetId: hostUserId,
            before,
            after,
            meta: { actorType: "admin", sourceAgencyId, targetAgencyId, hostUserId },
            ip: req.ip,
            userAgent: reqUserAgent(req),
            result: "success"
        };
        rbac.logAction({ ...auditBase, action: "agency-host-transfer" });
        // A second scoped entry makes both Agency activity views discoverable.
        rbac.logAction({
            ...auditBase,
            action: "agency-host-transfer-in",
            targetType: "agency",
            targetId: targetAgencyId,
            meta: { actorType: "admin", sourceAgencyId, targetAgencyId, hostUserId }
        });
        emitToUser(hostUserId, "host-status-update", { isHost: true, agencyId: targetAgencyId });
        emitToUser(source.ownerUserId, "agency-host-list-update", { agencyId: sourceAgencyId });
        emitToUser(target.ownerUserId, "agency-host-list-update", { agencyId: targetAgencyId });

        res.json({
            success: true,
            sourceAgencyId,
            targetAgencyId,
            hostUserId,
            host: {
                userId: hostUserId,
                name: found.user.name || found.user.username || hostUserId,
                agencyId: targetAgencyId,
                isHost: true
            }
        });
    });

    // Whole-Agency lifecycle controls. Both operations are soft-state changes
    // so the Agency's audit/report history remains available; all live members
    // are detached so a removed/terminated Agency cannot keep granting access.
    function closeAgency(req, res, agency, finalStatus, action) {
        if (!agency) return res.status(404).json({ success: false, message: "Agency not found" });
        if (!actorCanAccessCountry(req.adminAccount, agency.countryId || "OTHERS")) return countryDeniedResponse(res);
        const before = {
            status: agency.status || "active", ownerUserId: agency.ownerUserId,
            hostIds: Array.isArray(agency.hostIds) ? agency.hostIds.slice() : []
        };
        const memberIds = Array.from(new Set([agency.ownerUserId].concat(Array.isArray(agency.hostIds) ? agency.hostIds : []).filter(Boolean)));
        memberIds.forEach((userId) => {
            const found = findUserByUserId(userId);
            if (found && found.user && found.user.agencyId === agency.agencyId) {
                delete found.user.agencyId;
                if (userId !== agency.ownerUserId) found.user.isHost = false;
                saveUsers();
            }
            emitToUser(userId, "agency-status-update", { agencyId: agency.agencyId, status: finalStatus, active: false });
            if (userId !== agency.ownerUserId) {
                emitToUser(userId, "host-status-update", { isHost: false, agencyId: null });
            }
        });
        agency.hostIds = [];
        agency.status = finalStatus;
        agency.closedAt = new Date().toISOString();
        agency.closedByAdminId = req.adminAccount.id;
        agency.closedByAdminUsername = req.adminAccount.username;
        saveAgencies();
        rbac.logAction({
            admin: req.adminAccount, action, module: "agency", targetType: "agency", targetId: agency.agencyId,
            before, after: { status: finalStatus, hostIds: [], detachedMembers: memberIds },
            ip: req.ip, userAgent: reqUserAgent(req), result: "success"
        });
        res.json({ success: true, agency, detachedMembers: memberIds.length });
    }

    app.post("/api/admin/agency/:agencyId/remove", requireAdmin, requireAgencyManage, (req, res) => {
        const agency = agencies[String(req.params.agencyId || "").trim()];
        return closeAgency(req, res, agency, "removed", "agency-remove");
    });

    app.post("/api/admin/agency/:agencyId/terminate", requireAdmin, requireAgencyManage, (req, res) => {
        const agency = agencies[String(req.params.agencyId || "").trim()];
        return closeAgency(req, res, agency, "terminated", "agency-terminate");
    });

    // Small, isolated sub-agency directory owned by the parent Agency.
    app.get("/api/agency/sub-agencies/:agencyId", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.params.agencyId);
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        const rows = Object.values(agencySubAgencies).filter((x) => x && x.parentAgencyId === agency.agencyId);
        res.json({ success: true, subAgencies: rows });
    });
    app.post("/api/agency/sub-agencies", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.body && req.body.parentAgencyId);
        const name = String(req.body && req.body.name || "").trim().slice(0, 80);
        const managerUserId = String(req.body && req.body.managerUserId || "").trim();
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        if (!name || !managerUserId) return res.status(400).json({ success: false, message: "Sub-agency name and manager User ID are required" });
        if (!findUserByUserId(managerUserId)) return res.status(404).json({ success: false, message: "Manager user not found" });
        const id = "subag_" + crypto.randomBytes(5).toString("hex");
        agencySubAgencies[id] = { subAgencyId: id, parentAgencyId: agency.agencyId, name, managerUserId, hostIds: [], createdAt: new Date().toISOString() };
        saveAgencySubAgencies();
        res.json({ success: true, subAgency: agencySubAgencies[id] });
    });

    app.get("/api/agency/settlements/:agencyId", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.params.agencyId);
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        const file = path.join(DATA_FOLDER, "agency_salary_periods.json");
        const periods = safeRead(file, {});
        const rows = Object.values(periods || {}).filter((x) => x && x.agencyId === agency.agencyId).sort((a,b) => new Date(b.periodStart)-new Date(a.periodStart)).slice(0, 24);
        res.json({ success: true, settlements: rows });
    });

    app.get("/api/agency/rewards/:agencyId", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.params.agencyId);
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        const file = path.join(DATA_FOLDER, "agency_ranking_rewards.json");
        const rawRewards = safeRead(file, []);
        const rows = (Array.isArray(rawRewards) ? rawRewards : []).filter((x) => x && x.agencyId === agency.agencyId).sort((a,b) => new Date(b.creditedAt)-new Date(a.creditedAt));
        res.json({ success: true, rewards: rows.slice(0, 24) });
    });

    app.get("/api/agency/report/:agencyId", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.params.agencyId);
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        const entries = giftHistory.filter((e) => String(e && e.agencyId) === String(agency.agencyId));
        const stats = statsPayload(entries);
        const level = agencyLevel(stats.monthlyDiamonds);
        const topHosts = (agency.hostIds || []).map((hid) => {
            const hf = findUserByUserId(hid);
            const hs = computeStats((giftHistoryByHost[hid] || []).filter((e) => e.agencyId === agency.agencyId));
            return { userId: hid, name: hf ? hf.user.name : "User", monthlyDiamonds: hs.monthly.diamonds, totalDiamonds: hs.total.diamonds };
        }).sort((a,b) => b.monthlyDiamonds-a.monthlyDiamonds);
        const week = agencyPeriodEntries(agency.agencyId, "weekly");
        const month = agencyPeriodEntries(agency.agencyId, "monthly");
        res.json({ success: true, generatedAt: new Date().toISOString(), agency: { agencyId: agency.agencyId, name: agency.name, commissionRate: Number(agency.commissionRate)||0, weeklyTargetValue: Number(agency.weeklyTargetValue)||0, level }, stats, weeklyConfirmedDiamonds: week.reduce((s,e)=>s+Number(e.diamondAmount||0),0), monthlyConfirmedDiamonds: month.reduce((s,e)=>s+Number(e.diamondAmount||0),0), topHosts: topHosts.slice(0,10) });
    });

    app.post("/api/agency/weekly-target", requireUserAuth, (req, res) => {
        const agency = ownerAgency(req, req.body && req.body.agencyId);
        const target = Number(req.body && req.body.weeklyTarget);
        if (!agency) return res.status(403).json({ success: false, message: "Permission denied" });
        if (!Number.isSafeInteger(target) || target < 0) return res.status(400).json({ success: false, message: "Weekly target must be a non-negative integer" });
        agency.weeklyTargetValue = target;
        if (!agency.weeklyTargetHistory || typeof agency.weeklyTargetHistory !== "object") agency.weeklyTargetHistory = {};
        const now = Date.now(), weekMs = 7*24*60*60*1000, start = Math.floor(now/weekMs)*weekMs, end = start+weekMs-1;
        const key = new Date(start).toISOString()+"|"+new Date(end).toISOString();
        agency.weeklyTargetHistory[key] = target;
        saveAgencies();
        res.json({ success: true, weeklyTarget: target });
    });

    // ---------- Gift History index, by host ----------
    // Built once from the existing giftHistory array (no duplicate file),
    // kept in sync afterwards via the onGiftRecorded hook.
    const giftHistoryByHost = {};
    giftHistory.forEach((entry) => {
        if (!entry.hostId) return;
        (giftHistoryByHost[entry.hostId] = giftHistoryByHost[entry.hostId] || []).push(entry);
    });

    function computeStats(entries) {
        const dSince = periodStart("daily"), wSince = periodStart("weekly"), mSince = periodStart("monthly");
        const daily = { count: 0, diamonds: 0 }, weekly = { count: 0, diamonds: 0 };
        const monthly = { count: 0, diamonds: 0 }, total = { count: 0, diamonds: 0 };
        entries.forEach((e) => {
            const t = new Date(e.timestamp).getTime();
            total.count++; total.diamonds += e.diamondAmount;
            if (t >= mSince) { monthly.count++; monthly.diamonds += e.diamondAmount; }
            if (t >= wSince) { weekly.count++; weekly.diamonds += e.diamondAmount; }
            if (t >= dSince) { daily.count++; daily.diamonds += e.diamondAmount; }
        });
        return { daily, weekly, monthly, total };
    }
    function statsPayload(entries) {
        const s = computeStats(entries);
        return {
            dailyGifts: s.daily.count, dailyDiamonds: s.daily.diamonds,
            weeklyGifts: s.weekly.count, weeklyDiamonds: s.weekly.diamonds,
            monthlyGifts: s.monthly.count, monthlyDiamonds: s.monthly.diamonds,
            totalGifts: s.total.count, totalDiamonds: s.total.diamonds,
            estimatedDiamondValue: Math.floor(s.total.diamonds * INSTANT_EXCHANGE_ESTIMATE_RATE)
        };
    }
    function giftDetail(entry) {
        const senderFound = findUserByUserId(entry.senderId);
        const room = rooms[entry.roomId];
        return {
            senderAvatar: senderFound ? (senderFound.user.photo || "") : "",
            senderName: senderFound ? senderFound.user.name : "User",
            senderUserId: entry.senderId,
            giftName: entry.giftName,
            diamondAmount: entry.diamondAmount,
            time: entry.timestamp,
            roomNumber: room ? (room.roomNumber || room.hostId) : (entry.roomId || "")
        };
    }

    // ==================================================
    // 1. AGENCY INVITE SYSTEM (via Private Messages)
    // ==================================================
    app.post("/api/agency/invite", requireUserAuth, (req, res) => {
        const actor = users[req.authedMobile];
        const fromUserId = actor ? actor.userId : null;
        const { agencyId, toUserId } = req.body;
        const agency = agencies[agencyId];
        if (!agency || agency.ownerUserId !== fromUserId) {
            return res.json({ success: false, message: "Only the Agency Owner can send invites" });
        }
        const target = findUserByUserId(toUserId);
        if (!target) return res.json({ success: false, message: "User not found" });
        if (agency.hostIds.includes(toUserId)) return res.json({ success: false, message: "They are already a Host of this Agency" });

        const inviteId = "inv_" + Date.now().toString(36) + "_" + crypto.randomBytes(4).toString("hex");
        agencyInvites[inviteId] = {
            inviteId, agencyId, fromUserId, toUserId,
            status: "pending", createdAt: new Date().toISOString()
        };
        saveAgencyInvites();

        const key = conversationKey(fromUserId, toUserId);
        if (!privateMessages[key]) privateMessages[key] = [];
        const msg = {
            from: fromUserId, to: toUserId,
            message: `Agency invitation: ${agency.name}`,
            time: new Date().toISOString(),
            type: "agency_invite",
            data: { inviteId, agencyId, agencyName: agency.name, agencyLogo: agency.logo || null, agencyIdDisplay: agencyId, status: "pending" }
        };
        privateMessages[key].push(msg);
        saveMessages();
        emitToUser(toUserId, "new-private-message", msg); // GAP #1 — cross-instance-safe
        res.json({ success: true, message: msg });
    });

    app.post("/api/agency/invite/respond", requireUserAuth, (req, res) => {
        const actor = users[req.authedMobile];
        const userId = actor ? actor.userId : null;
        const { inviteId, action } = req.body;
        const invite = agencyInvites[inviteId];
        if (!invite || invite.toUserId !== userId || invite.status !== "pending") {
            return res.json({ success: false, message: "This invitation is no longer active" });
        }
        const agency = agencies[invite.agencyId];
        if (!agency) return res.json({ success: false, message: "Agency not found" });

        const key = conversationKey(invite.fromUserId, invite.toUserId);
        const thread = privateMessages[key] || [];
        const msgIdx = thread.findIndex((m) => m.data && m.data.inviteId === inviteId);

        if (action === "accept") {
            const found = findUserByUserId(userId);
            if (!found) return res.json({ success: false, message: "User not found" });
            found.user.isHost = true;
            found.user.agencyId = invite.agencyId;
            if (!agency.hostIds.includes(userId)) agency.hostIds.push(userId);
            saveUsers(); saveAgencies();
            invite.status = "accepted"; saveAgencyInvites();
            if (msgIdx !== -1) { thread[msgIdx].data.status = "accepted"; saveMessages(); }

            // GAP #1 — cross-instance-safe via emitToUser()
            emitToUser(userId, "host-status-update", { isHost: true, agencyId: agency.agencyId });
            emitToUser(invite.fromUserId, "agency-host-list-update", { agencyId: agency.agencyId });
            return res.json({ success: true, status: "accepted" });
        }

        if (action === "decline") {
            invite.status = "declined"; saveAgencyInvites();
            // Spec: "Decline → Invitation is removed" — remove the card
            // from the shared thread rather than just marking it declined.
            if (msgIdx !== -1) { thread.splice(msgIdx, 1); saveMessages(); }
            emitToUser(invite.fromUserId, "agency-invite-updated", { inviteId, status: "declined" }); // GAP #1 — cross-instance-safe
            return res.json({ success: true, status: "declined" });
        }

        res.json({ success: false, message: "Unknown action" });
    });

    // Agency Owner sets/updates their own agency's logo. Reuses the
    // already-uploaded file URL from the existing generic
    // /api/room/logo/upload endpoint — no new upload handler needed.
    app.post("/api/agency/logo", requireUserAuth, (req, res) => {
        const actor = users[req.authedMobile];
        const ownerUserId = actor ? actor.userId : null;
        const { agencyId, logoUrl } = req.body;
        const agency = agencies[agencyId];
        if (!agency || agency.ownerUserId !== ownerUserId) return res.json({ success: false, message: "Permission denied" });
        agency.logo = logoUrl || null;
        saveAgencies();
        res.json({ success: true, agency });
    });

    // ==================================================
    // 2. HOST CENTER
    // ==================================================
    app.get("/api/host-center/:userId", requireUserAuth, (req, res) => {
        const actor = users[req.authedMobile];
        if (!actor || actor.userId !== String(req.params.userId)) return res.status(403).json({ success: false, message: "You can only access your own Host Center" });
        const found = findUserByUserId(req.params.userId);
        if (!found) return res.json({ success: false, message: "User not found" });
        if (!found.user.agencyId) return res.json({ success: false, message: "You are not a Host of any Agency yet" });
        const entries = giftHistoryByHost[req.params.userId] || [];
        res.json({ success: true, stats: statsPayload(entries) });
    });

    app.get("/api/host-center/:userId/gifts", requireUserAuth, (req, res) => {
        const actor = users[req.authedMobile];
        if (!actor || actor.userId !== String(req.params.userId)) return res.status(403).json({ success: false, message: "You can only access your own Host Center" });
        const found = findUserByUserId(req.params.userId);
        if (!found || !found.user.agencyId) return res.json({ success: false, message: "Permission denied" });
        const period = req.query.period || "all"; // daily | weekly | monthly | all
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        let entries = (giftHistoryByHost[req.params.userId] || []).slice().reverse();
        if (period !== "all") {
            const since = periodStart(period);
            entries = entries.filter((e) => new Date(e.timestamp).getTime() >= since);
        }
        res.json({ success: true, gifts: entries.slice(0, limit).map(giftDetail) });
    });

    // ==================================================
    // 3. AGENCY CENTER DASHBOARD
    // ==================================================
    app.get("/api/agency/dashboard/:agencyId", requireUserAuth, (req, res) => {
        const actor = users[req.authedMobile];
        const agency = agencies[req.params.agencyId];
        if (!agency) return res.json({ success: false, message: "Agency not found" });
        if (!actor || agency.ownerUserId !== actor.userId) {
            return res.status(403).json({ success: false, message: "Permission denied" });
        }
        let activeHosts = 0, dailyGifts = 0, weeklyGifts = 0, monthlyGifts = 0, totalDiamonds = 0;
        const hosts = agency.hostIds.map((hid) => {
            const hf = findUserByUserId(hid);
            // Belt-and-braces re-filter by agencyId too, in case a host was
            // ever moved between agencies — hostId alone already guarantees
            // "their own room only" per the tracking rule above.
            const entries = (giftHistoryByHost[hid] || []).filter((e) => e.agencyId === agency.agencyId);
            const s = computeStats(entries);
            const online = !!socketsByUserId[hid];
            if (online) activeHosts++;
            dailyGifts += s.daily.count; weeklyGifts += s.weekly.count; monthlyGifts += s.monthly.count;
            totalDiamonds += s.total.diamonds;
            return {
                userId: hid, name: hf ? (hf.user.name || hf.user.username || hid) : "User", photo: hf ? (hf.user.photo || "") : "", online,
                joinedAt: hf ? (hf.user.createdAt || hf.user.joinedAt || null) : null,
                dailyGifts: s.daily.count, dailyDiamonds: s.daily.diamonds,
                weeklyGifts: s.weekly.count, weeklyDiamonds: s.weekly.diamonds,
                monthlyGifts: s.monthly.count, monthlyDiamonds: s.monthly.diamonds,
                totalGifts: s.total.count, totalDiamonds: s.total.diamonds
            };
        });
        const monthlyLevel = agencyLevel(computeStats(agency.hostIds.flatMap((hid) => (giftHistoryByHost[hid] || []).filter((e) => e.agencyId === agency.agencyId))).monthly.diamonds);
        const weeklyTarget = Math.max(0, Math.floor(Number(agency.weeklyTargetValue) || 0));
        const weeklyDiamonds = agencyPeriodEntries(agency.agencyId, "weekly").reduce((sum, e) => sum + Number(e.diamondAmount || 0), 0);
        const weeklyPct = weeklyTarget > 0 ? Math.min(100, Math.floor((weeklyDiamonds / weeklyTarget) * 100)) : 0;
        const pendingApplications = Object.values(agencyApplications).filter((x) => x && x.agencyId === agency.agencyId && x.status === "pending").length;
        const subAgencyCount = Object.values(agencySubAgencies).filter((x) => x && x.parentAgencyId === agency.agencyId).length;
        res.json({
            success: true,
            agency: { agencyId: agency.agencyId, name: agency.name, logo: agency.logo || null, commissionRate: agency.commissionRate,
                earnedDiamonds: agency.earnedDiamonds || 0, weeklyTargetValue: weeklyTarget, weeklyAchievementDiamonds: weeklyDiamonds, level: monthlyLevel, weeklyAchievementPercent: weeklyPct,
                officialUserId: agency.officialUserId || null, officialName: agency.officialName || null,
                officialAssignedByAdminUsername: agency.officialAssignedByAdminUsername || null, officialAssignedAt: agency.officialAssignedAt || null
            },
            totals: { totalHosts: agency.hostIds.length, activeHosts, dailyGifts, weeklyGifts, monthlyGifts, totalDiamonds, monthlyDiamonds: agencyPeriodEntries(agency.agencyId, "monthly").reduce((sum,e)=>sum+Number(e.diamondAmount||0),0) },
            management: { pendingApplications, subAgencyCount },
            hosts
        });
    });

    // ==================================================
    // 5. AGENCY <-> HOST SYNCHRONIZATION (live push)
    // ==================================================
    // Fires once per successful gift, after server.js has already written
    // it to gift_history.json — this only reads that same record.
    registerGiftRecordedHook((record) => {
        if (!record.hostId) return;
        (giftHistoryByHost[record.hostId] = giftHistoryByHost[record.hostId] || []).push(record);

        // GAP #1 — cross-instance-safe via emitToUser() (was socketsByUserId-gated, local-instance only)
        emitToUser(record.hostId, "host-stats-update", statsPayload(giftHistoryByHost[record.hostId]));
        emitToUser(record.hostId, "host-gift-received", giftDetail(record));
        if (record.agencyId) {
            const agency = agencies[record.agencyId];
            if (agency) emitToUser(agency.ownerUserId, "agency-stats-update", { agencyId: agency.agencyId });
        }
    });


    // ------------------------------------------------------------------
    // Control Panel — per-user Gift Inquiry
    // ------------------------------------------------------------------
    // This is intentionally read-only and uses the existing authoritative
    // giftHistory ledger. No client-supplied wallet/diamond values are trusted.
    function inquiryGiftRows(userId) {
        const id = String(userId || "").trim();
        return giftHistory
            .filter((g) => g && String(g.senderId || "") === id)
            .sort((x, y) => new Date(y.timestamp || 0).getTime() - new Date(x.timestamp || 0).getTime());
    }

    function buildUserInquiry(userId, rows) {
        const roomMap = {};
        const receiverMap = {};
        let totalDiamonds = 0;
        let totalGiftEvents = 0;
        rows.forEach((g) => {
            const diamonds = Math.max(0, Number(g.diamondAmount) || 0);
            totalDiamonds += diamonds;
            totalGiftEvents += 1;
            const roomId = String(g.roomId || "unknown");
            const room = rooms[roomId];
            const roomName = g.roomName || (room && (room.roomName || room.name)) || roomId;
            if (!roomMap[roomId]) roomMap[roomId] = { roomId, roomName, diamonds: 0, giftCount: 0 };
            roomMap[roomId].diamonds += diamonds;
            roomMap[roomId].giftCount += 1;

            const receiverId = String(g.receiverId || "room/host");
            if (!receiverMap[receiverId]) {
                const found = receiverId === "room/host" ? null : findUserByUserId(receiverId);
                receiverMap[receiverId] = {
                    receiverId,
                    receiverName: found && found.user ? (found.user.name || found.user.username || receiverId) : receiverId,
                    diamonds: 0,
                    giftCount: 0
                };
            }
            receiverMap[receiverId].diamonds += diamonds;
            receiverMap[receiverId].giftCount += 1;
        });
        return {
            userId: String(userId),
            totalDiamonds,
            totalGiftEvents,
            rooms: Object.values(roomMap).sort((a,b) => b.diamonds - a.diamonds),
            receivers: Object.values(receiverMap).sort((a,b) => b.diamonds - a.diamonds),
            gifts: rows.map(g => ({
                giftHistoryId: g.giftHistoryId || null,
                transactionId: g.transactionId || null,
                timestamp: g.timestamp || null,
                roomId: g.roomId || null,
                roomName: g.roomName || (g.roomId && rooms[g.roomId] ? (rooms[g.roomId].roomName || rooms[g.roomId].name) : null) || g.roomId || "Unknown Room",
                hostId: g.hostId || null,
                receiverId: g.receiverId || null,
                giftName: g.giftName || "Gift",
                giftId: g.giftId || null,
                quantity: Number(g.quantity) || 1,
                diamondAmount: Math.max(0, Number(g.diamondAmount) || 0)
            }))
        };
    }

    function pdfEscape(value) {
        return String(value == null ? "" : value)
            .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
            .replace(/[^\x20-\x7E]/g, "?");
    }

    function buildUserInquiryPdf(report, admin) {
        const pages = [];
        let page = [
            ["PINGPONG", 805, 22],
            ["USER GIFT / DIAMOND INQUIRY", 778, 16],
            [`Admin: ${(admin && admin.username) || "-"} | User ID: ${report.userId}`, 752, 9],
            [`Gift Events: ${report.totalGiftEvents} | Total Diamonds Spent: ${report.totalDiamonds}`, 736, 9],
            ["ROOM SUMMARY", 710, 11]
        ];
        let y = 692;
        const flush = () => {
            pages.push(page);
            page = [["PINGPONG - USER INQUIRY (CONTINUED)", 805, 16], ["GIFT TRANSACTION DETAIL", 778, 11]];
            y = 756;
        };
        report.rooms.forEach(r => {
            if (y < 100) flush();
            page.push([`${r.roomId} | ${r.roomName} | ${r.giftCount} gifts | ${r.diamonds} diamonds`, y, 9]);
            y -= 15;
        });
        y -= 10;
        if (y < 130) flush();
        page.push(["RECEIVER / TARGET SUMMARY", y, 11]); y -= 18;
        report.receivers.forEach(r => {
            if (y < 100) flush();
            page.push([`${r.receiverId} | ${r.receiverName} | ${r.giftCount} gifts | ${r.diamonds} diamonds`, y, 9]);
            y -= 15;
        });
        y -= 10;
        if (y < 130) flush();
        page.push(["FULL GIFT TRANSACTION HISTORY", y, 11]); y -= 18;
        report.gifts.forEach(g => {
            if (y < 75) flush();
            const stamp = g.timestamp ? new Date(g.timestamp).toISOString() : "-";
            const line = `${stamp} | ${g.roomId || "-"} | ${g.receiverId || "room/host"} | ${g.giftName} x${g.quantity} | ${g.diamondAmount} diamonds`;
            page.push([line, y, 7.5]); y -= 12;
        });
        if (y < 55) flush();
        page.push(["Report generated from the server-authoritative PingPong gift history ledger.", Math.max(40, y - 6), 7.5]);
        pages.push(page);

        const objects = [];
        const add = (body) => { objects.push(body); return objects.length; };
        add("<< /Type /Catalog /Pages 2 0 R >>");
        const pagesId = add("");
        const pageIds = [];
        pages.forEach(lines => {
            const content = ["BT", ...lines.map(([t, yy, size]) => `/F1 ${size} Tf 1 0 0 1 36 ${yy} Tm (${pdfEscape(t)}) Tj`), "ET"].join("\n");
            const cid = add(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
            const pid = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 0 0 R >> >> /Contents ${cid} 0 R >>`);
            pageIds.push(pid);
        });
        const fid = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
        pageIds.forEach(id => { objects[id - 1] = objects[id - 1].replace("/F1 0 0 R", `/F1 ${fid} 0 R`); });
        objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => id + " 0 R").join(" ")}] /Count ${pageIds.length} >>`;
        let pdf = "%PDF-1.4\n";
        const offsets = [0];
        objects.forEach((o, i) => { offsets[i + 1] = Buffer.byteLength(pdf, "ascii"); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
        const xref = Buffer.byteLength(pdf, "ascii");
        pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
        for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
        pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
        return Buffer.from(pdf, "ascii");
    }

    function canInspectUser(req, userId) {
        const found = findUserByUserId(userId);
        if (!found) return { error: { status: 404, message: "User not found" } };
        if (!actorCanAccessCountry(req.adminAccount, found.user.countryId || "OTHERS")) {
            return { error: { status: 403, message: "No permission to view this user's country data" } };
        }
        return { found };
    }

    app.get("/api/admin/user-inquiry/:userId", requireAdmin, requireAgencyView, (req, res) => {
        const userId = String(req.params.userId || "").trim();
        const check = canInspectUser(req, userId);
        if (check.error) return res.status(check.error.status).json({ success: false, message: check.error.message });
        const report = buildUserInquiry(userId, inquiryGiftRows(userId));
        res.json({ success: true, user: {
            userId,
            name: check.found.user.name || check.found.user.username || userId,
            countryId: check.found.user.countryId || "OTHERS"
        }, report });
    });

    app.get("/api/admin/user-inquiry/:userId/pdf", requireAdmin, requireAgencyView, (req, res) => {
        const userId = String(req.params.userId || "").trim();
        const check = canInspectUser(req, userId);
        if (check.error) return res.status(check.error.status).json({ success: false, message: check.error.message });
        const report = buildUserInquiry(userId, inquiryGiftRows(userId));
        const pdf = buildUserInquiryPdf(report, req.adminAccount);
        res.set("Content-Type", "application/pdf");
        res.set("Content-Disposition", `attachment; filename="PINGPONG-USER-INQUIRY-${pdfEscape(userId).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`);
        res.set("Cache-Control", "no-store");
        res.send(pdf);
    });

    // Agency-specific Control Center report: hosts, handler metadata and the
    // complete audit activity already visible in the Control Center.
    app.get("/api/admin/agency/:agencyId/control/pdf", requireAdmin, requireAgencyView, (req, res) => {
        const agencyId = String(req.params.agencyId || "").trim();
        const agency = agencies[agencyId];
        if (!agency) return res.status(404).json({ success: false, message: "Agency not found" });
        if (!actorCanAccessCountry(req.adminAccount, agency.countryId || "OTHERS")) return countryDeniedResponse(res);
        const hosts = (Array.isArray(agency.hostIds) ? agency.hostIds : []).map(id => {
            const f = findUserByUserId(id);
            return `${id} | ${f && f.user ? (f.user.name || f.user.username || id) : id}`;
        });
        let logs = [];
        if (rbac && typeof rbac.listLogs === "function") {
            const result = rbac.listLogs(req.adminAccount, { page: 1, pageSize: 500 });
            logs = (result.entries || []).filter(l => {
                if (String(l.module || "").startsWith("agency") && (l.targetId === agencyId || JSON.stringify([l.before,l.after,l.meta]).includes(agencyId))) return true;
                return false;
            }).slice(0, 500);
        }
        const report = {
            agencyId, name: agency.name, ownerUserId: agency.ownerUserId,
            countryId: agency.countryId || "OTHERS",
            handler: agency.handlerAdminUsername ? `${agency.handlerAdminName || agency.handlerAdminUsername} (${agency.handlerAdminUsername})` : "Not assigned",
            official: agency.officialName ? `${agency.officialName} (${agency.officialUserId || "-"})` : "Not assigned",
            hosts, logs
        };
        const pages = [];
        let page = [["PINGPONG",805,22],["AGENCY CONTROL REPORT",778,16],
            [`Agency: ${report.name} | ID: ${report.agencyId} | Country: ${report.countryId}`,752,9],
            [`Owner User ID: ${report.ownerUserId || "-"} | Control Admin: ${report.handler}`,736,9],
            [`Official: ${report.official} | Hosts: ${hosts.length}`,720,9],["HOSTS",696,11]];
        let y = 678;
        const flush = () => { pages.push(page); page = [["PINGPONG - AGENCY CONTROL (CONTINUED)",805,16],["AUDIT ACTIVITY",778,11]]; y=756; };
        hosts.forEach(h => { if(y<100)flush(); page.push([h,y,9]); y-=15; });
        y-=8; if(y<120)flush(); page.push(["AUDIT ACTIVITY",y,11]); y-=18;
        logs.forEach(l => { if(y<70)flush(); page.push([`${l.timestamp || "-"} | ${l.adminUsername || "system"} | ${l.action || "-"} | ${l.result || "success"}`,y,7.5]); y-=12; });
        pages.push(page);
        const objects=[]; const add=b=>{objects.push(b);return objects.length}; add("<< /Type /Catalog /Pages 2 0 R >>"); const pagesId=add(""); const pageIds=[];
        pages.forEach(lines=>{const content=["BT",...lines.map(([t,yy,z])=>`/F1 ${z} Tf 1 0 0 1 36 ${yy} Tm (${pdfEscape(t)}) Tj`),"ET"].join("\n"); const cid=add(`<< /Length ${Buffer.byteLength(content,"ascii")} >>\nstream\n${content}\nendstream`); const pid=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 0 0 R >> >> /Contents ${cid} 0 R >>`); pageIds.push(pid);});
        const fid=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); pageIds.forEach(id=>objects[id-1]=objects[id-1].replace("/F1 0 0 R",`/F1 ${fid} 0 R`)); objects[pagesId-1]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+" 0 R").join(" ")}] /Count ${pageIds.length} >>`;
        let pdf="%PDF-1.4\n"; const off=[0]; objects.forEach((o,i)=>{off[i+1]=Buffer.byteLength(pdf,"ascii");pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;}); const x=Buffer.byteLength(pdf,"ascii"); pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`; for(let i=1;i<=objects.length;i++)pdf+=`${String(off[i]).padStart(10,"0")} 00000 n \n`; pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
        res.set("Content-Type","application/pdf"); res.set("Content-Disposition", `attachment; filename="PINGPONG-AGENCY-${pdfEscape(agencyId).replace(/[^A-Za-z0-9_-]/g,"_")}-CONTROL.pdf"`); res.set("Cache-Control","no-store"); res.send(Buffer.from(pdf,"ascii"));
    });

    return {};
}

module.exports = { initAgencyHost };
