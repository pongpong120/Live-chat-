-- PingPong production core. Additive/idempotent.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_state (
  state_key TEXT PRIMARY KEY,
  state_value JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  access_token_hash TEXT UNIQUE NOT NULL,
  refresh_token_hash TEXT UNIQUE NOT NULL,
  device_id TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES auth_sessions(session_id)
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS auth_sessions_refresh_idx ON auth_sessions(refresh_token_hash);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  user_id TEXT,
  request_hash TEXT,
  response JSONB,
  status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_keys(expires_at);
CREATE TABLE IF NOT EXISTS wallet_operations (
  operation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('diamonds','beans')),
  delta BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  reason TEXT,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_operations_user_idx ON wallet_operations(user_id, currency, created_at DESC);
CREATE TABLE IF NOT EXISTS recharge_withdrawals (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recharge','withdraw')),
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  payment_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recharge_withdrawals_user_idx ON recharge_withdrawals(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS agencies (
  agency_id TEXT PRIMARY KEY,
  owner_user_id TEXT,
  country_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS host_agency_memberships (
  user_id TEXT PRIMARY KEY,
  agency_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS host_agency_memberships_agency_idx ON host_agency_memberships(agency_id, status);
CREATE TABLE IF NOT EXISTS salary_commissions (
  payout_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agency_id TEXT,
  period_key TEXT,
  kind TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'beans',
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kyc_records (
  kyc_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  country_code TEXT,
  status TEXT NOT NULL,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  review JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS audit_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events(target_type, target_id, created_at DESC);
CREATE TABLE IF NOT EXISTS upload_assets (
  asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id TEXT,
  category TEXT NOT NULL,
  object_key TEXT UNIQUE NOT NULL,
  original_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  storage_provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS upload_assets_owner_idx ON upload_assets(owner_user_id, category, created_at DESC);
CREATE TABLE IF NOT EXISTS room_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL,
  user_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_events_room_idx ON room_events(room_id, created_at DESC);
