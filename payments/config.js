'use strict';
// Payment configuration + startup validation. Secrets come ONLY from env vars.
// Nothing here ever logs a secret value.

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

function readConfig(env = process.env) {
  const cfg = {
    // Master switch for AUTOMATIC gateway payments. Default OFF: the existing
    // manual UPI/UTR + admin-approval flow keeps working untouched.
    autoEnabled: truthy(env.PAYMENTS_AUTO_ENABLED),
    // Which provider new orders use when auto payments are on: phonepe | cashfree
    activeProvider: String(env.PAYMENT_PROVIDER || 'phonepe').toLowerCase(),
    publicBaseUrl: String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
    // Wallet currently lives in single-process JSON storage (users.json).
    // Operator must acknowledge that automatic crediting is only safe on ONE instance.
    singleInstanceAck: truthy(env.PAYMENTS_SINGLE_INSTANCE_ACK),
    orderTtlSeconds: Math.min(3600, Math.max(300, parseInt(env.PAYMENT_ORDER_TTL_SECONDS, 10) || 900)),
    phonepe: {
      enabled: truthy(env.PHONEPE_ENABLED),
      environment: String(env.PHONEPE_ENVIRONMENT || 'sandbox').toLowerCase(),
      clientId: env.PHONEPE_CLIENT_ID || '',
      clientVersion: env.PHONEPE_CLIENT_VERSION || '',
      clientSecret: env.PHONEPE_CLIENT_SECRET || '',
      webhookUsername: env.PHONEPE_WEBHOOK_USERNAME || '',
      webhookPassword: env.PHONEPE_WEBHOOK_PASSWORD || ''
    },
    cashfree: {
      enabled: truthy(env.CASHFREE_ENABLED),            // default false
      environment: String(env.CASHFREE_ENVIRONMENT || 'sandbox').toLowerCase(),
      clientId: env.CASHFREE_CLIENT_ID || '',
      clientSecret: env.CASHFREE_CLIENT_SECRET || '',
      apiVersion: env.CASHFREE_API_VERSION || '2025-01-01',
      // Cashfree signs webhooks with the same PG secret key (no separate secret exists).
      // CASHFREE_WEBHOOK_SECRET is an optional override; defaults to CASHFREE_CLIENT_SECRET.
      webhookSecret: env.CASHFREE_WEBHOOK_SECRET || env.CASHFREE_CLIENT_SECRET || ''
    }
  };
  return cfg;
}

// Returns { ok, errors[], warnings[] } — never throws, never includes secret values.
function validateConfig(cfg, { production = false } = {}) {
  const errors = []; const warnings = [];
  if (!cfg.autoEnabled) return { ok: true, errors, warnings: ['Automatic gateway payments are OFF (PAYMENTS_AUTO_ENABLED not set); manual UPI flow only.'] };
  if (!['phonepe', 'cashfree'].includes(cfg.activeProvider)) errors.push('PAYMENT_PROVIDER must be "phonepe" or "cashfree".');
  if (!cfg.publicBaseUrl) errors.push('PUBLIC_BASE_URL is required (public https URL used for redirect/webhook).');
  else if (production && !/^https:\/\//i.test(cfg.publicBaseUrl)) errors.push('PUBLIC_BASE_URL must be https in production.');
  if (!cfg.singleInstanceAck) errors.push('PAYMENTS_SINGLE_INSTANCE_ACK=true is required: wallet balances are in single-process JSON storage, so run exactly one instance (see docs/PAYMENTS_GATEWAY.md).');
  if (production && !process.env.DATABASE_URL) errors.push('DATABASE_URL is required in production: payment orders need Postgres unique constraints for exactly-once crediting.');
  const p = cfg.activeProvider;
  if (p === 'phonepe') {
    if (!cfg.phonepe.enabled) errors.push('PHONEPE_ENABLED=true is required when PAYMENT_PROVIDER=phonepe.');
    for (const k of ['clientId', 'clientVersion', 'clientSecret', 'webhookUsername', 'webhookPassword']) if (!cfg.phonepe[k]) errors.push(`PhonePe ${k} env var is missing.`);
    if (production && cfg.phonepe.environment !== 'production') warnings.push('PhonePe environment is not "production" while NODE_ENV=production.');
  }
  if (p === 'cashfree') {
    if (!cfg.cashfree.enabled) errors.push('CASHFREE_ENABLED=true is required when PAYMENT_PROVIDER=cashfree.');
    for (const k of ['clientId', 'clientSecret']) if (!cfg.cashfree[k]) errors.push(`Cashfree ${k} env var is missing.`);
    if (production && cfg.cashfree.environment !== 'production') warnings.push('Cashfree environment is not "production" while NODE_ENV=production.');
  }
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { readConfig, validateConfig, truthy };
