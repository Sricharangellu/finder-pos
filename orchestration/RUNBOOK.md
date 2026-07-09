# Ascend Operations Runbook

Production URLs: https://finder-pos-backend.vercel.app · https://finder-pos-frontend.vercel.app
Health endpoints: `/healthz` (liveness) · `/readyz` (readiness + pool stats) · `/metrics` (Prometheus, bearer-gated)

---

## SLOs

| Signal | Target | Alert threshold |
|--------|--------|----------------|
| Availability | 99.5% / month | < 99% in any 1-hour window |
| p99 checkout latency | < 500 ms | > 1 s for 5 consecutive minutes |
| p99 API latency (non-checkout) | < 2 s | > 5 s for 5 consecutive minutes |
| Error rate | < 0.5% | > 2% for 3 consecutive minutes |
| RTO | 1 hour | — |
| RPO | 5 minutes | — |

---

## Incident 1 — Database Connection Pool Exhausted

**Symptoms:** `/readyz` returns 503 `{"status":"degraded","reason":"connection pool exhausted"}`, API requests timing out, Vercel function logs show `Error: timeout exceeded when trying to connect`.

**Immediate actions:**

1. Check pool stats:
   ```bash
   curl -s https://finder-pos-backend.vercel.app/readyz | jq .pool
   # { total, idle, waiting }
   ```

2. If `waiting > 0` and `idle = 0`, the pool is saturated. Identify which function instance is holding connections:
   ```sql
   SELECT pid, state, wait_event_type, wait_event, query_start, left(query, 100) as q
   FROM pg_stat_activity
   WHERE datname = current_database() AND state != 'idle'
   ORDER BY query_start ASC;
   ```

3. Kill stuck transactions (> 30 s old — longer than `PG_TX_TIMEOUT_MS`):
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = current_database()
     AND state = 'idle in transaction'
     AND now() - query_start > interval '30 seconds';
   ```

4. If pool saturation persists, scale down instances temporarily via Vercel dashboard → Deployments → Functions → reduce concurrency.

5. **Root cause:** ensure `DATABASE_URL` points to the pooler endpoint (Neon pooled / Railway proxy), not direct Postgres. Direct connections bypass PgBouncer and exhaust `max_connections` quickly under serverless concurrency.

**Prevention:** `PG_POOL_MAX` = `floor(plan_max_connections / max_instances) - 2`. Use connection pooler.

---

## Incident 2 — Rate Limiting False Positives (CDN Proxy)

**Symptoms:** Legitimate customers getting 429 responses. Admin dashboard shows spike in 429 rate. `/api/identity/login` rate limit triggered for large offices.

**Diagnosis:**

1. Check response header: `X-Request-Id` — rate limit key is the extracted client IP.
2. Check `TRUST_PROXY_DEPTH` in env. If behind Cloudflare + Vercel, set to `2`.
3. Verify with: `curl -H "X-Forwarded-For: 1.2.3.4, 5.6.7.8" https://finder-pos-backend.vercel.app/healthz -v | grep x-request-id`

**Fix:**

```bash
# In Vercel environment variables:
TRUST_PROXY_DEPTH=2   # for Cloudflare → Vercel (2 proxy hops)
TRUST_PROXY_DEPTH=1   # for Vercel only (1 hop, default)
```

Re-deploy after changing env var.

**Prevention:** Always set `TRUST_PROXY_DEPTH` to match your actual proxy topology before go-live.

---

## Incident 3 — Stripe Webhook Delivery Failing

**Symptoms:** Payment confirmations not arriving, orders stuck in `pending` status after card charge succeeds in Stripe Dashboard.

**Diagnosis:**

1. Check Stripe Dashboard → Webhooks → your endpoint → Recent deliveries. Look for failures.
2. Verify `STRIPE_WEBHOOK_SECRET` is set in Vercel environment variables.
3. Test signature verification manually:
   ```bash
   curl -X POST https://finder-pos-backend.vercel.app/api/stripe/webhook \
     -H "stripe-signature: t=..." \
     -d '{"type":"payment_intent.succeeded",...}'
   ```
4. Check server logs for `[stripe-webhook]` entries.

