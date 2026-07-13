# Ascend — Database Layer

Owner: **DATABASE agent**
Wave: 1 — Core commerce (Wave 0 foundation complete)

---

## Directory layout

```
db/
├── migrations/
│   ├── run.sh                      Migration runner (psql, no npm dependency)
│   ├── 0001_foundation.sql         Wave 0: tenants, users, roles, audit_log,
│   │                                        feature_flags, idempotency_keys
│   ├── 0001_foundation.down.sql    Rollback for 0001
│   ├── 0002_commerce.sql           Wave 1: products, inventory,
│   │                                        inventory_movements, orders,
│   │                                        order_lines, payments, sync_queue
│   ├── 0002_commerce.down.sql      Rollback for 0002
│   └── … (0003_* added Wave 2)
├── rls/
│   └── policies.sql                Row-Level Security policies for every
│                                   tenant-scoped table (Wave 0 + Wave 1)
├── seeds/
│   └── 0001_demo.sql               Demo tenant, owner user, 3 roles, 4 flags
├── backup/
│   ├── backup.sh                   pg_dump wrapper (RPO ≤ 5 min via cron)
│   └── restore.sh                  pg_restore wrapper (RTO ≤ 30 min)
└── pool/                           PgBouncer config (added Wave 2)
```

---

## Running migrations

### Prerequisites

- `psql` on PATH (PostgreSQL client tools).
- `DATABASE_URL` environment variable set:

  ```bash
  export DATABASE_URL=postgresql://app_user:secret@localhost:5432/finder_pos
  ```

### Apply all pending migrations

```bash
./db/migrations/run.sh
# or explicitly:
./db/migrations/run.sh up
```

### Apply a specific migration

```bash
./db/migrations/run.sh up 0001
```

### Roll back a migration

```bash
./db/migrations/run.sh down 0001
```

### Apply RLS policies (run after every migration)

```bash
psql "$DATABASE_URL" -f db/rls/policies.sql
```

### Load demo seed data

```bash
psql "$DATABASE_URL" -f db/seeds/0001_demo.sql
```

### Full local reset (from zero)

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
./db/migrations/run.sh up
psql "$DATABASE_URL" -f db/rls/policies.sql
psql "$DATABASE_URL" -f db/seeds/0001_demo.sql
```

---

## Tenancy & Row-Level Security model

### Tenant-id type convention (reconciled Wave 1, 2026-06-12)

Every business table carries `tenant_id NOT NULL`.

- **Wave 0 tables** (roles, users, audit_log, feature_flags, idempotency_keys):
  `tenant_id UUID` — scaffolded before the live system's TEXT convention was
  confirmed.  Will be reconciled to TEXT in a future fixup migration.
- **Wave 1+ tables** (all commerce tables): `tenant_id TEXT` — matches the
  live backend which uses `tnt_<slug>` ids (e.g. `tnt_demo`).

The backend sets the session variable as TEXT: `SET LOCAL app.tenant_id = 'tnt_demo'`.

### RLS: how tenant isolation actually works today

Tenant isolation is enforced **primarily at the application layer**: handlers
scope every query by the tenant in the verified JWT. PostgreSQL RLS is a
**defense-in-depth backstop**, and it *is* now wired into the backend's
connection path — the gateway enters an `AsyncLocalStorage` tenant scope per
authenticated request and `src/shared/db.ts` runs each query in a transaction
that sets `app.tenant_id` (`src/shared/tenant-context.ts`). Both layers are
proven by `src/gateway/tenant-isolation.test.ts`, kept as a CI regression.

**RLS is permissive when `app.tenant_id` is unset — it is NOT fail-closed.**
The isolation test asserts that a query run with *no* tenant context still
returns rows ("no context → permissive (backwards compatible)"). So RLS does
**not** protect a query that runs without the gateway's per-request context
(background jobs, bootstrap, or any code path that forgets to set it). The real
guarantee is the **gateway setting tenant context on every authenticated
request**; RLS only adds a second line of defense once that context is set — and
only when the application DB role lacks `BYPASSRLS`/superuser.

### How RLS evaluates a query (when context is set)

1. Backend resolves tenant from the verified JWT on every request.
2. Executes `SET LOCAL app.tenant_id = 'tnt_demo'` inside the transaction.
3. Wave 0 policies evaluate:
   ```sql
   USING (tenant_id = current_setting('app.tenant_id')::uuid)
   ```
4. Wave 1+ policies evaluate (TEXT, no cast):
   ```sql
   USING (tenant_id = current_setting('app.tenant_id'))
   ```
5. With `app.tenant_id` unset, the policies the app actually applies on boot are
   permissive (see the isolation test) — do not rely on RLS to fail-closed.

> The fail-closed wording in `db/rls/policies.sql` (one-arg `current_setting`,
> "raises an ERROR when unset") describes the canonical SQL-of-record; the
> policies the running app applies on boot behave permissively-when-unset per the
> test above. Reconciling the two so the applied policies are genuinely
> fail-closed is open hardening work.

### Application role vs. service role

| Role          | BYPASSRLS | Usage                                    |
|---------------|-----------|------------------------------------------|
| `app_user`    | No        | All runtime queries from the backend     |
| `migrator`    | Yes       | Migration runner, `run.sh`               |
| `backup_role` | Yes       | `pg_dump` / `pg_restore`                 |

The `app_user` role **must not** have `BYPASSRLS`.

### Tenant-isolation test (run in CI)

```sql
-- Should return ERROR (not 0 rows) — app.tenant_id unset:
RESET app.tenant_id;
SELECT * FROM products;  -- ERROR: unrecognized configuration parameter

