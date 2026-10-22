'use strict';
// Gateway payments (PhonePe / Cashfree) — offline tests. Provider HTTP is faked; NO real network,
// NO real merchant account. These tests prove our logic, not that a live merchant account works.
// Run: node test/paymentsGateway.test.js
const crypto = require('crypto');
const path = require('path');
const root = path.join(__dirname, '..', 'payments');
const { PACKAGES, getPackage, listPackages } = require(path.join(root, 'packages'));
const { readConfig, validateConfig } = require(path.join(root, 'config'));
const { createPaymentService } = require(path.join(root, 'paymentService'));
const { createMemoryStore } = require(path.join(root, 'stores', 'memoryStore'));
const { createPhonePeProvider } = require(path.join(root, 'providers', 'phonepe'));
const { createCashfreeProvider } = require(path.join(root, 'providers', 'cashfree'));
const { createWalletAdapter } = require(path.join(root, 'walletAdapter'));
const { initPayments } = require(path.join(root, 'index'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗ FAIL:', m); } };
const quiet = { info() {}, warn() {}, error() {}, log() {} };

function harness({ cashfreeEnabled = false, wallet: walletOverride, nowRef } = {}) {
  const files = {}; const users = { '9000000001': { userId: 'U1', mobile: '9000000001', country: 'IN', diamonds: 500 }, '9000000002': { userId: 'U2', mobile: '9000000002', country: 'IN', diamonds: 0 } };
  const findUserByUserId = (id) => { const m = Object.keys(users).find((k) => users[k].userId === id); return m ? { mobile: m, user: users[m] } : null; };
  const adapter = createWalletAdapter({
    DATA_FOLDER: '/tmp/x', safeRead: (f, d) => (files[f] !== undefined ? files[f] : d), safeWrite: (f, v) => { files[f] = JSON.parse(JSON.stringify(v)); },
    findUserByUserId, saveUsers() {}, logTransaction() {}, pushWalletUpdate() {}, clampDiamondBalance: (u, d) => d
  });
  const env = {
    PAYMENTS_AUTO_ENABLED: 'true', PAYMENT_PROVIDER: 'phonepe', PUBLIC_BASE_URL: 'https://pp.example.test', PAYMENTS_SINGLE_INSTANCE_ACK: 'true',
    PHONEPE_ENABLED: 'true', PHONEPE_ENVIRONMENT: 'sandbox', PHONEPE_CLIENT_ID: 'cid', PHONEPE_CLIENT_VERSION: '1', PHONEPE_CLIENT_SECRET: 'csecret',
    PHONEPE_WEBHOOK_USERNAME: 'whuser', PHONEPE_WEBHOOK_PASSWORD: 'whpass',
    CASHFREE_ENABLED: cashfreeEnabled ? 'true' : 'false', CASHFREE_CLIENT_ID: cashfreeEnabled ? 'cfid' : '', CASHFREE_CLIENT_SECRET: cashfreeEnabled ? 'cfsecret' : ''
  };
  const cfg = readConfig(env);
  // Fake PhonePe backend
  const remote = { state: 'PENDING', amount: null, txn: 'T1', calls: [] };
  const http = async ({ method, url, body }) => {
    remote.calls.push(method + ' ' + url);
    if (url.endsWith('/v1/oauth/token')) return { status: 200, ok: true, json: { access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 } };
    if (url.endsWith('/checkout/v2/pay')) { const b = JSON.parse(body); remote.amount = b.amount; remote.lastPay = b; return { status: 200, ok: true, json: { orderId: 'OMO' + b.merchantOrderId, redirectUrl: 'https://mercury-uat.phonepe.com/pay/' + b.merchantOrderId, expireAt: Date.now() + 900000 } }; }
    if (url.includes('/status')) { const id = decodeURIComponent(url.split('/order/')[1].split('/status')[0]); return { status: 200, ok: true, json: { orderId: 'OMO' + id, state: remote.state, amount: remote.amount, paymentDetails: remote.state === 'COMPLETED' ? [{ transactionId: remote.txn, state: 'COMPLETED' }] : [] } }; }
    return { status: 404, ok: false, json: null };
  };
  const providers = { phonepe: createPhonePeProvider(cfg.phonepe, { http }), cashfree: createCashfreeProvider(cfg.cashfree, { http: async () => { throw new Error('cashfree must not be called'); } }) };
  const store = createMemoryStore();
  const service = createPaymentService({ cfg, store, providers, wallet: walletOverride ? walletOverride(adapter) : adapter, logger: quiet, now: nowRef ? () => nowRef.t : undefined });
  return { users, service, store, remote, providers, cfg, adapter, files, env, http };
}
const U1 = { userId: 'U1', mobile: '9000000001' };
const authHeader = () => crypto.createHash('sha256').update('whuser:whpass').digest('hex');
const phonepeWebhook = (orderId, event = 'checkout.order.completed', state = 'COMPLETED') => ({ headers: { authorization: authHeader() }, rawBody: Buffer.from(JSON.stringify({ event, payload: { merchantOrderId: orderId, state } })) });

(async () => {
  console.log('Packages — approved fixed values');
  const want = [['Starter Pack', 100, 1000000], ['Popular Pack', 250, 2600000], ['Premium Pack', 500, 5200000], ['Mega Pack', 1000, 11200000]];
  ok(PACKAGES.length === 4, 'exactly four packages');
  want.forEach(([n, p, d], i) => ok(PACKAGES[i].name === n && PACKAGES[i].priceINR === p && PACKAGES[i].diamonds === d, `${n}: ₹${p} = ${d.toLocaleString()} diamonds`));
  ok(Object.isFrozen(PACKAGES) && Object.isFrozen(PACKAGES[0]), 'package config is frozen');
  const l = listPackages(); l[0].priceINR = 1; ok(getPackage('pkg_fixed_100').priceINR === 100, 'mutating a returned copy cannot change trusted config');

  console.log('Config / provider selection');
  ok(validateConfig(readConfig({}), {}).ok === true && readConfig({}).autoEnabled === false, 'default: automatic payments OFF, config valid');
  ok(readConfig({}).cashfree.enabled === false, 'CASHFREE_ENABLED defaults to false');
  ok(!validateConfig(readConfig({ PAYMENTS_AUTO_ENABLED: 'true' }), {}).ok, 'enabling without credentials/base URL is rejected');
  ok(validateConfig(readConfig({ ...harness().env, PUBLIC_BASE_URL: 'http://x' }), { production: true }).errors.some((e) => /https/.test(e)), 'production requires https base URL');
  {
    const h = harness({ cashfreeEnabled: false });
    ok(h.service.getPublicConfig().mode === 'gateway' && h.service.getPublicConfig().provider === 'phonepe', 'Cashfree disabled: PhonePe still active');
    ok(h.providers.cashfree.isConfigured() === false, 'Cashfree not configured when disabled');
    const o = await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_100' });
    ok(!o.error && o.order.provider === 'phonepe', 'order creation works on PhonePe while Cashfree is off');
    ok(!h.remote.calls.some((c) => /cashfree/i.test(c)), 'no Cashfree call was made');
  }

  console.log('Order creation / validation / tampering');
  for (const [name, price, dia] of want) {
    const h = harness(); const pkgId = PACKAGES.find((p) => p.name === name).id;
    const o = await h.service.createPaymentOrder({ user: U1, packageId: pkgId, amount: 1, amountINR: 1, priceINR: 1, diamonds: 999999999 }); // tampered client fields
    ok(!o.error && h.remote.lastPay.amount === price * 100, `${name}: provider order amount is exactly ₹${price} (${price * 100} paise) despite tampered client fields`);
    ok(o.order.diamonds === dia && o.order.amountINR === price, `${name}: stored order uses configured diamonds/price`);
  }
  {
    const h = harness();
    ok((await h.service.createPaymentOrder({ user: null, packageId: 'pkg_fixed_100' })).error === 'unauthenticated', 'unauthenticated payment creation rejected');
    ok((await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_999' })).error === 'invalid-package', 'unknown package rejected');
    ok((await h.service.createPaymentOrder({ user: U1, packageId: '../../x' })).error === 'invalid-package', 'malformed package id rejected');
    const a = await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_250' });
    const b = await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_250' });
    ok(b.reused === true && b.order.orderId === a.order.orderId, 'repeated taps reuse the open order (no uncontrolled duplicates)');
    ok(/^PP[A-Z0-9]+$/.test(a.order.orderId) && a.order.orderId.length <= 63, 'server-generated order id is alphanumeric and short enough for both providers');
  }

  console.log('Exactly-once crediting');
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_500' })).order;
    ok(h.users['9000000001'].diamonds === 500, 'creating an order does not change the balance');
    h.remote.state = 'PENDING';
    const w0 = await h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId));
    ok(w0.httpStatus === 200 && h.users['9000000001'].diamonds === 500, 'webhook while provider says PENDING credits nothing');
    h.remote.state = 'COMPLETED';
    const w1 = await h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId));
    ok(w1.httpStatus === 200 && h.users['9000000001'].diamonds === 500 + 5200000, 'verified success credits exactly 5,200,000');
    for (let i = 0; i < 5; i++) await h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId));
    ok(h.users['9000000001'].diamonds === 500 + 5200000, 'duplicate/delayed webhooks never credit twice');
    ok((await h.service.getPaymentStatus({ orderId: o.orderId, userId: 'U1' })).order.credited === true, 'status API reports credited');
    const again = await h.service.processSuccessfulPayment(o.orderId, { state: 'SUCCESS', amountPaise: 50000, currency: 'INR' });
    ok(h.users['9000000001'].diamonds === 500 + 5200000, 'repeat processSuccessfulPayment is a no-op');
  }
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_1000' })).order; h.remote.state = 'COMPLETED';
    await Promise.all(Array.from({ length: 25 }, (_, i) => i % 2 ? h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId)) : h.service.syncOrder(o.orderId)));
    ok(h.users['9000000001'].diamonds === 500 + 11200000, '25 concurrent webhook/sync calls credit exactly once (11,200,000)');
    ok(Object.keys(h.files['/tmp/x/paymentCredits.json']).length === 1, 'exactly one credit record exists');
  }
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_100' })).order; h.remote.state = 'COMPLETED';
    const r = await Promise.all([h.service.getPaymentStatus({ orderId: o.orderId, userId: 'U1' }), h.service.cancelOrExpireOrder({ orderId: o.orderId, userId: 'U1' }), h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId))]);
    ok(h.users['9000000001'].diamonds === 500 + 1000000, 'cancel racing a real success still credits once and is never lost');
  }

  console.log('Forged / invalid webhooks');
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_100' })).order; h.remote.state = 'COMPLETED';
    const bad = await h.service.handleWebhook('phonepe', { headers: { authorization: 'deadbeef' }, rawBody: Buffer.from(JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: o.orderId, state: 'COMPLETED' } })) });
    ok(bad.httpStatus === 401 && h.users['9000000001'].diamonds === 500, 'wrong Authorization header → 401, no credit');
    const none = await h.service.handleWebhook('phonepe', { headers: {}, rawBody: Buffer.from('{}') });
    ok(none.httpStatus === 401, 'missing Authorization header → 401');
    const junk = await h.service.handleWebhook('phonepe', { headers: { authorization: authHeader() }, rawBody: Buffer.from('not json') });
    ok(junk.httpStatus === 401, 'valid auth but unparsable body → rejected');
    const unk = await h.service.handleWebhook('phonepe', phonepeWebhook('PPDOESNOTEXIST'));
    ok(unk.httpStatus === 200 && unk.body.ignored === 'unknown-order', 'unknown order id acknowledged but ignored');
    ok((await h.service.handleWebhook('nonesuch', phonepeWebhook(o.orderId))).httpStatus === 401, 'unknown provider name rejected');
    // a forged "success" body is irrelevant: provider status is what counts
    h.remote.state = 'PENDING';
    await h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId, 'checkout.order.completed', 'COMPLETED'));
    ok(h.users['9000000001'].diamonds === 500, 'even an authentic-looking "COMPLETED" webhook credits nothing if the provider status API says PENDING');
  }
  {
    // Cashfree signature procedure (HMAC-SHA256 base64 of timestamp+rawBody)
    const cfg = readConfig({ CASHFREE_ENABLED: 'true', CASHFREE_CLIENT_ID: 'a', CASHFREE_CLIENT_SECRET: 'sek' });
    let t = 1760000000000; const cf = createCashfreeProvider(cfg.cashfree, { now: () => t });
    const raw = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: 'PPABC' }, payment: { cf_payment_id: 77 } } });
    const sign = (ts, body) => crypto.createHmac('sha256', 'sek').update(ts + body).digest('base64');
    ok(cf.verifyWebhook({ headers: { 'x-webhook-signature': sign(String(t), raw), 'x-webhook-timestamp': String(t) }, rawBody: Buffer.from(raw) }).valid, 'Cashfree: correct signature accepted');
    ok(!cf.verifyWebhook({ headers: { 'x-webhook-signature': sign(String(t), raw), 'x-webhook-timestamp': String(t) }, rawBody: Buffer.from(raw + ' ') }).valid, 'Cashfree: modified body rejected');
    ok(!cf.verifyWebhook({ headers: { 'x-webhook-signature': 'AAAA', 'x-webhook-timestamp': String(t) }, rawBody: Buffer.from(raw) }).valid, 'Cashfree: forged signature rejected');
    ok(!cf.verifyWebhook({ headers: {}, rawBody: Buffer.from(raw) }).valid, 'Cashfree: missing headers rejected');
    t += 3600000; ok(!cf.verifyWebhook({ headers: { 'x-webhook-signature': sign(String(t - 3600000), raw), 'x-webhook-timestamp': String(t - 3600000) }, rawBody: Buffer.from(raw) }).valid, 'Cashfree: stale (replayed) timestamp rejected');
    const off = createCashfreeProvider(readConfig({}).cashfree);
    ok(!off.verifyWebhook({ headers: { 'x-webhook-signature': 'x', 'x-webhook-timestamp': '1' }, rawBody: Buffer.from(raw) }).valid, 'Cashfree disabled: webhooks always rejected');
  }

  console.log('Amount / currency / reference mismatch');
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_1000' })).order; h.remote.state = 'COMPLETED'; h.remote.amount = 100; // provider reports ₹1
    await h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId));
    ok(h.users['9000000001'].diamonds === 500, 'provider-reported amount ₹1 on a ₹1000 order → NOT credited');
    const r = await h.service.processSuccessfulPayment(o.orderId, { state: 'SUCCESS', amountPaise: 100000, currency: 'USD' });
    ok(r.ok === false && /currency/.test(r.reason) && h.users['9000000001'].diamonds === 500, 'wrong currency → NOT credited');
    const r2 = await h.service.processSuccessfulPayment(o.orderId, { state: 'SUCCESS', amountPaise: 100000, currency: 'INR', providerOrderId: 'SOMEONE-ELSES' });
    ok(r2.ok === false && h.users['9000000001'].diamonds === 500, 'wrong provider order reference → NOT credited');
  }
  {
    const h = harness(); const a = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_100' })).order; const b = (await h.service.createPaymentOrder({ user: { userId: 'U2', mobile: '9000000002' }, packageId: 'pkg_fixed_100' })).order;
    h.remote.state = 'COMPLETED'; h.remote.amount = 10000; h.remote.txn = 'SAMETXN';
    await h.service.syncOrder(a.orderId); await h.service.syncOrder(b.orderId);
    ok(h.users['9000000001'].diamonds === 500 + 1000000 && h.users['9000000002'].diamonds === 0, 'one provider transaction id can only settle one order');
  }

  console.log('Pending / failed / cancelled / expired / late success');
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_100' })).order;
    h.remote.state = 'FAILED'; await h.service.syncOrder(o.orderId);
    ok((await h.store.getOrder(o.orderId)).status === 'FAILED' && h.users['9000000001'].diamonds === 500, 'FAILED order is not credited');
    h.remote.state = 'PENDING'; await h.service.syncOrder(o.orderId);
    ok((await h.store.getOrder(o.orderId)).status === 'FAILED', 'terminal FAILED is not downgraded back to PENDING');
    h.remote.state = 'COMPLETED'; h.remote.amount = 10000; await h.service.syncOrder(o.orderId);
    ok(h.users['9000000001'].diamonds === 500 + 1000000, 'late VERIFIED success after FAILED is credited once (money really moved)');
  }
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_250' })).order;
    const c = await h.service.cancelOrExpireOrder({ orderId: o.orderId, userId: 'U1' });
    ok(c.order.status === 'CANCELLED', 'user cancel → CANCELLED');
    ok((await h.service.cancelOrExpireOrder({ orderId: o.orderId, userId: 'U2' })).error === 'not-found', "another user cannot cancel/see someone else's order");
    ok((await h.service.getPaymentStatus({ orderId: o.orderId, userId: 'U2' })).error === 'not-found', 'status of another user\'s order → not-found');
    h.remote.state = 'PENDING'; await h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId));
    ok((await h.store.getOrder(o.orderId)).status === 'CANCELLED' && h.users['9000000001'].diamonds === 500, 'cancelled order stays cancelled / uncredited without verified success');
    const ex = await h.service.cancelOrExpireOrder({ orderId: (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_500' })).order.orderId, userId: 'U1', reason: 'expired' });
    ok(ex.order.status === 'EXPIRED', 'expiry → EXPIRED');
  }
  {
    const nowRef = { t: Date.now() }; const h = harness({ nowRef }); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_100' })).order;
    nowRef.t += 40 * 60 * 1000; h.remote.state = 'PENDING'; await h.service.syncOrder(o.orderId);
    ok((await h.store.getOrder(o.orderId)).status === 'EXPIRED', 'provider still PENDING long after the window → EXPIRED locally');
  }

  console.log('Wallet failure + retry (transaction-failure safety)');
  {
    let failNext = true; const nowRef = { t: Date.now() };
    const h = harness({ nowRef, wallet: (real) => ({ creditDiamonds: async (a) => { if (failNext) { failNext = false; throw new Error('simulated db failure'); } return real.creditDiamonds(a); } }) });
    const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_250' })).order; h.remote.state = 'COMPLETED';
    const w = await h.service.handleWebhook('phonepe', phonepeWebhook(o.orderId));
    ok(w.httpStatus === 500 && h.users['9000000001'].diamonds === 500, 'wallet failure → 500 (provider will retry), nothing credited');
    ok((await h.store.getOrder(o.orderId)).status === 'SUCCESS' && (await h.store.getOrder(o.orderId)).creditState === 'CREDITING', 'order kept SUCCESS/CREDITING for retry');
    nowRef.t += 60000; const s = await h.service.reconcile({ olderThanMs: 0 });
    ok(h.users['9000000001'].diamonds === 500 + 2600000 && s.credited === 1, 'reconcile retry credits exactly 2,600,000');
    await h.service.reconcile({ olderThanMs: 0 }); ok(h.users['9000000001'].diamonds === 500 + 2600000, 'second reconcile does not double-credit');
  }
  {
    const h = harness(); const o = (await h.service.createPaymentOrder({ user: U1, packageId: 'pkg_fixed_100' })).order;
    const a = await h.adapter.creditDiamonds({ userId: 'U1', diamonds: 1000000, orderId: o.orderId });
    const b = await h.adapter.creditDiamonds({ userId: 'U1', diamonds: 1000000, orderId: o.orderId });
    ok(a.applied && !b.applied && h.users['9000000001'].diamonds === 1000500, 'wallet adapter is idempotent per order id');
  }

  console.log('HTTP routes (fake express app)');
  {
    const routes = {}; const app = { get: (p, ...h) => { routes['GET ' + p] = h; }, post: (p, ...h) => { routes['POST ' + p] = h; } };
    const h0 = harness(); const users = h0.users;
    const userAuth = { requireUserAuth: (req, res, next) => { if (!req.authedMobile) return res.status(401).json({ success: false }); return next(); } };
    const pay = initPayments({ app, userAuth, users, DATA_FOLDER: '/tmp/y', safeRead: (f, d) => d, safeWrite() {}, findUserByUserId: (id) => ({ mobile: '9000000001', user: users['9000000001'] }), saveUsers() {}, logTransaction() {}, pushWalletUpdate() {}, clampDiamondBalance: (u, d) => d, svip: null, env: h0.env, store: createMemoryStore(), providers: h0.providers, logger: quiet });
    pay.stop();
    const call = async (key, req) => { let out = { code: 200 }; const res = { status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } }; const chain = routes[key]; let i = 0; const next = () => { const f = chain[i++]; return f ? f(req, res, next) : undefined; }; await next(); return out; };
    ok((await call('POST /api/payments/order', { body: { packageId: 'pkg_fixed_100' } })).code === 401, 'unauthenticated POST /api/payments/order → 401');
    const created = await call('POST /api/payments/order', { authedMobile: '9000000001', body: { packageId: 'pkg_fixed_100', amount: 1 } });
    ok(created.code === 200 && created.body.order.amountINR === 100 && /^https:/.test(created.body.redirectUrl), 'authenticated order creation returns a provider redirect for ₹100');
    ok(!JSON.stringify(created.body).includes('csecret') && !JSON.stringify(created.body).includes('whpass'), 'response never contains merchant secrets');
    users['9000000002'].country = 'BD';
    const nonIndia = await call('POST /api/payments/order', { authedMobile: '9000000002', body: { packageId: 'pkg_fixed_100' } });
    ok(nonIndia.code === 403 && nonIndia.body.offlineRechargeOnly === true, 'non-India account cannot create an online gateway order');
    users['9000000002'].country = 'IN';
    ok((await call('POST /api/payments/order', { authedMobile: '9000000001', body: { packageId: 'bad' } })).code === 400, 'invalid package → 400');
    const cfgOut = await call('GET /api/payments/config', { authedMobile: '9000000001' });
    ok(cfgOut.body.packages.length === 4 && cfgOut.body.mode === 'gateway', 'config route lists the four packages and the backend-configured mode');
    const forged = await call('POST /api/payments/webhook/:provider', { params: { provider: 'phonepe' }, headers: { authorization: 'bad' }, rawBody: Buffer.from('{}'), body: {} });
    ok(forged.code === 401, 'forged webhook over HTTP → 401');
    const hc = await call('GET /api/payments/health', {});
    ok(hc.body.mode === 'gateway' && hc.body.cashfreeConfigured === false && !JSON.stringify(hc.body).includes('secret'), 'health route is non-sensitive and shows Cashfree inactive');
  }
  {
    const routes = {}; const app = { get: (p, ...h) => { routes['GET ' + p] = h; }, post: (p, ...h) => { routes['POST ' + p] = h; } };
    const pay = initPayments({ app, userAuth: { requireUserAuth: (a, b, n) => n() }, users: {}, DATA_FOLDER: '/tmp/z', safeRead: (f, d) => d, safeWrite() {}, findUserByUserId: () => null, saveUsers() {}, env: { NODE_ENV: 'production' }, logger: quiet, db: { enabled: () => false } }); pay.stop();
    let out; routes['GET /api/payments/config'][1]({}, { json: (b) => { out = b; } });
    ok(out.mode === 'disabled' && out.packages.length === 0 && out.offlineRechargeOnly === true, 'unauthenticated / non-India context cannot see online packages when automatic payments are off');
    const bad = initPayments({ app: { get() {}, post() {} }, userAuth: { requireUserAuth() {} }, users: {}, DATA_FOLDER: '/tmp/z', safeRead: (f, d) => d, safeWrite() {}, findUserByUserId: () => null, saveUsers() {}, env: { NODE_ENV: 'production', PAYMENTS_AUTO_ENABLED: 'true' }, logger: quiet, db: { enabled: () => false } }); bad.stop();
    ok(bad.cfg.autoEnabled === false, 'production start with invalid payment config disables automatic payments safely (no unsafe fallback)');
  }

  console.log(`\nResult: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
