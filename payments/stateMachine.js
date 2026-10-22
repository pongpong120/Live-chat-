'use strict';
// Payment order states and the ONLY allowed transitions.
// SUCCESS / FAILED / CANCELLED / EXPIRED are terminal, with one deliberate
// exception: a FAILED/CANCELLED/EXPIRED order may move to SUCCESS only when
// the provider's authoritative server-side status says the payment actually
// succeeded (late success after a user-side cancel/timeout is real money).
// That path requires { verified: true } and is audited by the caller.

const STATES = Object.freeze({
  CREATED: 'CREATED', PENDING: 'PENDING', SUCCESS: 'SUCCESS',
  FAILED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED'
});

const ALLOWED = Object.freeze({
  CREATED:   ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  PENDING:   ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'],
  FAILED:    ['SUCCESS'],     // only via verified provider status
  CANCELLED: ['SUCCESS'],     // only via verified provider status
  EXPIRED:   ['SUCCESS'],     // only via verified provider status
  SUCCESS:   []               // terminal; never leaves SUCCESS
});

function canTransition(from, to, { verified = false } = {}) {
  if (from === to) return false;
  const next = ALLOWED[from];
  if (!next || !next.includes(to)) return false;
  if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(from) && to === 'SUCCESS') return verified === true;
  return true;
}
function isTerminal(state) { return ['SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(state); }

module.exports = { STATES, ALLOWED, canTransition, isTerminal };
