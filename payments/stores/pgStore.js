'use strict';
// Postgres payment store (REQUIRED for production). Atomicity comes from
// single-statement conditional UPDATEs and unique indexes (see db/migrations/003_payments.sql).
// STATUS: statically written against the migration; NOT executed in the build sandbox (no Postgres).
// Run `npm run db:migrate` and the sandbox procedure in docs/PAYMENTS_GATEWAY.md before enabling.
const { canTransition, isTerminal } = require('../stateMachine');

const COLS = `order_id, user_id, mobile, provider, package_id, package_name, amount_paise, currency, diamonds,
  status, credit_state, credit_claimed_at_ms, credited_at, provider_order_id, provider_txn_id, redirect_url,
  payment_session_id, expires_at_ms, created_at_ms, created_at, updated_at`;

function rowToOrder(r) {
  if (!r) return null;
  return {
    orderId: r.order_id, userId: r.user_id, mobile: r.mobile, provider: r.provider,
    packageId: r.package_id, packageName: r.package_name, amountPaise: Number(r.amount_paise), currency: r.currency,
    diamonds: Number(r.diamonds), status: r.status, creditState: r.credit_state,
    creditClaimedAt: r.credit_claimed_at_ms == null ? null : Number(r.credit_claimed_at_ms),
    creditedAt: r.credited_at ? new Date(r.credited_at).toISOString() : null,
    providerOrderId: r.provider_order_id, providerTxnId: r.provider_txn_id, redirectUrl: r.redirect_url,
    paymentSessionId: r.payment_session_id, expiresAtMs: r.expires_at_ms == null ? null : Number(r.expires_at_ms),
    createdAtMs: Number(r.created_at_ms), createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString()
  };
}

