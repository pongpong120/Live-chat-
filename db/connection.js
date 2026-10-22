'use strict';
let Pool = null;
try { ({ Pool } = require('pg')); } catch (_) {}

let pool = null;
let lastHealth = { ok: false, latencyMs: null, checkedAt: null, error: null };

function enabled() { return Boolean(process.env.DATABASE_URL) && Boolean(Pool); }
function getPool() {
  if (!enabled()) return null;
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 20),
    min: Number(process.env.PG_POOL_MIN || 2),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000),
    statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 15000),
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
  });
  pool.on('error', err => console.error('[postgres] idle-client error:', err.message));
  return pool;
}
async function transaction(work, options = {}) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL is required for a database transaction');
  const client = await p.connect();
  try {
    await client.query(options.isolation ? `BEGIN ISOLATION LEVEL ${options.isolation}` : 'BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally { client.release(); }
}
async function health() {
  if (!enabled()) return { ok: false, configured: false, status: 'disabled' };
  const started = Date.now();
  try {
    await getPool().query('SELECT 1');
    lastHealth = { ok: true, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), error: null };
    return { ok: true, configured: true, status: 'connected', ...lastHealth };
  } catch (err) {
    lastHealth = { ok: false, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), error: err.message };
    return { ok: false, configured: true, status: 'degraded', ...lastHealth };
  }
}
async function close() { if (pool) { await pool.end(); pool = null; } }
module.exports = { enabled, getPool, transaction, health, close };
