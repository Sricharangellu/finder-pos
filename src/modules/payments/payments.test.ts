import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type App } from "../../app.js";

// Per-test schema isolation against the shared Postgres instance.
let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
import type { DomainEvent } from "../../shared/types.js";

interface SeedOpts {
  id: string;
  totalCents: number;
  status?: string;
}

async function seedOrder(app: App, opts: SeedOpts): Promise<void> {
  const now = Date.now();
  await app.db.query(
    `INSERT INTO orders
       (id, tenant_id, order_number, state_code, status, subtotal_cents,
        discount_cents, tax_cents, total_cents, customer_id, created_at, updated_at)
     VALUES (?, 'tnt_demo', ?, 'CA', ?, ?, 0, 0, ?, NULL, ?, ?)`,
    [opts.id, `ON-${opts.id}`, opts.status ?? "open", opts.totalCents, opts.totalCents, now, now],
  );
}

/** Inject a POST /api/payments/ capture via the service path (HTTP-free). */
function capture(app: App, body: unknown) {
  // Exercise the real service through the registered route handler by calling
  // the module service indirectly is awkward; instead use a lightweight
  // in-process request against the express app.
  return request(app, "POST", "/api/payments/", body);
}

interface HttpResult {
  status: number;
  body: any;
}

function request(
  app: App,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    Promise.all([import("node:http"), import("jsonwebtoken")]).then(([{ default: http }, { default: jwt }]) => {
      const token = jwt.sign(
        { sub: "usr_demo_owner", tenantId: "tnt_demo", role: "owner" },
        process.env.JWT_SECRET ?? "test-secret-finder-pos",
        { expiresIn: "1h" },
      );
      const reqPath =
        path.startsWith("/api/") && !path.startsWith("/api/v1/") && !path.startsWith("/api/identity/")
          ? path.replace("/api/", "/api/v1/")
          : path;
      const server = app.express.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            method,
            path: reqPath,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              ...(data ? { "content-length": Buffer.byteLength(data) } : {}),
            },
          },
          (res) => {
            let raw = "";
            res.on("data", (c) => (raw += c));
            res.on("end", () => {
              server.close();
              resolve({
                status: res.statusCode ?? 0,
                body: raw ? JSON.parse(raw) : undefined,
              });
            });
          },
        );
        req.on("error", (e) => {
          server.close();
          reject(e);
        });
        if (data) req.write(data);
        req.end();
      });
    });
  });
}

test("exact cash payment captures with no change", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_exact", totalCents: 1000 });

  const res = await capture(app, {
    orderId: "ord_exact",
    method: "cash",
    tenderedCents: 1000,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.method, "cash");
  assert.equal(res.body.amount_cents, 1000);
  assert.equal(res.body.cash_cents, 1000);
  assert.equal(res.body.change_cents, 0);
  assert.equal(res.body.status, "captured");
  assert.match(res.body.id, /^pay_/);
});

test("cash payment with change computes change correctly", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_change", totalCents: 1000 });

  const res = await capture(app, {
    orderId: "ord_change",
    method: "cash",
    tenderedCents: 1500,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.change_cents, 500);
  assert.equal(res.body.cash_cents, 1500);
  assert.equal(res.body.amount_cents, 1000);
});

test("insufficient cash is rejected with 400", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_short", totalCents: 1000 });

  const res = await capture(app, {
    orderId: "ord_short",
    method: "cash",
    tenderedCents: 500,
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
});

test("card payment captures with auth code and last4", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_card", totalCents: 2599 });

  const res = await capture(app, {
    orderId: "ord_card",
    method: "card",
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.method, "card");
  assert.equal(res.body.card_cents, 2599);
  assert.equal(res.body.amount_cents, 2599);
  assert.equal(res.body.change_cents, 0);
  assert.equal(res.body.status, "captured");
  assert.ok(res.body.auth_code, "auth_code present");
  assert.match(res.body.auth_code, /^EMV-/);
  assert.match(res.body.card_last4, /^\d{4}$/);
});

test("split tender splits cash + card and applies change to cash overage", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_split", totalCents: 3000 });

  const res = await capture(app, {
    orderId: "ord_split",
    method: "split",
    cashCents: 1200,
    cardCents: 2000,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.method, "split");
  assert.equal(res.body.cash_cents, 1200);
  assert.equal(res.body.card_cents, 2000);
  assert.equal(res.body.change_cents, 200); // 3200 tendered - 3000 owed
  assert.equal(res.body.amount_cents, 3000);
  assert.ok(res.body.auth_code, "card portion has auth code");
});

test("split tender below owed is rejected", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_split_short", totalCents: 3000 });

  const res = await capture(app, {
    orderId: "ord_split_short",
    method: "split",
    cashCents: 500,
    cardCents: 1000,
  });

  assert.equal(res.status, 400);
});

