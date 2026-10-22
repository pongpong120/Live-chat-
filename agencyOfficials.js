// ============================================================================
// AGENCY OFFICIAL / HANDLER CONTROL CENTER
// Keeps Agency -> Official ownership metadata separate from the core Agency
// record while mirroring the assignment onto the Agency for fast reads.
// ============================================================================
const path = require('path');
const crypto = require('crypto');

function initAgencyOfficials({ app, DATA_FOLDER, safeRead, safeWrite, agencies, saveAgencies,
    findUserByUserId, users, rbac, requireAdmin, requirePermission, actorCanAccessCountry,
    countryDeniedResponse, reqUserAgent }) {
    const FILE = path.join(DATA_FOLDER, 'agency_officials.json');
    let officials = safeRead(FILE, {});
    if (!officials || typeof officials !== 'object' || Array.isArray(officials)) officials = {};
    function save() { safeWrite(FILE, officials, { immediate: true }); }
    function userOfficial(user) {
        return !!(user && ((Array.isArray(user.activeBadges) && user.activeBadges.includes('official_tag')) || user.official === true));
    }
    function officialName(user) { return user ? (user.name || user.username || user.userId) : ''; }
    function ensureRecord(user, actor) {
        if (!user) return null;
        const id = String(user.userId);
        const old = officials[id] || {};
        const rec = officials[id] = {
            officialUserId: id,
            name: officialName(user),
            countryId: user.countryId || 'OTHERS',
            active: old.active !== false,
            assignedByAdminId: old.assignedByAdminId || (actor && actor.id) || null,
            assignedByAdminUsername: old.assignedByAdminUsername || (actor && actor.username) || null,
            assignedAt: old.assignedAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        return rec;
    }
    function safeJsonContains(value, needles) {
        try { const s = JSON.stringify(value || {}).toLowerCase(); return needles.some(n => s.includes(String(n).toLowerCase())); }
        catch (_) { return false; }
    }
    function agencyRowsFor(officialUserId, actor) {
        return Object.values(agencies).filter(a => a && String(a.officialUserId || '') === String(officialUserId)
            && actorCanAccessCountry(actor, a.countryId || 'OTHERS'))
            .map(a => ({ agencyId: a.agencyId, name: a.name, countryId: a.countryId || 'OTHERS', ownerUserId: a.ownerUserId, assignedAt: a.officialAssignedAt || null }));
    }

    // Summary: which Officials exist, how many Agencies each handles, and
    // which Admin/Super Admin originally assigned them.
    app.get('/api/admin/agency-officials', requireAdmin, requirePermission('agencies:view'), (req, res) => {
        const rows = [];
        for (const [id, raw] of Object.entries(officials)) {
            const found = findUserByUserId(id);
            if (!found || !actorCanAccessCountry(req.adminAccount, found.user.countryId || raw.countryId || 'OTHERS')) continue;
            const rec = ensureRecord(found.user, null);
            rows.push({ ...rec, agencyCount: agencyRowsFor(id, req.adminAccount).length, agencies: agencyRowsFor(id, req.adminAccount) });
        }
        // Also surface Official-tagged users even before their first Agency assignment.
        for (const candidate of Object.values(users || {})) {
            if (!userOfficial(candidate)) continue;
            const id = String(candidate.userId || '');
            if (!id || rows.some(x => x.officialUserId === id)) continue;
            if (!actorCanAccessCountry(req.adminAccount, candidate.countryId || 'OTHERS')) continue;
            const rec = officials[id] || { officialUserId:id, name:officialName(candidate), countryId:candidate.countryId || 'OTHERS', active:true };
            const ars = agencyRowsFor(id, req.adminAccount);
            rows.push({ ...rec, name:officialName(candidate), agencyCount:ars.length, agencies:ars });
        }
        const assignedBy = {};
        rows.forEach(r => {
            const k = r.assignedByAdminId || 'unknown';
            assignedBy[k] = (assignedBy[k] || 0) + 1;
        });
        const myAssignments = rows.filter(r => r.assignedByAdminId === req.adminAccount.id).length;
        res.json({ success: true, officials: rows.sort((a,b) => b.agencyCount-a.agencyCount || a.name.localeCompare(b.name)), totalOfficials: rows.length,
            totalAssignedAgencies: rows.reduce((s,r)=>s+r.agencyCount,0), assignedBy, assignedByMe: myAssignments });
    });

    app.put('/api/admin/agency/:agencyId/official', requireAdmin, requirePermission('agencies:manage'), (req, res) => {
        const agencyId = String(req.params.agencyId || '').trim();
        const agency = agencies[agencyId];
        if (!agency) return res.status(404).json({ success:false, message:'Agency not found' });
        if (!actorCanAccessCountry(req.adminAccount, agency.countryId || 'OTHERS')) return countryDeniedResponse(res);
        const officialUserId = String(req.body && req.body.officialUserId || '').trim();
        const before = { officialUserId: agency.officialUserId || null, officialName: agency.officialName || null,
            officialAssignedByAdminId: agency.officialAssignedByAdminId || null };
        if (!officialUserId) {
            delete agency.officialUserId; delete agency.officialName; delete agency.officialAssignedAt;
            delete agency.officialAssignedByAdminId; delete agency.officialAssignedByAdminUsername;
            saveAgencies();
            rbac.logAction({ admin:req.adminAccount, action:'agency-official-unassign', module:'agency', targetType:'agency', targetId:agencyId,
                before, after:{officialUserId:null}, meta:{agencyId}, ip:req.ip, userAgent:reqUserAgent(req) });
            return res.json({success:true, agency});
        }
        const found = findUserByUserId(officialUserId);
        if (!found) return res.status(404).json({success:false, message:'Official user not found'});
        const user = found.user;
        if (!actorCanAccessCountry(req.adminAccount, user.countryId || 'OTHERS')) return countryDeniedResponse(res);
        if ((user.countryId || 'OTHERS') !== (agency.countryId || 'OTHERS')) return res.status(400).json({success:false, message:'Official and Agency must belong to the same country'});
        if (!userOfficial(user)) return res.status(400).json({success:false, message:'This user is not marked as an Official. Assign the Official Tag first.'});
        const rec = ensureRecord(user, req.adminAccount);
        agency.officialUserId = user.userId;
        agency.officialName = officialName(user);
        agency.officialAssignedAt = new Date().toISOString();
        agency.officialAssignedByAdminId = req.adminAccount.id;
        agency.officialAssignedByAdminUsername = req.adminAccount.username;
        rec.updatedAt = agency.officialAssignedAt;
        save(); saveAgencies();
        rbac.logAction({ admin:req.adminAccount, action:'agency-official-assign', module:'agency', targetType:'agency', targetId:agencyId,
            before, after:{officialUserId:user.userId, officialName:agency.officialName, assignedAt:agency.officialAssignedAt},
            meta:{agencyId, officialUserId:user.userId, officialName:agency.officialName}, ip:req.ip, userAgent:reqUserAgent(req) });
        res.json({success:true, agency});
    });

    app.get('/api/admin/agency-officials/pdf', requireAdmin, requirePermission('agencies:view'), (req, res) => {
        const rows = [];
        for (const [id, raw] of Object.entries(officials)) {
            const found = findUserByUserId(id);
            if (!found || !actorCanAccessCountry(req.adminAccount, found.user.countryId || raw.countryId || 'OTHERS')) continue;
            const ars = agencyRowsFor(id, req.adminAccount);
            rows.push({ officialUserId:id, name:officialName(found.user), countryId:found.user.countryId || raw.countryId || 'OTHERS', agencyCount:ars.length, agencies:ars });
        }
        for (const candidate of Object.values(users || {})) {
            if (!userOfficial(candidate)) continue;
            const id = String(candidate.userId || '');
            if (!id || rows.some(x => x.officialUserId === id)) continue;
            if (!actorCanAccessCountry(req.adminAccount, candidate.countryId || 'OTHERS')) continue;
            const ars = agencyRowsFor(id, req.adminAccount);
            rows.push({ officialUserId:id, name:officialName(candidate), countryId:candidate.countryId || 'OTHERS', agencyCount:ars.length, agencies:ars });
        }
        rows.sort((a,b) => b.agencyCount-a.agencyCount || a.name.localeCompare(b.name));
        const pdf = buildOfficialsPdf(rows, req.adminAccount);
        res.set('Content-Type','application/pdf');
        res.set('Content-Disposition','attachment; filename="PINGPONG-OFFICIAL-AGENCY-NETWORK.pdf"');
        res.set('Cache-Control','no-store');
        res.send(pdf);
    });

    app.get('/api/admin/agency-officials/:officialUserId/inquiry', requireAdmin, requirePermission('agencies:view'), (req, res) => {
        const officialUserId = String(req.params.officialUserId || '').trim();
        const found = findUserByUserId(officialUserId);
        if (!found) return res.status(404).json({success:false,message:'Official not found'});
        if (!actorCanAccessCountry(req.adminAccount, found.user.countryId || 'OTHERS')) return countryDeniedResponse(res);
        const agenciesForOfficial = agencyRowsFor(officialUserId, req.adminAccount);
        const agencyIds = new Set(agenciesForOfficial.map(a=>String(a.agencyId)));
        const raw = officials[officialUserId] || { officialUserId, name: officialName(found.user), countryId: found.user.countryId || 'OTHERS' };
        let logs = [];
        if (rbac && typeof rbac.listLogs === 'function') {
            const result = rbac.listLogs(req.adminAccount, { page:1, pageSize:500, module:'agency' });
            logs = (result.entries || []).filter(l => {
                if (l.targetId === officialUserId) return true;
                if (safeJsonContains(l.meta, [officialUserId]) || safeJsonContains(l.before, [officialUserId]) || safeJsonContains(l.after, [officialUserId])) return true;
                return agencyIds.has(String(l.targetId || ''));
            }).slice(0,200);
        }
        const counts = {};
        logs.forEach(l => counts[l.action] = (counts[l.action] || 0) + 1);
        res.json({success:true, official:{officialUserId, name:officialName(found.user), countryId:found.user.countryId||'OTHERS',
            assignedByAdminId:raw.assignedByAdminId||null, assignedByAdminUsername:raw.assignedByAdminUsername||null, assignedAt:raw.assignedAt||null},
            agencies:agenciesForOfficial, activity:logs, actionCounts:counts});
    });

    return { officials };
}

function buildOfficialsPdf(rows, admin) {
    const esc = (value) => String(value == null ? "" : value)
        .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
        .replace(/[^\x20-\x7E]/g, "?");
    const pages=[]; let cur=[["PINGPONG",805,22],["OFFICIAL / AGENCY NETWORK REPORT",778,16],
        [`Admin: ${(admin&&admin.username)||"-"}   Officials: ${rows.length}   Active Agencies: ${rows.reduce((n,r)=>n+r.agencyCount,0)}`,752,9],
        ["OFFICIAL PERSONAL ID / NAME / COUNTRY / ACTIVE AGENCIES",726,10]]; let y=704;
    const flush=()=>{pages.push(cur);cur=[["PINGPONG — OFFICIAL NETWORK (CONTINUED)",805,16],["OFFICIAL PERSONAL ID / NAME / COUNTRY / ACTIVE AGENCIES",778,10]];y=756;};
    rows.forEach(r=>{if(y<120)flush();cur.push([`${r.officialUserId} | ${r.name} | ${r.countryId} | ${r.agencyCount} Agencies`,y,9]);y-=16;
        (r.agencies||[]).forEach(a=>{if(y<70)flush();cur.push([`  Agency: ${a.agencyId} | ${a.name} | Handler/Owner: ${a.ownerUserId}`,y,8]);y-=14;});y-=6;});
    cur.push(["This document is an official PingPong Official/Agency management report.",Math.max(50,y-8),8]);pages.push(cur);
    const objects=[];const add=b=>{objects.push(b);return objects.length};add("<< /Type /Catalog /Pages 2 0 R >>");const pagesId=add("");const pageIds=[];
    pages.forEach(lines=>{const content=["BT",...lines.map(([t,yy,z])=>`/F1 ${z} Tf 1 0 0 1 42 ${yy} Tm (${esc(t)}) Tj`),"ET"].join("\n");const cid=add(`<< /Length ${Buffer.byteLength(content,"ascii")} >>\nstream\n${content}\nendstream`);const pid=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 0 0 R >> >> /Contents ${cid} 0 R >>`);pageIds.push(pid);});
    const fid=add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");pageIds.forEach(id=>objects[id-1]=objects[id-1].replace("/F1 0 0 R",`/F1 ${fid} 0 R`));objects[pagesId-1]=`<< /Type /Pages /Kids [${pageIds.map(id=>id+" 0 R").join(" ")}] /Count ${pageIds.length} >>`;
    let pdf="%PDF-1.4\n";const off=[0];objects.forEach((o,i)=>{off[i+1]=Buffer.byteLength(pdf,"ascii");pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const x=Buffer.byteLength(pdf,"ascii");pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<=objects.length;i++)pdf+=`${String(off[i]).padStart(10,"0")} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;return Buffer.from(pdf,"ascii");
}
module.exports = { initAgencyOfficials };
