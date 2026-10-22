'use strict';
/* Rocket Crash: auth gate, wallet debit/credit, round rules (fake io + fake wallet). */
const assert = require('node:assert/strict');
const { initRocketCrash, multiplierAt, timeToMultiplier, rollCrashPoint } = require('./rocketCrash');

const handlers = [];
const emitted = [];
const io = { on: (e, fn) => { if (e === 'connection') handlers.push(fn); }, to: () => ({ emit: (ev, p) => emitted.push({ ev, p }) }) };
const users = { u1: { userId: 'u1', name: 'A', diamonds: 5000 }, u2: { userId: 'u2', name: 'B', diamonds: 50 } };
const rc = initRocketCrash(io, {
  findUserByUserId: (id) => (users[id] ? { user: users[id] } : null),
  saveUsers() {}, logTransaction() {}, pushWalletUpdate() {},
  getWallet: () => ({ enabled: () => false }),
  clampBalance: (_u, v) => Math.floor(v),
  openBetsFile: null
});
function sock(uid) {
  const h = {}; const out = [];
  const s = { authedUserId: uid, on: (e, f) => { h[e] = f; }, emit: (e, p) => out.push({ e, p }), join() {}, leave() {} };
  handlers[0](s); return { h, out };
}
(async () => {
  const g = sock(null);
  g.h['rocket:join'](); assert.equal(g.out.at(-1).p.code, 'AUTHENTICATION_REQUIRED');
  await g.h['rocket:bet']({ amount: 100 }); assert.equal(g.out.at(-1).p.ok, false);

  const a = sock('u1'); a.h['rocket:join'](); assert.equal(a.out.at(-1).e, 'rocket:state');
  assert.equal(a.out.at(-1).p.balance, 5000);

  // bet during waiting debits the live balance
  await a.h['rocket:bet']({ amount: 1000 });
  assert.equal(a.out.at(-1).p.ok, true); assert.equal(users.u1.diamonds, 4000);
  await a.h['rocket:bet']({ amount: 100 }); assert.equal(a.out.at(-1).p.code, 'ALREADY_BET');
  const b = sock('u2'); await b.h['rocket:bet']({ amount: 100 }); assert.equal(b.out.at(-1).p.code, 'insufficient-balance');
  // min bet is 1 diamond: 0 and negatives rejected, 1 accepted and debited exactly 1; max enforced
  const c = sock('u2'); c.h['rocket:join']();
  await c.h['rocket:bet']({ amount: 0 }); assert.equal(c.out.at(-1).p.code, 'INVALID_AMOUNT');
  await c.h['rocket:bet']({ amount: -5 }); assert.equal(c.out.at(-1).p.code, 'INVALID_AMOUNT');
  await c.h['rocket:bet']({ amount: 1000001 }); assert.equal(c.out.at(-1).p.code, 'INVALID_AMOUNT');
  await c.h['rocket:bet']({ amount: 1 }); assert.equal(c.out.at(-1).p.ok, true); assert.equal(users.u2.diamonds, 49);
  await a.h['rocket:bet']({ amount: 0.4 }); assert.equal(a.out.at(-1).p.code, 'INVALID_AMOUNT');

  // cash-out only while running, paid from the server multiplier
  await a.h['rocket:cashout'](); assert.equal(a.out.at(-1).p.code, 'NO_ACTIVE_BET');
  const game = rc._game; clearTimeout(game.timer);
  game.phase = 'running'; game.crashPoint = 50; game.startedAt = Date.now() - 10000;
  await a.h['rocket:cashout']();
  const r = a.out.at(-1).p; assert.equal(r.ok, true); assert.ok(r.multiplier >= 2 && r.payout >= 2000);
  assert.equal(users.u1.diamonds, 4000 + r.payout);
  await a.h['rocket:cashout'](); assert.equal(a.out.at(-1).p.ok, false);   // no double payout

  // math sanity
  assert.equal(multiplierAt(0), 1); assert.ok(timeToMultiplier(2) > 0);
  for (let i = 0; i < 2000; i++) { const c = rollCrashPoint(); assert.ok(c >= 1 && c <= 1000); }
  rc.stop();
  console.log('Rocket Crash: all assertions passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
