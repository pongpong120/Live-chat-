'use strict';
// Idempotent diamond-credit adapter for gateway payments.
// Wallet balances live in users.json (single-process JSON), so this adapter is the ONLY
// place gateway payments touch user.diamonds. Idempotency key = internal orderId.
// Ordering (same philosophy as wallet/rechargeService.approveTransaction): the credit
// record is persisted BEFORE the balance changes, so a hard crash can only leave a
// visible, reconcilable gap (record without balance) — never a double credit.
const path = require('path');

function createWalletAdapter({ DATA_FOLDER, safeRead, safeWrite, findUserByUserId, saveUsers, logTransaction, pushWalletUpdate, clampDiamondBalance, svip }) {
  const FILE = path.join(DATA_FOLDER, 'paymentCredits.json');
  const credits = safeRead(FILE, {});
  const persist = () => safeWrite(FILE, credits, { immediate: true });

  async function creditDiamonds({ userId, diamonds, orderId, note, packageId }) {
    if (!orderId) throw new Error('orderId required');
    if (!Number.isSafeInteger(diamonds) || diamonds <= 0) throw new Error('invalid diamonds');
    if (credits[orderId]) return { applied: false, duplicate: true, credit: credits[orderId] };
    const found = findUserByUserId(userId);
    if (!found) throw new Error('user-not-found');       // order stays SUCCESS/uncredited; reconcile retries
    const before = found.user.diamonds || 0;
    const after = clampDiamondBalance ? clampDiamondBalance(userId, before + diamonds, 'gateway-recharge') : before + diamonds;
    credits[orderId] = { orderId, userId, diamonds, packageId: packageId || null, balanceBefore: before, balanceAfter: after, at: new Date().toISOString() };
    persist();                                           // 1) idempotency record first
    found.user.diamonds = after;                         // 2) then the balance
    saveUsers({ immediate: true });
    if (logTransaction) logTransaction(userId, 'diamonds', diamonds, `Recharge (${note || orderId})`);
    if (pushWalletUpdate) pushWalletUpdate(userId);
    if (svip && typeof svip.recordRecharge === 'function') svip.recordRecharge(userId, diamonds, orderId, 'gateway-recharge');
    return { applied: true, credit: credits[orderId] };
  }
  return { creditDiamonds, _credits: credits };
}
module.exports = { createWalletAdapter };
