'use strict';
// Cashfree Payments PG adapter (server side). Checked against cashfree.com/docs on 2026-10-14:
//   create  POST {base}/orders  headers x-client-id, x-client-secret, x-api-version  body order_id, order_amount (RUPEES), order_currency
//           -> payment_session_id, order_status ACTIVE
//   status  GET  {base}/orders/{order_id}  -> order_status ACTIVE | PAID | EXPIRED | TERMINATED | TERMINATION_REQUESTED
//   pays    GET  {base}/orders/{order_id}/payments -> [{cf_payment_id, payment_status, payment_amount, ...}]
//   webhook headers x-webhook-signature, x-webhook-timestamp ; signature = base64(HMAC-SHA256(timestamp + rawBody, PG secret key))
//   checkout (browser): https://sdk.cashfree.com/js/v3/cashfree.js  -> Cashfree({mode}).checkout({paymentSessionId, redirectTarget})
//           the site domain MUST be whitelisted in the Cashfree dashboard.
// This provider stays INACTIVE unless CASHFREE_ENABLED=true AND credentials are set.
const crypto = require('crypto');
const { defaultHttp } = require('./http');

const BASES = { sandbox: 'https://sandbox.cashfree.com/pg', production: 'https://api.cashfree.com/pg' };
const WEBHOOK_MAX_SKEW_MS = 10 * 60 * 1000; // reject stale replays (timestamp is epoch ms)

function createCashfreeProvider(cfg, { http = defaultHttp, now = () => Date.now() } = {}) {
  const base = BASES[cfg.environment] || BASES.sandbox;
  const isConfigured = () => !!(cfg.enabled && cfg.clientId && cfg.clientSecret);
  const headers = (extra = {}) => ({
    'Content-Type': 'application/json', 'x-api-version': cfg.apiVersion,
    'x-client-id': cfg.clientId, 'x-client-secret': cfg.clientSecret, ...extra
  });
  const rupees = (paise) => Number((paise / 100).toFixed(2));
  const paise = (rupeeValue) => Math.round(Number(rupeeValue) * 100);

  function customerPhone(raw) {
    const d = String(raw || '').replace(/\D/g, '');
    return d.length >= 10 ? d.slice(-10) : null;
  }

  async function createPaymentOrder({ order, user, returnUrl, notifyUrl, ttlSeconds }) {
    const phone = customerPhone(user && user.mobile);
    if (!phone) throw new Error('cashfree: customer phone (10 digits) required');
    const payload = {
      order_id: order.orderId,
      order_amount: rupees(order.amountPaise),
      order_currency: 'INR',
      customer_details: { customer_id: String(order.userId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50), customer_phone: phone },
      order_meta: { return_url: returnUrl, notify_url: notifyUrl },
      order_expiry_time: new Date(now() + (ttlSeconds || 900) * 1000).toISOString(),
      order_note: `PingPong recharge ${order.packageId}`.slice(0, 200)
    };
    const r = await http({ method: 'POST', url: `${base}/orders`, headers: headers({ 'x-idempotency-key': order.orderId }), body: JSON.stringify(payload) });
    if (!r.ok || !r.json || !r.json.payment_session_id) throw new Error(`cashfree create order failed (http ${r.status}${r.json && r.json.code ? ' ' + r.json.code : ''})`);
    return {
      providerOrderId: r.json.cf_order_id ? String(r.json.cf_order_id) : null,
      paymentSessionId: r.json.payment_session_id,
      sdkMode: cfg.environment === 'production' ? 'production' : 'sandbox',
      expiresAt: r.json.order_expiry_time || null
    };
  }

  async function getPaymentStatus(order) {
    const o = await http({ method: 'GET', url: `${base}/orders/${encodeURIComponent(order.orderId)}`, headers: headers() });
    if (o.status === 404) return { found: false };
    if (!o.ok || !o.json) throw new Error(`cashfree get order failed (http ${o.status})`);
    const status = String(o.json.order_status || '').toUpperCase();
    const res = {
      found: true,
      providerOrderId: o.json.cf_order_id ? String(o.json.cf_order_id) : null,
      amountPaise: paise(o.json.order_amount),
      currency: String(o.json.order_currency || '').toUpperCase(),
      state: 'PENDING', providerTxnId: null
    };
    if (status === 'EXPIRED' || status === 'TERMINATED') res.state = 'EXPIRED';
    if (status === 'PAID') {
      // Cross-check with the actual successful payment record.
      const p = await http({ method: 'GET', url: `${base}/orders/${encodeURIComponent(order.orderId)}/payments`, headers: headers() });
      if (!p.ok || !Array.isArray(p.json)) throw new Error(`cashfree get payments failed (http ${p.status})`);
      const ok = p.json.find((x) => String(x.payment_status).toUpperCase() === 'SUCCESS');
      if (!ok) return { ...res, state: 'PENDING' };   // PAID with no SUCCESS payment row: do not credit
      res.state = 'SUCCESS';
      res.providerTxnId = ok.cf_payment_id ? String(ok.cf_payment_id) : null;
      if (ok.payment_amount != null) res.amountPaise = paise(ok.payment_amount);
      if (ok.payment_currency) res.currency = String(ok.payment_currency).toUpperCase();
    }
    return res;
  }

  function verifyWebhook({ headers: h = {}, rawBody }) {
    if (!isConfigured() || !cfg.webhookSecret) return { valid: false, reason: 'not-configured' };
    const sig = String(h['x-webhook-signature'] || '');
    const ts = String(h['x-webhook-timestamp'] || '');
    if (!sig || !ts) return { valid: false, reason: 'missing-headers' };
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const want = crypto.createHmac('sha256', cfg.webhookSecret).update(ts + raw).digest('base64');
    const a = Buffer.from(sig); const b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'bad-signature' };
    const tsn = Number(ts);
    if (Number.isFinite(tsn) && Math.abs(now() - tsn) > WEBHOOK_MAX_SKEW_MS) return { valid: false, reason: 'stale-timestamp' };
    let body; try { body = JSON.parse(raw); } catch (_) { return { valid: false, reason: 'bad-json' }; }
    const d = body && body.data ? body.data : {};
    const orderId = d.order && d.order.order_id;
    if (!orderId) return { valid: false, reason: 'no-order-id' };
    const cfPay = d.payment && d.payment.cf_payment_id;
    const eventId = `cashfree:${orderId}:${body.type || 'unknown'}:${cfPay || ts}`;
    return { valid: true, orderId: String(orderId), eventId, hint: String(body.type || '') };
  }

  return { name: 'cashfree', isConfigured, createPaymentOrder, getPaymentStatus, verifyWebhook, _internal: { base } };
}
module.exports = { createCashfreeProvider, BASES };
