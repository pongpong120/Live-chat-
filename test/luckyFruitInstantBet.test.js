'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initLuckyFruit } = require('../games/luckyFruitServer');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-fruit-test-'));
  const routes = new Map();
  const app = {
    get: (url, ...args) => routes.set(`GET ${url}`, args[args.length - 1]),
    post: (url, ...args) => routes.set(`POST ${url}`, args[args.length - 1])
  };
  const user = { userId: 'test-user-1', mobile: '9990001111', name: 'Test User', diamonds: 1000000 };
  const users = { [user.mobile]: user };
  const calls = { logs: [], pushes: 0, saves: 0 };
  initLuckyFruit({
    app, userAuth: { requireUserAuth() {} }, users,
    findUserByUserId: () => null,
    saveUsers: () => { calls.saves++; },
    logTransaction: (...args) => calls.logs.push(args),
    pushWalletUpdate: () => { calls.pushes++; },
    productionWallet: { enabled: () => false }, dataFolder: temp, io: null
  });
  async function call(method, url, body = {}) {
    let status = 200, data = null;
    const res = {
      status(n) { status = n; return this; },
      set() { return this; },
      json(d) { data = d; return this; }
    };
    await routes.get(`${method} ${url}`)({ authedMobile: user.mobile, body }, res);
    return { status, data };
  }
  const fruitIds = ['orange', 'banana', 'grape', 'cherry', 'straw', 'mango', 'melon', 'apple'];
  let totalRoundBet = 0;
  for (const fruit of fruitIds) {
    const before = user.diamonds;
    const result = await call('POST', '/api/lucky-fruit/bet', { fruit, amount: 1000 });
    assert.strictEqual(result.status, 200, `bet ${fruit} should be accepted`);
    assert.strictEqual(result.data.success, true);
    assert.strictEqual(user.diamonds, before - 1000, 'wallet must debit immediately when bet is accepted');
    totalRoundBet += 1000;
  }
  const activeFile = path.join(temp, 'lucky_fruit_active_bets.json');
  assert.ok(fs.existsSync(activeFile), 'active bets must persist for reload/restart recovery');
  const active = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
  assert.strictEqual(active[user.userId].bet, totalRoundBet);
  const spin = await call('POST', '/api/lucky-fruit/spin', { bets: {} });
  assert.strictEqual(spin.status, 200, 'spin should settle server-recorded bets');
  assert.strictEqual(spin.data.bet, totalRoundBet);
  assert.strictEqual(spin.data.success, true);
  assert.strictEqual(fs.existsSync(activeFile) && JSON.parse(fs.readFileSync(activeFile, 'utf8'))[user.userId], undefined, 'active bets clear after settlement');
  assert.strictEqual(spin.data.balance, user.diamonds, 'returned balance must match authoritative wallet');
  assert.ok(spin.data.win >= 0);
  assert.strictEqual(calls.logs.filter(x => x[3] === 'Lucky Fruit bet').length, fruitIds.length, 'each accepted bet must be ledgered once');
  // A repeated winner must not appear multiple times in the winner list.
  for (const fruit of fruitIds) await call('POST', '/api/lucky-fruit/bet', { fruit, amount: 1000 });
  const spin2 = await call('POST', '/api/lucky-fruit/spin', { bets: {} });
  assert.strictEqual(spin2.status, 200);
  const ids = (spin2.data.winners || []).map(x => x.userId);
  assert.strictEqual(ids.length, new Set(ids).size, 'winner list must be unique by user');
  console.log('Lucky Fruit instant debit, persisted active bets, settlement and unique-winner checks: PASS');
  fs.rmSync(temp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