**Fix — secret mismatch:** Rotate webhook secret in Stripe Dashboard → copy new secret → update `STRIPE_WEBHOOK_SECRET` in Vercel → redeploy.

**Fix — endpoint unreachable:** Check `/healthz` — if backend is down, Stripe will retry for 72 hours with exponential backoff. No action needed until backend is restored.

**Fix — replay missed events:** In Stripe Dashboard → Webhooks → your endpoint → Recent deliveries → filter by failed → click "Resend" for each missed event after backend is healthy.

**Prevention:** Always test webhook delivery in Stripe's test mode before go-live.

---

## Incident 4 — Payment Idempotency Key Collision

**Symptoms:** `409 Conflict` on payment capture with message `idempotency key '...' was already used with a different request`.

**Cause:** Client retried a payment with the same idempotency key but different parameters (different order, amount, or method). This is a client-side bug — the key must be unique per logical operation.

**Resolution:**

1. Find the original payment:
   ```sql
   SELECT k.key, k.response, k.created_at, k.expires_at
   FROM idempotency_keys k
   WHERE k.tenant_id = '<tenant_id>'
     AND k.key = '<idempotency_key>';
   ```

2. Identify if the original succeeded. If yes, the second request was a client duplicate — inform the client to use a new key.

3. If the original failed but the key is still in the table (edge case): the key expires after 24 hours. The client can retry after expiry, or an operator can delete the key:
   ```sql
   DELETE FROM idempotency_keys WHERE key = '<key>' AND tenant_id = '<tenant_id>';
   ```
   **Only do this after confirming no charge was made for the original key.**

**Prevention:** Idempotency keys must be generated client-side per transaction initiation, not per retry. Use `crypto.randomUUID()` on transaction start, persist it, reuse it on retries.

---

## Incident 5 — Database Migration Failed on Cold Start

**Symptoms:** Backend cold start logs show `ERROR: relation "schema_migrations" does not exist` or a migration error. API returns 500 on all requests.

**Diagnosis:**

1. Check Vercel function logs for the cold-start error.
2. The migration runner uses an advisory lock (`pg_advisory_xact_lock`) to prevent concurrent runs. If one instance panicked mid-migration, the lock may not have released cleanly.

**Fix — lock stuck:**
```sql
-- Find the lock
SELECT pid, pg_blocking_pids(pid) as blocked_by, query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;

-- Terminate the blocking backend
SELECT pg_terminate_backend(<blocking_pid>);
```

**Fix — migration failed partway through:**
```sql
-- Check which migrations ran
SELECT name, ran_at FROM schema_migrations ORDER BY ran_at DESC LIMIT 10;

-- Identify the failing migration in the logs, fix the SQL, then either:
-- a) Delete the partial hash so it re-runs on next cold start:
DELETE FROM schema_migrations WHERE name = '<failed_migration_name>';
-- b) Or apply the fix manually and mark it done:
INSERT INTO schema_migrations (hash, name, ran_at)
VALUES ('<sha256_of_corrected_sql>', '<name>', extract(epoch from now())*1000);
```

**Prevention:** All migrations must use `IF NOT EXISTS` / `IF EXISTS` guards. Test migrations against a clean schema in CI before merging.

---

## Escalation Path

| Severity | Response time | Who |
|----------|--------------|-----|
| P0 — all checkout down | 15 min | On-call engineer |
| P1 — payment failures | 30 min | On-call engineer |
| P2 — degraded (high latency / partial outage) | 2 hours | Engineering team |
| P3 — non-critical feature broken | Next business day | Engineering team |

Alert channels: Slack `#incidents` → PagerDuty rotation.

---

## Useful Queries

```sql
-- Active connections per state
SELECT state, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state;

-- Slow queries (> 5 s)
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE datname = current_database() AND state = 'active' AND now() - query_start > interval '5 seconds'
ORDER BY duration DESC;

-- Table sizes
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) as size
FROM pg_class WHERE relkind = 'r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 20;

-- Recent errors in audit_log
SELECT actor_id, action, entity_type, entity_id, occurred_at
FROM audit_log ORDER BY occurred_at DESC LIMIT 50;
```