function createPgStore({ pool }) {
  const q = (text, params) => pool.query(text, params);
  return {
    kind: 'postgres',
    async insertOrder(o) {
      const r = await q(
        `INSERT INTO payment_orders (order_id,user_id,mobile,provider,package_id,package_name,amount_paise,currency,diamonds,status,
           redirect_url,payment_session_id,provider_order_id,expires_at_ms,created_at_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (order_id) DO NOTHING RETURNING ${COLS}`,
        [o.orderId, o.userId, o.mobile, o.provider, o.packageId, o.packageName, o.amountPaise, o.currency, o.diamonds, o.status,
         o.redirectUrl || null, o.paymentSessionId || null, o.providerOrderId || null, o.expiresAtMs || null, o.createdAtMs]);
      return r.rows[0] ? { inserted: true, order: rowToOrder(r.rows[0]) } : { inserted: false, reason: 'duplicate-order-id' };
    },
    async getOrder(orderId) { return rowToOrder((await q(`SELECT ${COLS} FROM payment_orders WHERE order_id=$1`, [orderId])).rows[0]); },
    async findReusableOrder({ userId, packageId, provider, nowMs }) {
      const r = await q(`SELECT ${COLS} FROM payment_orders WHERE user_id=$1 AND package_id=$2 AND provider=$3
        AND status IN ('CREATED','PENDING') AND expires_at_ms > $4 AND (redirect_url IS NOT NULL OR payment_session_id IS NOT NULL)
        ORDER BY created_at_ms DESC LIMIT 1`, [userId, packageId, provider, nowMs]);
      return rowToOrder(r.rows[0]);
    },
    async countRecentOrders({ userId, sinceMs }) {
      return Number((await q(`SELECT count(*) AS n FROM payment_orders WHERE user_id=$1 AND created_at_ms >= $2`, [userId, sinceMs])).rows[0].n);
    },
    async updateFields(orderId, p) {
      const r = await q(`UPDATE payment_orders SET redirect_url=COALESCE($2,redirect_url), payment_session_id=COALESCE($3,payment_session_id),
        provider_order_id=COALESCE($4,provider_order_id), expires_at_ms=COALESCE($5,expires_at_ms), updated_at=now()
        WHERE order_id=$1 RETURNING ${COLS}`, [orderId, p.redirectUrl || null, p.paymentSessionId || null, p.providerOrderId || null, p.expiresAtMs || null]);
      return rowToOrder(r.rows[0]);
    },
    // Single conditional UPDATE: only succeeds if the current status allows the transition.
    async transition(orderId, to, { verified = false, patch = {} } = {}) {
      const cur = await this.getOrder(orderId);
      if (!cur) return { changed: false, reason: 'not-found' };
      if (cur.status === to) return { changed: false, reason: 'already', order: cur };
      if (!canTransition(cur.status, to, { verified })) return { changed: false, reason: `illegal:${cur.status}->${to}`, order: cur };
      // Allowed "from" set is recomputed from the state machine so the CAS cannot widen it.
      const from = ['CREATED', 'PENDING', 'FAILED', 'CANCELLED', 'EXPIRED', 'SUCCESS'].filter((s) => canTransition(s, to, { verified }));
      try {
        const r = await q(`UPDATE payment_orders SET status=$2, provider_txn_id=COALESCE($4,provider_txn_id),
          provider_order_id=COALESCE($5,provider_order_id), updated_at=now()
          WHERE order_id=$1 AND status = ANY($3::text[]) RETURNING ${COLS}`,
          [orderId, to, from, patch.providerTxnId || null, patch.providerOrderId || null]);
        if (!r.rows[0]) return { changed: false, reason: 'lost-race', order: await this.getOrder(orderId) };
        return { changed: true, order: rowToOrder(r.rows[0]) };
      } catch (e) {
        if (e && e.code === '23505') return { changed: false, reason: 'provider-txn-already-used', order: cur }; // unique(provider, provider_txn_id)
        throw e;
      }
    },
    async claimCredit(orderId, { staleMs = 30000, nowMs = Date.now() } = {}) {
      const r = await q(`UPDATE payment_orders SET credit_state='CREDITING', credit_claimed_at_ms=$2, updated_at=now()
        WHERE order_id=$1 AND status='SUCCESS' AND (credit_state='NONE' OR (credit_state='CREDITING' AND credit_claimed_at_ms < $3))
        RETURNING ${COLS}`, [orderId, nowMs, nowMs - staleMs]);
      if (r.rows[0]) return { claimed: true, order: rowToOrder(r.rows[0]) };
      const cur = await this.getOrder(orderId);
      return { claimed: false, reason: !cur || cur.status !== 'SUCCESS' ? 'not-success' : cur.creditState === 'CREDITED' ? 'already-credited' : 'in-progress', order: cur };
    },
    async markCredited(orderId, { creditedAt } = {}) {
      const r = await q(`UPDATE payment_orders SET credit_state='CREDITED', credited_at=COALESCE($2, now()), updated_at=now()
        WHERE order_id=$1 RETURNING ${COLS}`, [orderId, creditedAt || null]);
      return rowToOrder(r.rows[0]);
    },
    async recordEvent({ provider, eventId, orderId }) {
      const r = await q(`INSERT INTO payment_events (provider,event_id,order_id) VALUES ($1,$2,$3) ON CONFLICT (provider,event_id) DO NOTHING RETURNING event_id`, [provider, eventId, orderId || null]);
      return { inserted: r.rowCount === 1 };
    },
    async listForReconcile({ olderThanMs, nowMs = Date.now(), limit = 50 }) {
      const r = await q(`SELECT ${COLS} FROM payment_orders
        WHERE (status IN ('CREATED','PENDING') AND created_at_ms <= $1) OR (status='SUCCESS' AND credit_state <> 'CREDITED')
        ORDER BY created_at_ms ASC LIMIT $2`, [nowMs - olderThanMs, limit]);
      return r.rows.map(rowToOrder);
    },
    async listOrdersForUser(userId, limit = 20) {
      return (await q(`SELECT ${COLS} FROM payment_orders WHERE user_id=$1 ORDER BY created_at_ms DESC LIMIT $2`, [userId, limit])).rows.map(rowToOrder);
    },
    isTerminal
  };
}
module.exports = { createPgStore };
