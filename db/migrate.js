'use strict';
const fs = require('fs');
const path = require('path');
const { getPool, enabled } = require('./connection');
const files = [
  path.join(__dirname, 'schema.sql'),
  path.join(__dirname, '..', 'integration_update', 'module4_wallet_ledger', 'wallet', 'schema.sql'),
  path.join(__dirname, 'migrations', '002_production_core.sql'),
  path.join(__dirname, 'migrations', '003_payments.sql')   // gateway payments (additive; rollback: 003_payments.down.sql)
];
async function run() {
  if (!enabled()) throw new Error('DATABASE_URL is required');
  const pool = getPool();
  const lock = 873412991;
  await pool.query('SELECT pg_advisory_lock($1)', [lock]);
  try {
    for (const file of files) {
      // The legacy base schema predates IF NOT EXISTS on several tables.
      // Apply it only to a brand-new database; subsequent boots use the
      // additive wallet/core migrations and never attempt destructive or
      // duplicate CREATE TABLE statements.
      if (file === path.join(__dirname, 'schema.sql')) {
        const exists = await pool.query("SELECT to_regclass('public.users') AS users");
        if (exists.rows[0].users) { console.log('[database] base schema already present — skipping db/schema.sql'); continue; }
      }
      await pool.query(fs.readFileSync(file, 'utf8'));
      console.log(`[database] applied ${path.relative(process.cwd(), file)}`);
    }
    await pool.query("INSERT INTO schema_migrations(version) VALUES ('002-production-core') ON CONFLICT DO NOTHING");
  } finally { await pool.query('SELECT pg_advisory_unlock($1)', [lock]); }
}
if (require.main === module) run().then(() => process.exit(0)).catch(e => { console.error('[database] migration failed:', e); process.exit(1); });
module.exports = { run };
