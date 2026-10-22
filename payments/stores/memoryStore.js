'use strict';
// In-memory payment store. FOR TESTS AND NON-PRODUCTION SANDBOXING ONLY.
// Every method is synchronous inside (no awaits between check and write), so
// compare-and-set operations are atomic within one Node process — the same
// semantics the Postgres store gets from single-statement conditional UPDATEs
// and unique indexes.
const { canTransition, isTerminal } = require('../stateMachine');

function createMemoryStore({ persist } = {}) {
  const orders = new Map();      // orderId -> order
  const events = new Set();      // `${provider}|${eventId}`
  const txnIndex = new Map();    // `${provider}|${providerTxnId}` -> orderId
  const save = () => { if (typeof persist === 'function') persist({ orders: [...orders.values()], events: [...events] }); };
  const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

  return {
    kind: 'memory',
    async insertOrder(order) {
      if (orders.has(order.orderId)) return { inserted: false, reason: 'duplicate-order-id' };
      orders.set(order.orderId, { ...order, creditState: 'NONE', creditClaimedAt: null, creditedAt: null });
      save(); return { inserted: true, order: clone(orders.get(order.orderId)) };
    },
    async getOrder(orderId) { return clone(orders.get(orderId)); },
    async findReusableOrder({ userId, packageId, provider, nowMs }) {
      for (const o of orders.values()) {
        if (o.userId === userId && o.packageId === packageId && o.provider === provider &&
            (o.status === 'CREATED' || o.status === 'PENDING') && o.expiresAtMs > nowMs && (o.redirectUrl || o.paymentSessionId)) return clone(o);
      }
      return null;
    },
    async countRecentOrders({ userId, sinceMs }) {
      let n = 0; for (const o of orders.values()) if (o.userId === userId && o.createdAtMs >= sinceMs) n++; return n;
    },
    async updateFields(orderId, patch) {
      const o = orders.get(orderId); if (!o) return null;
      Object.assign(o, patch, { updatedAt: new Date().toISOString() }); save(); return clone(o);
    },
    // Atomic compare-and-set status transition.
    async transition(orderId, to, { verified = false, patch = {} } = {}) {
      const o = orders.get(orderId); if (!o) return { changed: false, reason: 'not-found' };
      if (o.status === to) return { changed: false, reason: 'already', order: clone(o) };
      if (!canTransition(o.status, to, { verified })) return { changed: false, reason: `illegal:${o.status}->${to}`, order: clone(o) };
      if (patch.providerTxnId) {
        const key = `${o.provider}|${patch.providerTxnId}`;
        const owner = txnIndex.get(key);
        if (owner && owner !== orderId) return { changed: false, reason: 'provider-txn-already-used', order: clone(o) };
        txnIndex.set(key, orderId);
      }
      o.status = to; Object.assign(o, patch); o.updatedAt = new Date().toISOString();
      save(); return { changed: true, order: clone(o) };
    },
    // Exactly one caller wins the right to credit. A stale CREDITING claim can be re-taken
    // (wallet credit itself is idempotent by orderId, so a re-take is safe).
    async claimCredit(orderId, { staleMs = 30000, nowMs = Date.now() } = {}) {
      const o = orders.get(orderId);
      if (!o || o.status !== 'SUCCESS') return { claimed: false, reason: 'not-success' };
      if (o.creditState === 'CREDITED') return { claimed: false, reason: 'already-credited', order: clone(o) };
      if (o.creditState === 'CREDITING' && nowMs - o.creditClaimedAt < staleMs) return { claimed: false, reason: 'in-progress', order: clone(o) };
      o.creditState = 'CREDITING'; o.creditClaimedAt = nowMs; o.updatedAt = new Date().toISOString();
      save(); return { claimed: true, order: clone(o) };
    },
    async markCredited(orderId, { creditedAt = new Date().toISOString() } = {}) {
      const o = orders.get(orderId); if (!o) return null;
      o.creditState = 'CREDITED'; o.creditedAt = creditedAt; o.updatedAt = new Date().toISOString(); save(); return clone(o);
    },
    async recordEvent({ provider, eventId }) {
      const k = `${provider}|${eventId}`; if (events.has(k)) return { inserted: false };
      events.add(k); save(); return { inserted: true };
    },
    async listForReconcile({ olderThanMs, nowMs = Date.now(), limit = 50 }) {
      const out = [];
      for (const o of orders.values()) {
        const open = !isTerminal(o.status) && nowMs - o.createdAtMs >= olderThanMs;
        const uncredited = o.status === 'SUCCESS' && o.creditState !== 'CREDITED';
        if (open || uncredited) out.push(clone(o));
        if (out.length >= limit) break;
      }
      return out;
    },
    async listOrdersForUser(userId, limit = 20) {
      return [...orders.values()].filter((o) => o.userId === userId).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, limit).map(clone);
    },
    _dump() { return { orders: [...orders.values()].map(clone), events: [...events] }; }
  };
}
module.exports = { createMemoryStore };
