'use strict';
/**
 * Rocket Crash — shared live round, played with the app's live Diamond wallet.
 *
 * Wallet: uses the SAME path the existing Lucky Fruit game uses in server.js
 * (productionWallet when enabled, otherwise the in-memory user.diamonds that
 * saveUsers() persists), so Rocket Crash can never diverge from gifts,
 * recharge or Lucky Fruit balances.
 *
 * Authority: round phase, multiplier and crash point live on the server only.
 * Cash-out multiplier is computed from the server clock, never from the client.
 * Identity: wallet-affecting events require socket.authedUserId (verified token).
 *
 * Restart safety: open bets are mirrored to a small JSON file; on the next boot
 * any bet that was never settled is refunded (same approach as Lucky Fruit).
 *
 * Limitation: round state is per Node process (single-instance authority).
 */
const crypto = require('crypto');

const ROOM = 'rocket-crash';
const WAIT_MS = 8000;
const CRASH_PAUSE_MS = 4000;
const TICK_MS = 100;
const GROWTH_PER_SEC = 0.075;               // m(t) = e^(GROWTH * seconds)
const MAX_MULTIPLIER = 1000;
const MIN_BET = 1;
const MAX_BET = Number(process.env.ROCKET_MAX_BET) || 1000000;
const HOUSE_EDGE = Math.min(0.2, Math.max(0, Number(process.env.ROCKET_HOUSE_EDGE) || 0.04));
const HISTORY_SIZE = 12;

function rollCrashPoint() {
  const r = crypto.randomInt(0, 1000000) / 1000000;      // [0,1)
  const raw = (1 - HOUSE_EDGE) / (1 - r);
  return Math.min(MAX_MULTIPLIER, Math.max(1, Math.floor(raw * 100) / 100));
}
const multiplierAt = (ms) => Math.max(1, Math.floor(Math.exp(GROWTH_PER_SEC * (ms / 1000)) * 100) / 100);
const timeToMultiplier = (m) => Math.log(m) / GROWTH_PER_SEC * 1000;

