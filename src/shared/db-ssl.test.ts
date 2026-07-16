/**
 * db-ssl.test.ts — sslConfig matrix (standing critical C-3)
 *
 * Pins the TLS policy for the Postgres pool: verification ON by default
 * whenever TLS is on, custom CA support, and the explicit PG_SSL_NO_VERIFY
 * escape hatch. Pure-function tests — no database needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sslConfig } from "./db.js";

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as NodeJS.ProcessEnv;

test("production default: TLS on with certificate verification", () => {
  const cfg = sslConfig(env({ NODE_ENV: "production" }));
  assert.deepEqual(cfg, { rejectUnauthorized: true });
});

test("non-production default: no TLS", () => {
  assert.equal(sslConfig(env({ NODE_ENV: "test" })), undefined);
  assert.equal(sslConfig(env({})), undefined);
});

test("PG_SSL=1 outside production: TLS on, verified", () => {
  const cfg = sslConfig(env({ PG_SSL: "1" }));
  assert.deepEqual(cfg, { rejectUnauthorized: true });
});

test("PG_SSL=false disables TLS even in production", () => {
  assert.equal(sslConfig(env({ NODE_ENV: "production", PG_SSL: "false" })), undefined);
});

test("PG_SSL_NO_VERIFY=1 restores unverified TLS (escape hatch)", () => {
  const cfg = sslConfig(env({ NODE_ENV: "production", PG_SSL_NO_VERIFY: "1" }));
  assert.deepEqual(cfg, { rejectUnauthorized: false });
});

test("PG_CA_CERT supplies a custom CA with verification on", () => {
  const cfg = sslConfig(env({ NODE_ENV: "production", PG_CA_CERT: "-----BEGIN CERTIFICATE-----abc" }));
  assert.deepEqual(cfg, { rejectUnauthorized: true, ca: "-----BEGIN CERTIFICATE-----abc" });
});

test("PG_CA_CERT_B64 decodes the CA from base64", () => {
  const pem = "-----BEGIN CERTIFICATE-----xyz";
  const cfg = sslConfig(env({ PG_SSL: "true", PG_CA_CERT_B64: Buffer.from(pem).toString("base64") }));
  assert.deepEqual(cfg, { rejectUnauthorized: true, ca: pem });
});
