/* Country Command Center — centralized country-scoped operational control. */
const path = require('path');
const crypto = require('crypto');

function initControlCenter({ app, DATA_FOLDER, rbac, requireAdmin, requirePermission,
  actorCanAccessCountry, countryDeniedResponse, countryPermission, users, agencies,
  merchantRegistry, safeRead, safeWrite, reqUserAgent }) {
  const FILE = path.join(DATA_FOLDER, 'country_control_policies.json');
  const store = safeRead(FILE, {});

  const MODULES = [
    'users','rooms','live','gifts','recharge','withdrawals','agencies','hosts','merchant','seller','registration'
  ];
  const DEFAULTS = {
    enabled: true, maintenanceMode: false,
    modules: Object.fromEntries(MODULES.map(k => [k, true])),
    limits: {
      merchantDailyTopupDiamonds: 50000000,
      sellerDailySaleDiamonds: 10000000,
      maxAgencies: 1000,
      maxHostsPerAgency: 1000
    },
    approvals: { agencyRequired: true, merchantRequired: true, sellerRequired: true, giftRequired: true, withdrawalRequired: true },
    security: { force2FAForAdmins: false, requireAuditReason: true, blockCrossCountryTransfers: true }
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function ensure(cid) {
    if (!store[cid]) store[cid] = clone(DEFAULTS);
    const p = store[cid];
    p.modules = Object.assign({}, DEFAULTS.modules, p.modules || {});
    p.limits = Object.assign({}, DEFAULTS.limits, p.limits || {});
    p.approvals = Object.assign({}, DEFAULTS.approvals, p.approvals || {});
    p.security = Object.assign({}, DEFAULTS.security, p.security || {});
    return p;
  }
  function save() { safeWrite(FILE, store); }
  function canManage(a) { return a && rbac.hasPermission(a, 'control-center:manage'); }
  function canView(a) { return a && rbac.hasPermission(a, 'control-center:view'); }
  function scope(a, cid) { return rbac.inScope(a, cid) && actorCanAccessCountry(a, cid); }
  function getCountryIds(actor) {
    return (countryPermission.registry.listCountries(actor) || []).map(c => c.id);
  }
  function summary(cid) {
    const countryUsers = Object.values(users || {}).filter(u => String(u.countryId || '') === cid);
    const countryAgencies = Object.values(agencies || {}).filter(a => String(a.countryId || '') === cid);
    let merchants = 0;
    try { merchants = merchantRegistry ? merchantRegistry._store.getAll().filter(m => String(m.countryId || '') === cid && m.status === 'active').length : 0; } catch (_) {}
    const hosts = countryUsers.filter(u => u.isHost === true || u.role === 'host').length;
    const online = countryUsers.filter(u => u.online || u.isOnline).length;
    return { users: countryUsers.length, onlineUsers: online, agencies: countryAgencies.length, merchants, hosts };
  }
  function sanitizePolicy(p) { return clone(p); }

  app.get('/api/admin/control-center/overview', requireAdmin, requirePermission('control-center:view'), (req,res) => {
    const countries = getCountryIds(req.adminAccount).map(cid => {
      const base = countryPermission.registry.describe(cid);
      const p = ensure(cid);
      return { country: base, policy: sanitizePolicy(p), summary: summary(cid) };
    });
    res.json({ success:true, role:req.adminAccount.role, countryId:req.adminAccount.countryId || null, countries, modules:MODULES });
  });

  app.get('/api/admin/control-center/:countryId', requireAdmin, requirePermission('control-center:view'), (req,res) => {
    const cid = String(req.params.countryId || '').toUpperCase();
    if (!scope(req.adminAccount, cid)) return countryDeniedResponse(res);
    if (!countryPermission.registry.describe(cid)) return res.status(404).json({success:false,message:'Unknown country'});
    res.json({ success:true, country:countryPermission.registry.describe(cid), policy:sanitizePolicy(ensure(cid)), summary:summary(cid) });
  });

  app.put('/api/admin/control-center/:countryId/policy', requireAdmin, requirePermission('control-center:manage'), (req,res) => {
    const cid = String(req.params.countryId || '').toUpperCase();
    if (!scope(req.adminAccount, cid)) return countryDeniedResponse(res);
    if (!countryPermission.registry.describe(cid)) return res.status(404).json({success:false,message:'Unknown country'});
    const old = clone(ensure(cid));
    const body = req.body || {};
    const p = ensure(cid);
    if (body.maintenanceMode !== undefined) p.maintenanceMode = !!body.maintenanceMode;
    if (body.enabled !== undefined) p.enabled = !!body.enabled;
    if (body.modules && typeof body.modules === 'object') for (const k of MODULES) if (body.modules[k] !== undefined) p.modules[k] = !!body.modules[k];
    if (body.limits && typeof body.limits === 'object') for (const [k,v] of Object.entries(body.limits)) {
      const n = Math.floor(Number(v)); if (Number.isFinite(n) && n >= 0 && Object.prototype.hasOwnProperty.call(p.limits,k)) p.limits[k] = n;
    }
    if (body.approvals && typeof body.approvals === 'object') for (const k of Object.keys(p.approvals)) if (body.approvals[k] !== undefined) p.approvals[k] = !!body.approvals[k];
    if (body.security && typeof body.security === 'object') for (const k of Object.keys(p.security)) if (body.security[k] !== undefined) p.security[k] = !!body.security[k];
    p.updatedAt = new Date().toISOString(); p.updatedBy = req.adminAccount.id;
    save();
    rbac.logAction({ admin:req.adminAccount, action:'country-control-policy-update', module:'control-center', targetType:'country', targetId:cid, before:old, after:p, meta:{ reason:String(body.reason || '').slice(0,300) }, ip:req.ip, userAgent:reqUserAgent(req) });
    res.json({success:true,country:countryPermission.registry.describe(cid),policy:sanitizePolicy(p),summary:summary(cid)});
  });

  app.post('/api/admin/control-center/:countryId/emergency', requireAdmin, requirePermission('control-center:manage'), (req,res) => {
    const cid = String(req.params.countryId || '').toUpperCase();
    if (!scope(req.adminAccount, cid)) return countryDeniedResponse(res);
    const action = String(req.body?.action || '');
    const p = ensure(cid); const old = clone(p);
    if (action === 'freeze') { p.enabled = false; p.maintenanceMode = true; }
    else if (action === 'unfreeze') { p.enabled = true; p.maintenanceMode = false; }
    else if (MODULES.includes(action)) p.modules[action] = false;
    else if (String(action).startsWith('enable:') && MODULES.includes(String(action).slice(7))) p.modules[String(action).slice(7)] = true;
    else return res.status(400).json({success:false,message:'Invalid emergency action'});
    p.updatedAt = new Date().toISOString(); p.updatedBy = req.adminAccount.id; save();
    rbac.logAction({ admin:req.adminAccount, action:'country-control-emergency', module:'control-center', targetType:'country', targetId:cid, before:old, after:p, meta:{ action }, ip:req.ip, userAgent:reqUserAgent(req) });
    res.json({success:true,policy:sanitizePolicy(p)});
  });

  app.get('/api/admin/control-center/:countryId/audit', requireAdmin, requirePermission('security:view-logs'), (req,res) => {
    const cid = String(req.params.countryId || '').toUpperCase();
    if (!scope(req.adminAccount, cid)) return countryDeniedResponse(res);
    const result = rbac.listLogs(req.adminAccount, { page:1, pageSize:1000, module:'control-center' });
    const logs = (result.logs || []).filter(x => String(x.countryId || x.meta?.countryId || x.targetId || '') === cid || x.targetId === cid);
    res.json({success:true,logs:logs.slice(-200).reverse()});
  });

  return { MODULES, getPolicy: cid => sanitizePolicy(ensure(cid)), save };
}
module.exports = { initControlCenter };