-- Should return 0 rows — wrong tenant:
SET app.tenant_id = 'tnt_other';
SELECT * FROM products;  -- 0 rows

-- Should return rows for the correct tenant only:
SET app.tenant_id = 'tnt_demo';
SELECT count(*) FROM products;  -- n rows for demo tenant
```

### Tenant-leading indexes

Every index on a tenant-scoped table is tenant-leading, e.g.:

```sql
CREATE INDEX products_tenant_sku_idx ON products (tenant_id, sku);
```

This ensures index scans are bounded to one tenant's data, critical for
query performance at scale (Wave 2 partitioning uses the same key).

---

## ID conventions

| Table                  | Prefix  | Example                              |
|------------------------|---------|--------------------------------------|
| tenants                | `tnt_`  | `tnt_01j0abc...`                     |
| users                  | `usr_`  | `usr_01j0abc...`                     |
| roles                  | `role_` | `role_01j0abc...`                    |
| audit_log              | `aud_`  | `aud_01j0abc...`                     |
| feature_flags          | `ff_`   | `ff_01j0abc...`                      |
| idempotency_keys       | `idk_`  | `idk_01j0abc...`                     |
| products               | `prod_` | `prod_01j0abc...`                    |
| inventory_movements    | `ivm_`  | `ivm_01j0abc...`                     |
| orders                 | `ord_`  | `ord_01j0abc...`                     |
| order_lines            | `oln_`  | `oln_01j0abc...`                     |
| payments               | `pay_`  | `pay_01j0abc...`                     |
| sync_queue             | —       | BIGSERIAL integer (sequence order)   |

Note: `inventory` uses a composite PK `(tenant_id, product_id)` — no surrogate id.

IDs are UUID v7 encoded as TEXT with the prefix. UUID v7 is time-ordered,
which means B-tree inserts are sequential (no page splits at scale).

---

## Money and time

- All money columns: `BIGINT` (cents). Never floats.
- All timestamps: `BIGINT` (Unix epoch milliseconds). `Date.now()` in TypeScript.

---

## Backup & Disaster Recovery

> **Status:** the RPO/RTO targets and drill steps below are the **designed** plan.
> Automated backup/restore **drills are not yet verified** — `WORK/FORWARD_PLAN.md`
> Phase 4 lists backup/restore, monitoring/alerting, and production Redis as open
> operational work. Treat this as the target runbook, not proof of a tested DR
> capability.

### RPO ≤ 5 minutes

Achieved via continuous WAL archiving (WAL-G or pgBackRest, configured in
Wave 2) plus `pg_dump` every 15 minutes via cron.

```cron
# WAL archive every 5 minutes (plug WAL-G endpoint in backup.sh)
*/5  * * * *  /opt/finder-pos/db/backup/backup.sh --wal-archive

# Full logical backup every 15 minutes
*/15 * * * *  /opt/finder-pos/db/backup/backup.sh --full
```

### RTO ≤ 30 minutes

`restore.sh` uses `pg_restore --jobs=4` (parallel restore) to minimize
wall-clock recovery time. On a 4-core machine with a typical Year-1 dataset
(< 50 GB), restore completes well under 30 minutes.

### DR Drill (run quarterly)

1. Provision a restore-test database.
2. Run `./db/backup/restore.sh --latest` against it.
3. Run `./db/migrations/run.sh up` to apply any post-backup migrations.
4. Run `npm run smoke -- --env restore-test` to verify application health.
5. Record start time, backup timestamp, elapsed time in the DR log.
6. RTO must be ≤ 30 minutes. Investigate and remediate if exceeded.

### Backup retention

| Storage tier | Retention  | Tool                     |
|--------------|------------|--------------------------|
| Local disk   | 7 days     | `backup.sh` auto-purge   |
| S3 (Standard-IA) | 30 days | `aws s3 cp` in `backup.sh` |
| S3 (Glacier) | 1 year     | S3 lifecycle rule        |

### Backup verification

```bash
./db/backup/backup.sh --verify
```

Runs `pg_restore --list` against the latest local backup to confirm the file
is readable and not corrupt. Run daily in CI.

---

## Wave 1 — Core commerce (complete)

Migration files:
```
db/migrations/0002_commerce.sql       forward migration
db/migrations/0002_commerce.down.sql  rollback
```

Tables created: `products`, `inventory`, `inventory_movements`, `orders`,
`order_lines`, `payments`, `sync_queue` — all with `tenant_id TEXT NOT NULL`,
RLS enabled, and tenant-leading indexes.

RLS policies appended to `db/rls/policies.sql` — TEXT comparison, no `::uuid` cast.

---

## Wave 2 — Hardening (upcoming)

- PgBouncer transaction-mode pooling config in `db/pool/pgbouncer.ini`.
- Read-replica routing guidance.
- Range/hash partitioning by `tenant_id` — no app changes required.
- Redis key conventions: `t:{tenant_uuid}:product:{id}`, TTL notes.
- Automated restore drill with recorded RPO/RTO actuals.
