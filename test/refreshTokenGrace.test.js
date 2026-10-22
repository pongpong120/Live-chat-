// test/refreshTokenGrace.test.js
// Verifies security/refreshTokens.js's rotate() — specifically the
// 2026-09-26 "reuse grace window" fix for the remaining half of the
// "Expired" session bug: a client retrying /api/auth/refresh after losing
// the response to a successful rotation (not a failed one) must still end
// up with a valid session, while a refresh token reused outside the grace
// window (or a dead-end chain) must still be rejected exactly as before.
//
// Runs against an in-memory fake of db/connection.js — no real Postgres
// needed — by pre-seeding require.cache before security/refreshTokens.js
// is first required, so it picks up the fake instead of the real module.
//
// Run: node test/refreshTokenGrace.test.js

const path = require("path");
const crypto = require("crypto");
const Module = require("module");

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓", msg); }
  else { fail++; console.error("  ✗ FAIL:", msg); }
}

// ---------- fake db/connection.js ----------
let sessions = [];
let nextId = 1;
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

function findOne(pred) { return sessions.find(pred) || null; }

function fakeClient() {
  return {
    async query(sql, params = []) {
      if (sql.includes("revoked_at IS NULL AND refresh_expires_at>now() FOR UPDATE")) {
        const row = findOne(r => r.refresh_token_hash === params[0] && !r.revoked_at && r.refresh_expires_at.getTime() > Date.now());
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes("revoked_at IS NOT NULL AND revoked_at >")) {
        const graceMs = Number(params[1]);
        const row = findOne(r => r.refresh_token_hash === params[0] && r.revoked_at && (Date.now() - r.revoked_at.getTime()) < graceMs);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.includes("WHERE session_id=$1 FOR UPDATE")) {
        const row = findOne(r => r.session_id === params[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (sql.startsWith("INSERT INTO auth_sessions")) {
        const row = {
          session_id: String(nextId++),
          user_id: params[0], access_token_hash: params[1], refresh_token_hash: params[2],
          device_id: params[3], user_agent: params[4], ip_hash: params[5],
          created_at: new Date(), last_seen_at: new Date(),
          access_expires_at: params[6], refresh_expires_at: params[7],
          revoked_at: null, replaced_by: null
        };
        sessions.push(row);
        return { rowCount: 1, rows: [{ session_id: row.session_id }] };
      }
      if (sql.startsWith("UPDATE auth_sessions SET revoked_at=now(),replaced_by")) {
        const row = findOne(r => r.session_id === params[0]);
        if (row) { row.revoked_at = new Date(); row.replaced_by = params[1]; }
        return { rowCount: row ? 1 : 0, rows: [] };
      }
      throw new Error("fake db: unhandled query: " + sql);
    }
  };
}

const fakeDbModule = {
  enabled: () => true,
  getPool: () => fakeClient(), // createSession() queries getPool() directly (not just via transaction()), so this must actually execute against the same in-memory `sessions` state that fakeClient() and transaction() use — a stub that always returns empty rows makes createSession() crash on `rows[0].session_id` before any test body runs.
  transaction: async (work) => work(fakeClient()),
  health: async () => ({ ok: true })
};

const dbConnectionPath = require.resolve(path.join(__dirname, "..", "db", "connection.js"));
require.cache[dbConnectionPath] = new Module(dbConnectionPath);
require.cache[dbConnectionPath].exports = fakeDbModule;
require.cache[dbConnectionPath].loaded = true;

process.env.REFRESH_TOKEN_REUSE_GRACE_MS = "10000"; // 10s, matches production default
const refreshTokens = require(path.join(__dirname, "..", "security", "refreshTokens.js"));

async function main() {
  console.log("=== normal rotation: unused refresh token succeeds, old token becomes dead ===");
  {
    sessions = []; nextId = 1;
    const s1 = await refreshTokens.createSession({ userId: "u1" });
    const r1 = await refreshTokens.rotate(s1.refreshToken);
    assert(r1 && r1.accessToken, "first rotation succeeds and returns a new access token");
    assert(r1.refreshToken !== s1.refreshToken, "new refresh token differs from the original");
    // NOTE: an immediate replay of s1.refreshToken is now the grace-window
    // recovery path by design (see next block) - asserting it fails here
    // would contradict the fix itself. The "reuse eventually refused" case
    // is covered below by aging revoked_at past REUSE_GRACE_MS.
    const replayed = sessions.find(r => r.refresh_token_hash === hash(s1.refreshToken));
    replayed.revoked_at = new Date(Date.now() - 20000);
    const replay = await refreshTokens.rotate(s1.refreshToken);
    assert(replay === null, "reusing an old token is refused once it's past the grace window (baseline no-regression check)");
  }

  console.log("=== lost-response retry within the grace window recovers the session ===");
  {
    sessions = []; nextId = 1;
    const s1 = await refreshTokens.createSession({ userId: "u2" });
    // Simulate: server successfully rotates (client never sees the response).
    const r1 = await refreshTokens.rotate(s1.refreshToken);
    assert(r1 && r1.accessToken, "server-side rotation itself succeeded (as it would even if the response was then lost)");
    // Client, having lost that response, retries with the SAME original token.
    const retry = await refreshTokens.rotate(s1.refreshToken);
    assert(retry && retry.accessToken, "retry with the same (already-rotated) token still yields a valid new session, instead of 401");
    assert(retry.accessToken !== r1.accessToken, "retry gets its own fresh token pair rather than replaying the first rotation's tokens");
    // Both the original AND the first-successful-rotation's refresh token are now dead (expected).
    const deadOriginal = await refreshTokens.rotate(s1.refreshToken);
    // Third call within the window should ALSO recover (multiple retries self-heal to the same live end).
    assert(deadOriginal && deadOriginal.accessToken, "a second retry within the window also recovers (self-healing across multiple retries)");
  }

  console.log("=== reuse OUTSIDE the grace window is still refused ===");
  {
    sessions = []; nextId = 1;
    process.env.REFRESH_TOKEN_REUSE_GRACE_MS = "10000";
    delete require.cache[require.resolve(path.join(__dirname, "..", "security", "refreshTokens.js"))];
    const rt2 = require(path.join(__dirname, "..", "security", "refreshTokens.js"));
    const s1 = await rt2.createSession({ userId: "u3" });
    await rt2.rotate(s1.refreshToken);
    // Manually age the revoked_at past the grace window instead of sleeping in the test.
    const revokedRow = sessions.find(r => r.refresh_token_hash === hash(s1.refreshToken));
    revokedRow.revoked_at = new Date(Date.now() - 20000); // 20s ago, past the 10s window
    const stale = await rt2.rotate(s1.refreshToken);
    assert(stale === null, "reuse past the grace window is refused, not silently recovered");
  }

  console.log("=== grace window disabled (REFRESH_TOKEN_REUSE_GRACE_MS=0) behaves exactly like before the fix ===");
  {
    sessions = []; nextId = 1;
    process.env.REFRESH_TOKEN_REUSE_GRACE_MS = "0";
    delete require.cache[require.resolve(path.join(__dirname, "..", "security", "refreshTokens.js"))];
    const rt3 = require(path.join(__dirname, "..", "security", "refreshTokens.js"));
    const s1 = await rt3.createSession({ userId: "u4" });
    await rt3.rotate(s1.refreshToken);
    const immediateRetry = await rt3.rotate(s1.refreshToken);
    assert(immediateRetry === null, "with the grace window disabled, an immediate retry is refused (legacy strict behavior preserved)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("Test crashed:", e); process.exit(1); });
