/**
 * webhook.test.ts — Stripe webhook signature verification.
 *
 * RULES.md names "Stripe/webhook behavior must be verified before production"
 * as a pre-production gate, but `/api/stripe/webhook` (app.ts) had zero
 * coverage. These tests exercise the endpoint's security contract using
 * Stripe's own `generateTestHeaderString` — pure local HMAC, no network:
 *
 *   • a validly-signed payload → 200 and the event is published internally
 *   • a missing / bad signature → 400 (never processed)
 *   • STRIPE_WEBHOOK_SECRET unset → 503 (endpoint disabled, fail closed)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import Stripe from "stripe";
import { buildApp, type App } from "../../app.js";

// Must be set BEFORE buildApp so getStripe() constructs with a usable key.
// A fake sk_test_ key is fine — constructEvent only does offline HMAC.
process.env["STRIPE_SECRET_KEY"] = "sk_test_local_hmac_only";
process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_test_secret";
process.env["JWT_SECRET"] = "test-jwt-secret-webhook";

const WEBHOOK_SECRET = process.env["STRIPE_WEBHOOK_SECRET"] as string;
const stripe = new Stripe(process.env["STRIPE_SECRET_KEY"] as string, { apiVersion: "2026-05-27.dahlia" });

let __seq = 0;
const __schema = () => `wh_test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;

async function freshApp(): Promise<App> {
  return buildApp({ schema: __schema() });
}

/**
 * Post the EXACT raw bytes (Stripe signatures are byte-exact — the generic
 * JSON test client would re-serialize and break the signature). Headers are
 * optional so we can also exercise the missing-signature path.
 */
function rawPost(
  app: App,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        server.close();
        reject(new Error("failed to bind test server"));
        return;
      }
      const req = http.request(
        {
          host: "127.0.0.1",
          port: addr.port,
          method: "POST",
          path: "/api/stripe/webhook",
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            server.close();
            let json: any;
            try { json = data ? JSON.parse(data) : undefined; } catch { json = data; }
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      req.on("error", (err) => { server.close(); reject(err); });
      req.write(body);
      req.end();
    });
  });
}

/** A minimal but structurally-valid Stripe event; constructEvent parses it verbatim. */
function eventPayload(): string {
  return JSON.stringify({
    id: "evt_test_1",
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_test_1", object: "payment_intent", amount: 1000 } },
  });
}

test("a validly-signed webhook is accepted and published internally", async () => {
  const app = await freshApp();
  const payload = eventPayload();
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

  // Prove the verified event reaches the internal bus (the handler publishes
  // `stripe.<type>` fire-and-forget after a 200).
  const published = new Promise<unknown>((resolve) => {
    app.events.on("stripe.payment_intent.succeeded", (e) => resolve(e));
  });

  const res = await rawPost(app, payload, { "stripe-signature": sig });
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.json)}`);
  assert.equal(res.json.received, true, "handler acknowledges receipt");

  // Subscribers receive a DomainEvent wrapper: { type, payload, ... }.
  const event = (await Promise.race([
    published,
    new Promise((_r, reject) => setTimeout(() => reject(new Error("event was not published")), 2000)),
  ])) as { payload: { id: string } };
  assert.equal(event.payload.id, "pi_test_1", "the verified payment_intent object was forwarded");
});

test("a payload with a bad signature is rejected (400) and never processed", async () => {
  const app = await freshApp();
  const payload = eventPayload();
  // Sign a DIFFERENT payload — the signature will not match what we send.
  const wrongSig = stripe.webhooks.generateTestHeaderString({
    payload: JSON.stringify({ tampered: true }),
    secret: WEBHOOK_SECRET,
  });

  const res = await rawPost(app, payload, { "stripe-signature": wrongSig });
  assert.equal(res.status, 400, "signature mismatch is rejected");
});

test("a webhook with no signature header is rejected (400)", async () => {
  const app = await freshApp();
  const res = await rawPost(app, eventPayload(), {});
  assert.equal(res.status, 400, "missing Stripe-Signature is rejected");
});

test("the webhook is disabled (503) when STRIPE_WEBHOOK_SECRET is unset", async () => {
  const app = await freshApp();
  const payload = eventPayload();
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

  const saved = process.env["STRIPE_WEBHOOK_SECRET"];
  delete process.env["STRIPE_WEBHOOK_SECRET"]; // handler reads this per-request
  try {
    const res = await rawPost(app, payload, { "stripe-signature": sig });
    assert.equal(res.status, 503, "no webhook secret → endpoint disabled, fail closed");
  } finally {
    process.env["STRIPE_WEBHOOK_SECRET"] = saved;
  }
});
