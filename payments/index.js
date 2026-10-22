'use strict';
// Wires config + store + providers + wallet into one service and mounts the HTTP routes.
// Default is OFF (PAYMENTS_AUTO_ENABLED unset): /api/payments/config reports mode "disabled".
// No hard-coded/manual UPI payment is presented as a live gateway checkout.
const { readConfig, validateConfig } = require('./config');
const { createPaymentService } = require('./paymentService');
const { createMemoryStore } = require('./stores/memoryStore');
const { createPgStore } = require('./stores/pgStore');
const { createPhonePeProvider } = require('./providers/phonepe');
const { createCashfreeProvider } = require('./providers/cashfree');
const { createWalletAdapter } = require('./walletAdapter');

function initPayments(deps) {
  const { app, userAuth, users, limiter, env = process.env, logger = console } = deps;
  const production = env.NODE_ENV === 'production';
  const cfg = readConfig(env);
  const check = validateConfig(cfg, { production });
  let effective = cfg;
  if (!check.ok) {
    logger.error('[payments] automatic payments DISABLED — configuration errors: ' + check.errors.join(' | '));
    effective = { ...cfg, autoEnabled: false };
  }
  (check.warnings || []).forEach((w) => logger.warn('[payments] ' + w));

  // Store: Postgres is mandatory for automatic payments in production (no silent JSON fallback).
  let store = deps.store || null;
  if (!store) {
    const db = deps.db || require('../db/connection');
    if (effective.autoEnabled && db.enabled()) store = createPgStore({ pool: db.getPool() });
    else if (effective.autoEnabled && production) {
      logger.error('[payments] DATABASE_URL missing in production — automatic payments DISABLED');
      effective = { ...effective, autoEnabled: false };
    }
    if (!store) store = createMemoryStore();   // only reachable when auto payments are off or non-production sandbox
  }
  const wallet = deps.wallet || createWalletAdapter(deps);
  const providers = deps.providers || {
    phonepe: createPhonePeProvider(effective.phonepe),
    cashfree: createCashfreeProvider(effective.cashfree)
  };
  const service = createPaymentService({ cfg: effective, store, providers, wallet, logger });

  const userRecordFrom = (req) => users[req.authedMobile] || null;
  const userFrom = (req) => { const u = userRecordFrom(req); return u ? { userId: u.userId, mobile: req.authedMobile } : null; };
  const onlineRechargeAllowed = (req) => String(userRecordFrom(req)?.country || '').trim().toUpperCase() === 'IN';
  const rejectNonIndia = (res) => res.status(403).json({ success: false, code: 'online-recharge-india-only', onlineRechargeAllowed: false, offlineRechargeOnly: true, message: 'Online recharge is available only for India accounts. Please use an authorized offline recharge option in your country.' });
  const noop = (req, res, next) => next();   // pass-through when no limiter injected
  const rl = limiter || noop;

  app.get('/api/payments/config', userAuth.requireUserAuth, (req, res) => {
    if (!onlineRechargeAllowed(req)) return res.json({ success: true, onlineRechargeAllowed: false, offlineRechargeOnly: true, mode: 'disabled', provider: null, packages: [], message: 'Online recharge is available only for India accounts. Please use an authorized offline recharge option in your country.' });
    return res.json({ success: true, onlineRechargeAllowed: true, offlineRechargeOnly: false, ...service.getPublicConfig() });
  });

  app.post('/api/payments/order', userAuth.requireUserAuth, rl, async (req, res) => {
    if (!onlineRechargeAllowed(req)) return rejectNonIndia(res);
    const user = userFrom(req);
    if (!user) return res.status(404).json({ success: false, code: 'user-not-found', message: 'User not found' });
    // Only packageId is read from the client. Any amount/diamonds/price fields are ignored.
    const r = await service.createPaymentOrder({ user, packageId: req.body && req.body.packageId });
    if (r.error) return res.status(r.error === 'gateway-disabled' ? 503 : r.error === 'too-many-orders' ? 429 : 400).json({ success: false, code: r.error, message: r.message });
    res.json({ success: true, ...r });
  });

  app.get('/api/payments/order/:id', userAuth.requireUserAuth, async (req, res) => {
    if (!onlineRechargeAllowed(req)) return rejectNonIndia(res);
    const user = userFrom(req);
    if (!user) return res.status(404).json({ success: false, code: 'not-found' });
    const r = await service.getPaymentStatus({ orderId: String(req.params.id), userId: user.userId });
    if (r.error) return res.status(404).json({ success: false, code: 'not-found' });
    res.json({ success: true, ...r });
  });

  app.post('/api/payments/order/:id/cancel', userAuth.requireUserAuth, rl, async (req, res) => {
    if (!onlineRechargeAllowed(req)) return rejectNonIndia(res);
    const user = userFrom(req);
    if (!user) return res.status(404).json({ success: false, code: 'not-found' });
    const r = await service.cancelOrExpireOrder({ orderId: String(req.params.id), userId: user.userId });
    if (r.error) return res.status(404).json({ success: false, code: 'not-found' });
    res.json({ success: true, ...r });
  });

  // Provider webhooks: NO user auth (the provider calls us); authenticity is verified from the raw body.
  app.post('/api/payments/webhook/:provider', async (req, res) => {
    const name = String(req.params.provider || '').toLowerCase();
    if (!['phonepe', 'cashfree'].includes(name)) return res.status(404).json({ ok: false });
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const out = await service.handleWebhook(name, { headers: req.headers, rawBody });
    res.status(out.httpStatus).json(out.body);
  });

  // Reconciliation sweep for delayed/missed webhooks (only when automatic payments are on).
  let timer = null;
  if (effective.autoEnabled) {
    timer = setInterval(() => { service.reconcile().then((s) => { if (s.checked) logger.info('[payments] reconcile', s); }).catch((e) => logger.warn('[payments] reconcile failed', e.message)); }, 60000);
    if (timer.unref) timer.unref();
  }

  function health() {
    const p = service.activeProvider();
    return {
      autoEnabled: effective.autoEnabled, mode: p ? 'gateway' : 'manual', activeProvider: p ? p.name : null,
      store: store.kind, phonepeConfigured: providers.phonepe.isConfigured(), cashfreeConfigured: providers.cashfree.isConfigured(),
      configErrors: check.errors.length   // count only; never secret values
    };
  }
  app.get('/api/payments/health', (req, res) => res.json({ success: true, ...health() }));

  return { service, store, health, stop: () => timer && clearInterval(timer), cfg: effective };
}
module.exports = { initPayments };