function initRocketCrash(io, deps = {}) {
  const {
    findUserByUserId, saveUsers, logTransaction, pushWalletUpdate,
    getWallet, clampBalance, openBetsFile, safeRead, safeWrite
  } = deps;
  const walletReady = typeof findUserByUserId === 'function' && typeof saveUsers === 'function';

  io.on('connection', (socket) => {
    if (!walletReady) {
      socket.on('rocket:join', () => socket.emit('rocket:unavailable', { ok: false, code: 'ROCKET_CRASH_NOT_CONFIGURED', message: 'Rocket Crash is not configured on this server.' }));
      return;
    }
    socket.on('rocket:join', () => api.join(socket));
    socket.on('rocket:bet', (p) => api.bet(socket, p));
    socket.on('rocket:cashout', () => api.cashout(socket));
    socket.on('rocket:balance', () => api.balance(socket));
    socket.on('rocket:leave', () => socket.leave(ROOM));
  });
  if (!walletReady) return null;

  const wallet = () => (typeof getWallet === 'function' ? getWallet() : null);
  const walletOn = () => { const w = wallet(); return !!(w && typeof w.enabled === 'function' && w.enabled()); };

  const game = { roundId: 0, phase: 'waiting', startsAt: 0, startedAt: 0, crashPoint: 1, bets: new Map(), history: [], timer: null };
  const queues = new Map();      // per-user serialisation of wallet mutations

  const userOf = (id) => { const f = findUserByUserId(id); return f ? f.user : null; };
  const balanceOf = (id) => { const u = userOf(id); return u ? Math.max(0, Math.floor(Number(u.diamonds) || 0)) : 0; };
  const unauth = { ok: false, code: 'AUTHENTICATION_REQUIRED', message: 'Please log in again to use this feature.' };
  const act = (socket, payload) => socket.emit('rocket:action', payload);

  function persistOpenBets() {
    if (!openBetsFile || typeof safeWrite !== 'function') return;
    const snap = {};
    for (const [uid, b] of game.bets) if (!b.settled) snap[uid] = { amount: b.amount, roundId: game.roundId };
    safeWrite(openBetsFile, snap, { immediate: true });
  }

  async function runExclusive(uid, fn) {
    const prev = queues.get(uid) || Promise.resolve();
    let release; const mine = new Promise((r) => { release = r; });
    const tail = prev.then(() => mine);
    queues.set(uid, tail);
    await prev;
    try { return await fn(); } finally { release(); if (queues.get(uid) === tail) queues.delete(uid); }
  }

  async function debit(uid, amount, note, key) {
    const u = userOf(uid); if (!u) return { ok: false, reason: 'user-not-found' };
    const w = wallet();
    if (walletOn()) {
      const auth = await w.balance(uid, 'diamonds');
      if (Number.isFinite(Number(auth))) u.diamonds = Math.max(0, Math.floor(Number(auth)));
      if (u.diamonds < amount) return { ok: false, reason: 'insufficient-balance' };
      const r = await w.debit(uid, 'diamonds', amount, note, key, w.txnId(`${key}:debit`));
      if (!r || r.status === 'rejected') return { ok: false, reason: r && r.reason === 'insufficient_funds' ? 'insufficient-balance' : 'wallet-rejected' };
      u.diamonds = Number(r.balanceAfter);
    } else {
      if (u.diamonds < amount) return { ok: false, reason: 'insufficient-balance' };
      u.diamonds -= amount;
    }
    saveUsers(); logTransaction && logTransaction(uid, 'diamonds', -amount, note); pushWalletUpdate && pushWalletUpdate(uid);
    return { ok: true, balance: u.diamonds };
  }

  async function credit(uid, amount, note, key) {
    const u = userOf(uid); if (!u) return { ok: false, reason: 'user-not-found' };
    const w = wallet();
    if (walletOn()) {
      const r = await w.credit(uid, 'diamonds', amount, note, key, w.txnId(`${key}:credit`));
      if (!r || r.status === 'rejected') return { ok: false, reason: 'wallet-rejected' };
      u.diamonds = Number(r.balanceAfter);
    } else {
      u.diamonds = clampBalance ? clampBalance(uid, u.diamonds + amount, 'rocket-crash') : u.diamonds + amount;
    }
    saveUsers(); logTransaction && logTransaction(uid, 'diamonds', amount, note); pushWalletUpdate && pushWalletUpdate(uid);
    return { ok: true, balance: u.diamonds };
  }

  const publicState = () => ({
    roundId: game.roundId, phase: game.phase, startsAt: game.startsAt, serverNow: Date.now(),
    multiplier: game.phase === 'running' ? multiplierAt(Date.now() - game.startedAt) : (game.phase === 'crashed' ? game.crashPoint : 1),
    crashedAt: game.phase === 'crashed' ? game.crashPoint : null,
    history: game.history, bettors: game.bets.size
  });
  const myState = (uid) => {
    const b = game.bets.get(uid);
    return { balance: balanceOf(uid), bet: b ? { amount: b.amount, cashedOutAt: b.cashedOutAt || null, payout: b.payout || 0 } : null };
  };

  const api = {
    join(socket) {
      if (!socket.authedUserId) return socket.emit('rocket:unavailable', unauth);
      socket.join(ROOM);
      socket.emit('rocket:state', { ...publicState(), ...myState(socket.authedUserId) });
    },
    balance(socket) {
      if (!socket.authedUserId) return act(socket, unauth);
      socket.emit('rocket:balance', { balance: balanceOf(socket.authedUserId) });
    },
    async bet(socket, payload) {
      const uid = socket.authedUserId;
      if (!uid) return act(socket, unauth);
      const amount = Math.floor(Number(payload && payload.amount));
      if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
        return act(socket, { ok: false, code: 'INVALID_AMOUNT', message: `Bet must be between ${MIN_BET} and ${MAX_BET}.` });
      }
      await runExclusive(uid, async () => {
        if (game.phase !== 'waiting') return act(socket, { ok: false, code: 'BETTING_CLOSED', message: 'Betting is closed. Wait for the next round.', balance: balanceOf(uid) });
        if (game.bets.has(uid)) return act(socket, { ok: false, code: 'ALREADY_BET', message: 'You already placed a bet this round.', balance: balanceOf(uid) });
        const roundId = game.roundId;
        const d = await debit(uid, amount, 'Rocket Crash bet', `rocket:${roundId}:${uid}`);
        if (!d.ok) {
          const msg = d.reason === 'insufficient-balance' ? 'Not enough diamonds.' : 'Bet could not be processed.';
          return act(socket, { ok: false, code: d.reason, message: msg, balance: balanceOf(uid) });
        }
        if (game.phase !== 'waiting' || game.roundId !== roundId) {   // round closed while debiting -> refund
          await credit(uid, amount, 'Rocket Crash refund (round closed)', `rocket:${roundId}:${uid}:refund`);
          return act(socket, { ok: false, code: 'BETTING_CLOSED', message: 'Round just started — bet refunded.', balance: balanceOf(uid) });
        }
        const u = userOf(uid);
        game.bets.set(uid, { amount, name: u ? u.name : 'Player', settled: false, cashedOutAt: null, payout: 0 });
        persistOpenBets();
        act(socket, { ok: true, type: 'bet', message: 'Bet placed!', balance: d.balance, amount });
        io.to(ROOM).emit('rocket:bettors', { roundId, count: game.bets.size });
      });
    },
    async cashout(socket) {
      const uid = socket.authedUserId;
      if (!uid) return act(socket, unauth);
      const b = game.bets.get(uid);
      if (!b || b.settled || game.phase !== 'running') return act(socket, { ok: false, code: 'NO_ACTIVE_BET', message: 'No active bet to cash out.', balance: balanceOf(uid) });
      // Settle synchronously on the server clock so a crash tick can't race this.
      const elapsed = Date.now() - game.startedAt;
      const mult = Math.min(multiplierAt(elapsed), game.crashPoint);
      if (elapsed >= timeToMultiplier(game.crashPoint)) return act(socket, { ok: false, code: 'TOO_LATE', message: 'Too late — the rocket crashed.', balance: balanceOf(uid) });
      b.settled = true; b.cashedOutAt = mult; b.payout = Math.floor(b.amount * mult);
      persistOpenBets();
      const roundId = game.roundId;
      await runExclusive(uid, async () => {
        const c = await credit(uid, b.payout, 'Rocket Crash win', `rocket:${roundId}:${uid}`);
        if (!c.ok) { console.error(`🚀 Rocket Crash payout FAILED user=${uid} round=${roundId} amount=${b.payout}`); return act(socket, { ok: false, code: 'PAYOUT_FAILED', message: 'Payout failed — please contact support.', balance: balanceOf(uid) }); }
        act(socket, { ok: true, type: 'cashout', message: `Cashed out at ${mult.toFixed(2)}x — payout ${b.payout.toLocaleString('en-US')} (profit ${(b.payout - b.amount) >= 0 ? '+' : ''}${(b.payout - b.amount).toLocaleString('en-US')})`, balance: c.balance, multiplier: mult, payout: b.payout });
        io.to(ROOM).emit('rocket:player-cashout', { roundId, name: b.name, multiplier: mult });
      });
    }
  };

  function startWaiting() {
    game.roundId += 1; game.phase = 'waiting'; game.bets = new Map(); game.crashPoint = rollCrashPoint();
    game.startsAt = Date.now() + WAIT_MS; game.startedAt = 0;
    persistOpenBets();
    io.to(ROOM).emit('rocket:round', publicState());
    game.timer = setTimeout(startRunning, WAIT_MS);
  }
  function startRunning() {
    game.phase = 'running'; game.startedAt = Date.now();
    io.to(ROOM).emit('rocket:round', publicState());
    const crashAfter = timeToMultiplier(game.crashPoint);
    const loop = () => {
      const elapsed = Date.now() - game.startedAt;
      if (elapsed >= crashAfter) return crash();
      io.to(ROOM).emit('rocket:tick', { roundId: game.roundId, phase: 'running', multiplier: multiplierAt(elapsed), serverNow: Date.now() });
      game.timer = setTimeout(loop, TICK_MS);
    };
    game.timer = setTimeout(loop, TICK_MS);
  }
  function crash() {
    game.phase = 'crashed';
    game.history = [game.crashPoint, ...game.history].slice(0, HISTORY_SIZE);
    for (const [uid, b] of game.bets) {
      if (!b.settled) { b.settled = true; io.to(`user:${uid}`).emit('rocket:result', { roundId: game.roundId, won: false, lost: b.amount, message: `Crashed at ${game.crashPoint.toFixed(2)}x — you lost ${b.amount.toLocaleString('en-US')}`, balance: balanceOf(uid) }); }
    }
    persistOpenBets();
    io.to(ROOM).emit('rocket:round', publicState());
    game.timer = setTimeout(startWaiting, CRASH_PAUSE_MS);
  }

  // Boot: refund any bet that was never settled because the server restarted.
  try {
    const left = typeof safeRead === 'function' && openBetsFile ? safeRead(openBetsFile, {}) : {};
    let n = 0;
    for (const uid of Object.keys(left || {})) {
      const amt = Math.floor(Number(left[uid] && left[uid].amount) || 0);
      const u = userOf(uid); if (!u || amt <= 0) continue;
      u.diamonds = clampBalance ? clampBalance(uid, u.diamonds + amt, 'rocket-restart-refund') : u.diamonds + amt;
      logTransaction && logTransaction(uid, 'diamonds', amt, 'Rocket Crash refund (interrupted by server restart)');
      n++;
    }
    if (n) { saveUsers(); console.log(`🚀 Rocket Crash: refunded ${n} in-flight bet(s) from the last restart.`); }
    if (typeof safeWrite === 'function' && openBetsFile) safeWrite(openBetsFile, {}, { immediate: true });
  } catch (e) { console.error('Rocket Crash restart refund failed:', e.message); }

  startWaiting();
  return { _game: game, _api: api, stop() { clearTimeout(game.timer); } };
}

module.exports = { initRocketCrash, rollCrashPoint, multiplierAt, timeToMultiplier, HOUSE_EDGE, MIN_BET, MAX_BET };
