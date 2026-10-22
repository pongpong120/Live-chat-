-- PingPong gateway payments (PhonePe / Cashfree). Additive + idempotent. Does NOT touch users,
-- wallet balances or any existing table. No foreign keys to users: live balances still live in
-- users.json, so user_id here is the app's userId string.
CREATE TABLE IF NOT EXISTS payment_orders (
  order_id             TEXT PRIMARY KEY,                       -- server-generated merchant order id
  user_id              TEXT NOT NULL,
  mobile               TEXT,
  provider             TEXT NOT NULL CHECK (provider IN ('phonepe','cashfree')),
  package_id           TEXT NOT NULL,
  package_name         TEXT NOT NULL,
  amount_paise         BIGINT NOT NULL CHECK (amount_paise > 0),
  currency             TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  diamonds             BIGINT NOT NULL CHECK (diamonds > 0),
  status               TEXT NOT NULL DEFAULT 'CREATED'
                         CHECK (status IN ('CREATED','PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED')),
  credit_state         TEXT NOT NULL DEFAULT 'NONE' CHECK (credit_state IN ('NONE','CREDITING','CREDITED')),
  credit_claimed_at_ms BIGINT,
  credited_at          TIMESTAMPTZ,
  provider_order_id    TEXT,
  provider_txn_id      TEXT,
  redirect_url         TEXT,
  payment_session_id   TEXT,
  expires_at_ms        BIGINT,
  created_at_ms        BIGINT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- credit can only be CREDITED/CREDITING on a SUCCESS order
  CONSTRAINT credit_requires_success CHECK (credit_state = 'NONE' OR status = 'SUCCESS')
);
-- One provider transaction can only ever be attached to one order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_orders_provider_txn
  ON payment_orders (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders (user_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_open ON payment_orders (status, created_at_ms)
  WHERE status IN ('CREATED','PENDING');
CREATE INDEX IF NOT EXISTS idx_payment_orders_uncredited ON payment_orders (credit_state) WHERE status = 'SUCCESS' AND credit_state <> 'CREDITED';

-- Webhook de-duplication: each provider event id is processed once.
CREATE TABLE IF NOT EXISTS payment_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  order_id    TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
INSERT INTO schema_migrations(version) VALUES ('003-payments') ON CONFLICT DO NOTHING;