test("split tender that overcharges the card is rejected (change is cash-only)", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_split_overcard", totalCents: 5000 });

  // Card alone exceeds owed. Capturing this would report $10 cash change that
  // was never tendered, so it must be rejected.
  const res = await capture(app, {
    orderId: "ord_split_overcard",
    method: "split",
    cashCents: 0,
    cardCents: 6000,
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
});

test("split tender with card at exactly owed and overage from cash captures", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_split_cashover", totalCents: 5000 });

  // Card == owed, plus extra cash. Change must equal the cash overage only.
  const res = await capture(app, {
    orderId: "ord_split_cashover",
    method: "split",
    cashCents: 1000,
    cardCents: 5000,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.cash_cents, 1000);
  assert.equal(res.body.card_cents, 5000);
  assert.equal(res.body.change_cents, 1000); // overage drawn from cash
  assert.ok(res.body.change_cents <= res.body.cash_cents);
});

test("unknown order returns 404", async () => {
  const app = await buildApp({ schema: __schema() });

  const res = await capture(app, {
    orderId: "ord_nope",
    method: "cash",
    tenderedCents: 1000,
  });

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "not_found");
});

test("already completed order returns 409 conflict", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_done", totalCents: 1000, status: "completed" });

  const res = await capture(app, {
    orderId: "ord_done",
    method: "cash",
    tenderedCents: 1000,
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "conflict");
});

test("payment.captured event fires on successful capture", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_evt", totalCents: 1000 });

  const received: DomainEvent[] = [];
  app.events.on("payment.captured", (e) => { received.push(e); });

  const res = await capture(app, {
    orderId: "ord_evt",
    method: "cash",
    tenderedCents: 1200,
  });

  assert.equal(res.status, 201);
  assert.equal(received.length, 1);
  const payload = received[0].payload as {
    id: string;
    orderId: string;
    method: string;
    amountCents: number;
    changeCents: number;
  };
  assert.equal(payload.orderId, "ord_evt");
  assert.equal(payload.method, "cash");
  assert.equal(payload.amountCents, 1000);
  assert.equal(payload.changeCents, 200);
  assert.equal(payload.id, res.body.id);
});

test("GET /:id fetches a payment, 404 when missing", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_get", totalCents: 1000 });

  const created = await capture(app, {
    orderId: "ord_get",
    method: "cash",
    tenderedCents: 1000,
  });
  const id = created.body.id as string;

  const found = await request(app, "GET", `/api/payments/${id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.id, id);

  const missing = await request(app, "GET", "/api/payments/pay_missing");
  assert.equal(missing.status, 404);
});

test("GET /?orderId= lists payments for an order", async () => {
  const app = await buildApp({ schema: __schema() });
  // Two distinct orders, each paid once. (A captured payment completes its
  // order via the payment.captured -> order.markCompleted flow, so the same
  // order cannot be fully paid twice — see the 409 test above.)
  await seedOrder(app, { id: "ord_list_a", totalCents: 500 });
  await seedOrder(app, { id: "ord_list_b", totalCents: 700 });

  await capture(app, { orderId: "ord_list_a", method: "cash", tenderedCents: 500 });
  await capture(app, { orderId: "ord_list_b", method: "cash", tenderedCents: 700 });

  const listA = await request(app, "GET", "/api/payments/?orderId=ord_list_a");
  assert.equal(listA.status, 200);
  assert.equal(Array.isArray(listA.body), true);
  assert.equal(listA.body.length, 1);
  assert.equal(listA.body[0].order_id, "ord_list_a");

  const listB = await request(app, "GET", "/api/payments/?orderId=ord_list_b");
  assert.equal(listB.body.length, 1);
});

/** Count the payment rows for an order (asserts no duplicate charge). */
async function paymentCount(app: App, orderId: string): Promise<number> {
  const row = await app.db.one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND tenant_id = 'tnt_demo'",
    [orderId],
  );
  return Number(row?.n ?? 0);
}

test("retried capture with same idempotency key returns the cached payment and does NOT re-charge", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_idem", totalCents: 1000 });

  const first = await capture(app, {
    orderId: "ord_idem",
    method: "cash",
    tenderedCents: 1000,
    idempotencyKey: "idem-key-1",
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.status, "captured");
  assert.equal(await paymentCount(app, "ord_idem"), 1);

  // Replay the exact same request (e.g. a network retry). The capture must
  // short-circuit on the idempotency key and return the original record byte
  // for byte — crucially without inserting a second payments row.
  const retry = await capture(app, {
    orderId: "ord_idem",
    method: "cash",
    tenderedCents: 1000,
    idempotencyKey: "idem-key-1",
  });
  assert.equal(retry.status, 201);
  assert.equal(retry.body.id, first.body.id, "retry must return the same payment id");
  assert.deepEqual(retry.body, first.body, "retry must return the identical record");
  assert.equal(await paymentCount(app, "ord_idem"), 1, "no second payment may be created");
});

test("a fresh idempotency key on an already-paid order is not served from cache (409)", async () => {
  const app = await buildApp({ schema: __schema() });
  await seedOrder(app, { id: "ord_idem2", totalCents: 1000 });

  const first = await capture(app, {
    orderId: "ord_idem2",
    method: "cash",
    tenderedCents: 1000,
    idempotencyKey: "idem-A",
  });
  assert.equal(first.status, 201);

  // The first capture completed the order. A DIFFERENT key is a distinct
  // request, so it must miss the cache and hit the closed-order guard rather
  // than silently returning the prior payment.
  const other = await capture(app, {
    orderId: "ord_idem2",
    method: "cash",
    tenderedCents: 1000,
    idempotencyKey: "idem-B",
  });
  assert.equal(other.status, 409);
  assert.equal(await paymentCount(app, "ord_idem2"), 1);
});
