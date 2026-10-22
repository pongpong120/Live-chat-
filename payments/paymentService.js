'use strict';
// Provider-independent payment service. Public interface:
//   createPaymentOrder(), getPaymentStatus(), verifyWebhook()/handleWebhook(),
//   processSuccessfulPayment(), cancelOrExpireOrder(), reconcile()
// Rules enforced here (never in the client, never in a provider adapter):
//   * amount/diamonds come ONLY from payments/packages.js
//   * diamonds are credited ONLY after the provider's server-side status says SUCCESS
//     and amount/currency/order-id all match what we stored at order creation
//   * a webhook is just an authenticated trigger; its body is never used for money decisions
//   * crediting is guarded by an atomic claim in the store + an idempotent wallet adapter
const crypto = require('crypto');
const { getPackage, listPackages } = require('./packages');
const { isTerminal } = require('./stateMachine');

const MAX_ORDERS_PER_WINDOW = 10;
const ORDER_WINDOW_MS = 10 * 60 * 1000;
const EXPIRY_GRACE_MS = 10 * 60 * 1000;
const MIN_SYNC_INTERVAL_MS = 3000;

function createPaymentService({ cfg, store, providers, wallet, now = () => Date.now(), logger = console }) {
  if (!cfg || !store || !providers || !wallet) throw new Error('createPaymentService: cfg, store, providers, wallet required');
  const lastSync = new Map();
  const log = (event, data) => { try { logger.info ? logger.info(`[payments] ${event}`, data || {}) : logger.log(`[payments] ${event}`, data || {}); } catch (_) {} };
  const warn = (event, data) => { try { (logger.warn || logger.log).call(logger, `[payments] ${event}`, data || {}); } catch (_) {} };

  const provider = (name) => providers[name] || null;
  function activeProvider() {
    if (!cfg.autoEnabled) return null;
    const p = provider(cfg.activeProvider);
    return p && p.isConfigured() ? p : null;
  }
  function newOrderId() { // <=63 chars, [A-Za-z0-9] only (valid for PhonePe and Cashfree)
    return 'PP' + now().toString(36).toUpperCase() + crypto.randomBytes(8).toString('hex').toUpperCase();
  }
  const publicView = (o) => o && ({
    orderId: o.orderId, provider: o.provider, packageId: o.packageId, packageName: o.packageName,
    amountINR: o.amountPaise / 100, diamonds: o.diamonds, status: o.status,
    credited: o.creditState === 'CREDITED', createdAt: o.createdAt
  });

  // What the Recharge UI needs. 'gateway' only when automatic payments are truly usable.
  function getPublicConfig() {
    const p = activeProvider();
    return { mode: p ? 'gateway' : 'disabled', provider: p ? p.name : null, packages: listPackages(), message: p ? null : 'Online payments are not configured. No payment can be started.' };
  }

  function returnUrlFor(order) { return `${cfg.publicBaseUrl}/wallet-ui.html?userId=${encodeURIComponent(order.userId)}&payOrder=${encodeURIComponent(order.orderId)}`; }
  function webhookUrlFor(name) { return `${cfg.publicBaseUrl}/api/payments/webhook/${name}`; }

  async function createPaymentOrder({ user, packageId }) {
    if (!user || !user.userId) return { error: 'unauthenticated', message: 'Login required' };
    const prov = activeProvider();
    if (!prov) return { error: 'gateway-disabled', message: 'Online payment is not available right now' };
    const pkg = getPackage(packageId);                                  // trusted server-side lookup
    if (!pkg) return { error: 'invalid-package', message: 'Selected package is not available' };

    const t = now();
    // Repeated taps return the same open order instead of creating uncontrolled duplicates.
    const reusable = await store.findReusableOrder({ userId: user.userId, packageId: pkg.id, provider: prov.name, nowMs: t });
    if (reusable) return { reused: true, ...checkoutInfo(reusable), order: publicView(reusable) };
    if (await store.countRecentOrders({ userId: user.userId, sinceMs: t - ORDER_WINDOW_MS }) >= MAX_ORDERS_PER_WINDOW) {
      return { error: 'too-many-orders', message: 'Too many payment attempts. Please wait a few minutes.' };
    }

    const order = {
      orderId: newOrderId(), userId: user.userId, mobile: user.mobile || null, provider: prov.name,
      packageId: pkg.id, packageName: pkg.name, amountPaise: Math.round(pkg.priceINR * 100), currency: 'INR',
      diamonds: pkg.diamonds, status: 'CREATED', createdAtMs: t, expiresAtMs: t + cfg.orderTtlSeconds * 1000
    };
    const ins = await store.insertOrder(order);
    if (!ins.inserted) return { error: 'order-collision', message: 'Please try again' };

    let created;
    try {
      created = await prov.createPaymentOrder({
        order, user, ttlSeconds: cfg.orderTtlSeconds,
        redirectUrl: returnUrlFor(order), returnUrl: returnUrlFor(order), notifyUrl: webhookUrlFor(prov.name)
      });
    } catch (e) {
      warn('provider-create-failed', { orderId: order.orderId, provider: prov.name, message: e.message });
      await store.transition(order.orderId, 'FAILED', {});
      return { error: 'provider-error', message: 'Could not start the payment. Please try again.' };
    }
    await store.updateFields(order.orderId, {
      redirectUrl: created.redirectUrl || null, paymentSessionId: created.paymentSessionId || null,
      providerOrderId: created.providerOrderId || null,
      expiresAtMs: created.expiresAt ? Date.parse(created.expiresAt) || order.expiresAtMs : order.expiresAtMs
    });
    const moved = await store.transition(order.orderId, 'PENDING', {});
    log('order-created', { orderId: order.orderId, provider: prov.name, package: pkg.id });
    const fresh = moved.order || (await store.getOrder(order.orderId));
    return { reused: false, ...checkoutInfo(fresh, created), order: publicView(fresh) };
  }

  function checkoutInfo(o, created) {
    const c = created || {};
    return {
      redirectUrl: o.redirectUrl || c.redirectUrl || null,
      paymentSessionId: o.paymentSessionId || c.paymentSessionId || null,
      sdkMode: c.sdkMode || (cfg.cashfree.environment === 'production' ? 'production' : 'sandbox')
    };
  }

  // Money decision point. `facts` must come from provider.getPaymentStatus() (server-to-server).
  async function processSuccessfulPayment(orderId, facts) {
    const order = await store.getOrder(orderId);
    if (!order) return { ok: false, reason: 'unknown-order' };
    if (!facts || facts.state !== 'SUCCESS') return { ok: false, reason: 'not-success' };
    const mismatch =
      facts.amountPaise !== order.amountPaise ? 'amount' :
      facts.currency !== order.currency ? 'currency' :
      (facts.providerOrderId && order.providerOrderId && String(facts.providerOrderId) !== String(order.providerOrderId)) ? 'provider-order-id' : null;
    if (mismatch) {
      warn('SECURITY verification-mismatch', { orderId, provider: order.provider, field: mismatch });
      return { ok: false, reason: `mismatch:${mismatch}` };      // never credited, never auto-failed (money may have moved)
    }
    const moved = await store.transition(orderId, 'SUCCESS', { verified: true, patch: { providerTxnId: facts.providerTxnId || null, providerOrderId: facts.providerOrderId || null } });
    if (!moved.changed && moved.reason !== 'already') {
      warn('SECURITY transition-refused', { orderId, reason: moved.reason });
      return { ok: false, reason: moved.reason };
    }
    return creditOrder(orderId);
  }

  async function creditOrder(orderId) {
    const claim = await store.claimCredit(orderId, { staleMs: 30000, nowMs: now() });
    if (!claim.claimed) return { ok: true, credited: false, reason: claim.reason, order: publicView(claim.order) };
    const o = claim.order;
    // Wallet adapter is idempotent by orderId; if it throws, the claim goes stale and a retry/reconcile re-takes it.
    const res = await wallet.creditDiamonds({ userId: o.userId, diamonds: o.diamonds, orderId: o.orderId, note: `${o.provider} ${o.packageId} INR ${o.amountPaise / 100}`, packageId: o.packageId });
    const done = await store.markCredited(orderId, {});
    log('credited', { orderId, provider: o.provider, diamonds: o.diamonds, appliedNow: !!(res && res.applied) });
    return { ok: true, credited: true, appliedNow: !!(res && res.applied), order: publicView(done) };
  }

  // Pull authoritative status from the provider and move the order accordingly.
  async function syncOrder(orderId) {
    const order = await store.getOrder(orderId);
    if (!order) return { ok: false, reason: 'unknown-order' };
    if (order.status === 'SUCCESS' && order.creditState === 'CREDITED') return { ok: true, order: publicView(order) };
    if (order.status === 'SUCCESS') return creditOrder(orderId);          // verified earlier, credit unfinished
    const prov = provider(order.provider);
    if (!prov || !prov.isConfigured()) return { ok: false, reason: 'provider-unavailable', order: publicView(order) };
    const facts = await prov.getPaymentStatus(order);
    if (!facts.found) return { ok: true, order: publicView(order) };
    if (facts.state === 'SUCCESS') return processSuccessfulPayment(orderId, facts);
    if (isTerminal(order.status)) return { ok: true, order: publicView(order) };   // no downgrade of terminal states
    if (facts.state === 'FAILED') { const r = await store.transition(orderId, 'FAILED', {}); return { ok: true, order: publicView(r.order || order) }; }
    if (facts.state === 'EXPIRED') { const r = await store.transition(orderId, 'EXPIRED', {}); return { ok: true, order: publicView(r.order || order) }; }
    // Provider says still pending: expire locally only well past the order window.
    if (now() > (order.expiresAtMs || 0) + EXPIRY_GRACE_MS) { const r = await store.transition(orderId, 'EXPIRED', {}); return { ok: true, order: publicView(r.order || order) }; }
    return { ok: true, order: publicView(order) };
  }

  async function getPaymentStatus({ orderId, userId }) {
    const order = await store.getOrder(orderId);
    if (!order || order.userId !== userId) return { error: 'not-found' };       // same answer for other users' orders
    if (order.creditState === 'CREDITED' || (isTerminal(order.status) && order.status !== 'SUCCESS' && now() - (Date.parse(order.updatedAt) || 0) > EXPIRY_GRACE_MS)) {
      return { order: publicView(order) };
    }
    const last = lastSync.get(orderId) || 0;
    if (now() - last < MIN_SYNC_INTERVAL_MS) return { order: publicView(order) };
    lastSync.set(orderId, now());
    try { const r = await syncOrder(orderId); return { order: r.order || publicView(await store.getOrder(orderId)) }; }
    catch (e) { warn('status-sync-failed', { orderId, message: e.message }); return { order: publicView(order), stale: true }; }
  }

  function verifyWebhook(providerName, req) {
    const p = provider(providerName);
    if (!p) return { valid: false, reason: 'unknown-provider' };
    return p.verifyWebhook(req);
  }

  // Returns { httpStatus, body }. 401 for forged; 200 for handled/duplicate/unknown order; 500 so the provider retries.
  async function handleWebhook(providerName, req) {
    const v = verifyWebhook(providerName, req);
    if (!v.valid) { warn('SECURITY webhook-rejected', { provider: providerName, reason: v.reason }); return { httpStatus: 401, body: { ok: false } }; }
    try {
      const ev = await store.recordEvent({ provider: providerName, eventId: v.eventId, orderId: v.orderId });
      const order = await store.getOrder(v.orderId);
      if (!order || order.provider !== providerName) return { httpStatus: 200, body: { ok: true, ignored: 'unknown-order' } };
      if (!ev.inserted && order.creditState === 'CREDITED') return { httpStatus: 200, body: { ok: true, duplicate: true } };
      const r = await syncOrder(v.orderId);                         // authoritative status, not the webhook body
      return { httpStatus: 200, body: { ok: true, duplicate: !ev.inserted, status: r.order && r.order.status } };
    } catch (e) {
      warn('webhook-processing-error', { provider: providerName, orderId: v.orderId, message: e.message });
      return { httpStatus: 500, body: { ok: false } };
    }
  }

  async function cancelOrExpireOrder({ orderId, userId, reason = 'user-cancelled' }) {
    const order = await store.getOrder(orderId);
    if (!order || order.userId !== userId) return { error: 'not-found' };
    // Never cancel something the provider already collected money for.
    try { const s = await syncOrder(orderId); if (s.order && (s.order.status === 'SUCCESS')) return { order: s.order }; } catch (e) { /* provider down: fall through to cancel */ }
    const target = reason === 'expired' ? 'EXPIRED' : 'CANCELLED';
    const r = await store.transition(orderId, target, {});
    return { order: publicView(r.order || (await store.getOrder(orderId))) };
  }

  async function reconcile({ olderThanMs = 60000, limit = 50 } = {}) {
    const list = await store.listForReconcile({ olderThanMs, nowMs: now(), limit });
    const summary = { checked: 0, credited: 0, errors: 0 };
    for (const o of list) {
      summary.checked++;
      try { const r = await syncOrder(o.orderId); if (r.credited && r.appliedNow) summary.credited++; }
      catch (e) { summary.errors++; warn('reconcile-error', { orderId: o.orderId, message: e.message }); }
    }
    return summary;
  }

  return { getPublicConfig, createPaymentOrder, getPaymentStatus, verifyWebhook, handleWebhook, processSuccessfulPayment, cancelOrExpireOrder, syncOrder, reconcile, activeProvider, _publicView: publicView };
}
module.exports = { createPaymentService };
