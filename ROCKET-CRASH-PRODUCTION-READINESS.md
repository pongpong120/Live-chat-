# Rocket Crash — status (updated 2026-10-11)

The earlier "locked" safety gate has been replaced by a working game that uses the live Diamond wallet path (same as Lucky Fruit). See `ROOM-FIX-2026-10-11.md` for what is implemented, what was tested and what was NOT.

Still required before relying on it in production: live-server test with real sockets, multi-instance round coordination if you run more than one Node process, automatic retry/reconciliation for failed production-wallet payouts, and your own legal/business review of real-Diamond betting.
