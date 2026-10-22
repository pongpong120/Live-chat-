'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initLuckyFruit } = require('../games/luckyFruitServer');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lucky-fruit-avatar-'));
  const now = Date.now();
  const user = { userId: 'avatar-user-1', mobile: '9990002222', name: 'Avatar User', photo: 'https://cdn.example.test/profile/avatar-user-1.jpg', diamonds: 5000 };
  fs.writeFileSync(path.join(temp, 'lucky_fruit_rounds.json'), JSON.stringify([
    { roundId: 'round-avatar-1', userId: user.userId, name: user.name, avatar: null, bet: 100, win: 500, fruit: 'orange', at: now, bets: { orange: 100 } }
  ]));
  const routes = new Map();
  const app = { get: (url, ...args) => routes.set(`GET ${url}`, args[args.length - 1]), post() {} };
  initLuckyFruit({
    app, userAuth: { requireUserAuth() {} }, users: { [user.mobile]: user },
    findUserByUserId: id => id === user.userId ? { user } : null,
    saveUsers() {}, logTransaction() {}, pushWalletUpdate() {},
    productionWallet: { enabled: () => false }, dataFolder: temp, io: null
  });
  let response;
  const res = { set() { return this; }, status() { return this; }, json(data) { response = data; return this; } };
  await routes.get('GET /api/lucky-fruit/state')({ authedMobile: user.mobile, body: {} }, res);
  assert.strictEqual(response.success, true);
  assert.strictEqual(response.winners[0].avatar, user.photo, 'winner avatar must resolve from the current profile photo when the historical round has no avatar');
  assert.strictEqual(response.rankingToday[0].avatar, user.photo, 'ranking avatar must resolve from the current profile photo');
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('Lucky Fruit Winning List and ranking profile-avatar resolution: PASS');
})().catch(error => { console.error(error); process.exit(1); });
