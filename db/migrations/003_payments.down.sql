-- ROLLBACK for 003_payments.sql. Run MANUALLY (not part of db:migrate).
-- WARNING: drops payment audit tables. Export first:  \copy payment_orders TO 'payment_orders_backup.csv' CSV HEADER
-- This does NOT touch wallet balances or users. Diamonds already credited stay credited
-- (they live in users.json + paymentCredits.json, which this rollback never modifies).
BEGIN;
DROP TABLE IF EXISTS payment_events;
DROP TABLE IF EXISTS payment_orders;
DELETE FROM schema_migrations WHERE version = '003-payments';
COMMIT;
