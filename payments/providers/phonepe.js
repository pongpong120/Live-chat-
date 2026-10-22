'use strict';
// PhonePe Payment Gateway — Standard Checkout (website/redirect) adapter.
// Endpoints/fields below were checked against developer.phonepe.com on 2026-10-14:
//   auth   POST  {identity}/v1/oauth/token  (form: client_id, client_version, client_secret, grant_type=client_credentials)
//   pay    POST  {pg}/checkout/v2/pay        (Authorization: O-Bearer <token>)
//   status GET   {pg}/checkout/v2/order/{merchantOrderId}/status
//   webhook: header  Authorization: SHA256(username:password)  (hex), events checkout.order.completed / checkout.order.failed
// NOTE: sandbox + production use different hosts; merchant onboarding by PhonePe is required for credentials.
const crypto = require('crypto');
const { defaultHttp } = require('./http');
const { toPaise } = require('../packages');

const HOSTS = {
  sandbox:    { identity: 'https://api-preprod.phonepe.com/apis/pg-sandbox', pg: 'https://api-preprod.phonepe.com/apis/pg-sandbox' },
  production: { identity: 'https://api.phonepe.com/apis/identity-manager',    pg: 'https://api.phonepe.com/apis/pg' }
};

function createPhonePeProvider(cfg, { http = defaultHttp, now = () => Date.now() } = {}) {
  const hosts = HOSTS[cfg.environment] || HOSTS.sandbox;
  let token = null; let tokenExp = 0;

  function isConfigured() {
    return !!(cfg.enabled && cfg.clientId && cfg.clientVersion && cfg.clientSecret && cfg.webhookUsername && cfg.webhookPassword);
  }

  async function getToken() {
    if (token && now() < tokenExp - 60000) return token;
    const body = new URLSearchParams({
      client_id: cfg.clientId, client_version: cfg.clientVersion,
      client_secret: cfg.clientSecret, grant_type: 'client_credentials'
    }).toString();
    const r = await http({ method: 'POST', url: `${hosts.identity}/v1/oauth/token`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!r.ok || !r.json || !r.json.access_token) throw new Error(`phonepe auth failed (http ${r.status})`);
    let exp = Number(r.json.expires_at || 0);
    if (exp && exp < 1e12) exp *= 1000; // docs show epoch seconds
    tokenExp = exp || now() + 5 * 60000;
    token = r.json.access_token;
    return token;
  }
  const authHeaders = async () => ({ 'Content-Type': 'application/json', Authorization: `O-Bearer ${await getToken()}` });

  // order: internal order record. Amount is ALWAYS order.amountPaise (server-derived).
  async function createPaymentOrder({ order, redirectUrl, ttlSeconds, message }) {
    const payload = {
      merchantOrderId: order.orderId,
      amount: order.amountPaise,
      expireAfter: Math.min(3600, Math.max(300, ttlSeconds || 900)),
      paymentFlow: { type: 'PG_CHECKOUT', message: message || 'PingPong diamonds recharge', merchantUrls: { redirectUrl } },
      metaInfo: { udf1: String(order.packageId).slice(0, 256) }
    };
    const r = await http({ method: 'POST', url: `${hosts.pg}/checkout/v2/pay`, headers: await authHeaders(), body: JSON.stringify(payload) });
    if (!r.ok || !r.json || !r.json.redirectUrl) throw new Error(`phonepe create order failed (http ${r.status}${r.json && r.json.code ? ' ' + r.json.code : ''})`);
    return { providerOrderId: r.json.orderId || null, redirectUrl: r.json.redirectUrl, expiresAt: r.json.expireAt ? new Date(Number(r.json.expireAt)).toISOString() : null };
  }

  function mapState(s) {
    switch (String(s || '').toUpperCase()) {
      case 'COMPLETED': return 'SUCCESS';
      case 'FAILED': return 'FAILED';
      case 'PENDING': return 'PENDING';
      default: return 'PENDING'; // unknown state is never treated as success
    }
  }

  // Authoritative server-side status. Only "state" decides success (per PhonePe docs).
  async function getPaymentStatus(order) {
    const url = `${hosts.pg}/checkout/v2/order/${encodeURIComponent(order.orderId)}/status?details=true`;
    const r = await http({ method: 'GET', url, headers: await authHeaders() });
    if (r.status === 404) return { found: false };
    if (!r.ok || !r.json) throw new Error(`phonepe status failed (http ${r.status})`);
    const j = r.json;
    // The successful attempt (if any) supplies the transaction reference.
    const attempt = Array.isArray(j.paymentDetails) ? (j.paymentDetails.find((p) => String(p.state).toUpperCase() === 'COMPLETED') || j.paymentDetails[0]) : null;
    return {
      found: true,
      state: mapState(j.state),
      amountPaise: Number(j.amount),
      currency: 'INR',                    // PhonePe PG settles in INR only
      providerOrderId: j.orderId || null,
      providerTxnId: attempt && attempt.transactionId ? String(attempt.transactionId) : null
    };
  }

  // Authenticity check only. Result is a TRIGGER: service re-fetches status before crediting.
  function verifyWebhook({ headers = {}, rawBody }) {
    if (!isConfigured()) return { valid: false, reason: 'not-configured' };
    const got = String(headers['authorization'] || headers['Authorization'] || '').trim().toLowerCase();
    const want = crypto.createHash('sha256').update(`${cfg.webhookUsername}:${cfg.webhookPassword}`).digest('hex');
    const a = Buffer.from(got); const b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'bad-authorization' };
    let body; try { body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody)); } catch (_) { return { valid: false, reason: 'bad-json' }; }
    const p = body && body.payload ? body.payload : {};
    const orderId = p.merchantOrderId || p.originalMerchantOrderId || null;
    if (!orderId) return { valid: false, reason: 'no-order-id' };
    // PhonePe retries deliver the same event; derive a stable dedupe id from order + event + state.
    const eventId = `phonepe:${orderId}:${body.event || 'unknown'}:${p.state || ''}`;
    return { valid: true, orderId: String(orderId), eventId, hint: String(body.event || '') };
  }

  return { name: 'phonepe', isConfigured, createPaymentOrder, getPaymentStatus, verifyWebhook, _internal: { mapState, hosts } };
}
module.exports = { createPhonePeProvider, HOSTS };
