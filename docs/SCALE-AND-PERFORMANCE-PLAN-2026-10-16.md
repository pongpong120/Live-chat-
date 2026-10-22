# PingPong scale and performance plan — 2026-10-16

## What this update changes

- Aligns the production Docker image with the repository's Node.js 22 engine (`.nvmrc` and `package.json`). The previous Dockerfile used Node 20.
- Adds `npm run load:smoke`, a safe, read-only HTTP smoke/load test for a local or staging instance. It reports throughput and p50/p95/p99 latency without creating users or changing balances.
- This is a performance baseline update, not a claim that the current application can serve millions of concurrent users. That capacity cannot be certified from source alone; it requires infrastructure, production-like data, and staged load tests.

## Important current architectural limit

The current application still has legacy runtime state held in process memory and JSON files. `perf/writeQueue.js` debounces writes, but it still serializes and writes whole JSON documents and makes synchronous filesystem calls (including a backup copy). `perf/dbPersistence.js` mirrors whole JSON files to PostgreSQL as a durability backstop; it does not turn every existing JSON-backed feature into a normalized, transactional database-backed feature. This design is not a safe horizontal-scaling foundation for millions of users, especially for wallets, gifts, presence, rooms, and games.

Do not enable multiple application instances and assume the Redis Socket.IO adapter alone makes all state consistent. The adapter distributes socket events; it does not make process-local users, rooms, balances, sessions, or game rounds shared/transactional. Socket.IO polling deployments also need correct load-balancer affinity, or a deliberate WebSocket-only configuration tested against clients.

## Recommended deployment order

1. **Deploy one staging instance first.** Set `NODE_ENV=production`, a strong owner/admin secret, `DATABASE_URL`, and `REDIS_URL`; configure Firebase/payment/voice secrets only in Railway variables, never commit them. Run `npm run preflight`, `npm test`, and `npm run load:smoke` against staging.
2. **Make PostgreSQL authoritative.** Migrate users, wallet/coin/diamond ledgers, gifts, recharge orders, payment webhooks, room metadata, and game rounds from JSON to normalized tables. Use transactions, unique idempotency keys, indexes, and bounded connection pooling. Never use cached balances as the accounting source of truth.
3. **Use Redis for ephemeral shared state.** Presence, short-lived caches, rate-limit counters, room coordination, and pub/sub belong in Redis with TTLs and outage behavior. Keep durable transactions in PostgreSQL.
4. **Remove blocking persistence from request paths.** Replace whole-file synchronous writes and per-mutation full-document serialization with asynchronous, bounded database operations/queues. Use a durable queue/outbox for background jobs; never fire-and-forget a wallet or payment write.
5. **Scale real-time separately.** Verify Socket.IO Redis adapter, load-balancer affinity/WebSocket support, cross-instance room ownership, game state authority, and recovery behavior. For multi-party voice, configure and load-test an SFU (for example LiveKit); mesh voice grows peer connections rapidly with room size.
6. **Add capacity testing and observability.** Measure API latency percentiles, event-loop delay, CPU/memory, DB pool wait/query time, Redis latency, socket counts, reconnect rate, and game/gift transaction throughput. Ramp load gradually in staging; include failure tests for Redis/DB reconnects and duplicate payment/webhook deliveries.

## Read-only HTTP smoke test

Start the server locally or use a staging URL you control, then run:

```sh
LOAD_TEST_URL=http://127.0.0.1:3000 LOAD_TEST_PATH=/api/health LOAD_TEST_REQUESTS=300 LOAD_TEST_CONCURRENCY=25 npm run load:smoke
```

Use only local/staging environments unless you have explicit approval for production testing. Increase request count/concurrency gradually. This test measures one HTTP route only; it does not certify a million concurrent users, websocket fan-out, payment safety, or voice quality.

## Scale acceptance gates before multi-instance production

- No production-critical writes depend on local JSON files or process memory.
- Wallet, recharge, gift, and game transactions are atomic, idempotent, and auditable in PostgreSQL.
- Shared state and Socket.IO events behave correctly across at least two app instances.
- Load test covers realistic API mix and WebSocket room/gift traffic with production-like data.
- p95/p99 latency, error rate, event-loop delay, and DB pool utilization meet agreed SLOs at the target load.
- Backups and restore are tested; secrets and payment webhooks are verified; rollback is rehearsed.
