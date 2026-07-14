import { test } from "node:test";
import assert from "node:assert/strict";
import { sslConfig } from "./db.js";

/**
 * C-3 — verified database TLS. Pure env-driven unit tests for sslConfig():
 * pinning PG_CA_CERT must enable certificate verification, explicit PG_SSL=off
 * must win, and the legacy unverified fallback must remain unchanged for
 * environments that have not pinned a CA yet.
 */

const ENV_KEYS = ["PG_SSL", "PG_CA_CERT", "NODE_ENV"] as const;

function withEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void): void {
  const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const PEM = "-----BEGIN CERTIFICATE-----\nMIIFakeCertForTests\n-----END CERTIFICATE-----";

test("sslConfig: PG_CA_CERT enables VERIFIED TLS (rejectUnauthorized true, CA pinned)", () => {
  withEnv({ PG_CA_CERT: PEM }, () => {
    const cfg = sslConfig();
    assert.ok(cfg, "TLS must be enabled when a CA is pinned");
    assert.equal(cfg.rejectUnauthorized, true);
    assert.equal(cfg.ca, PEM);
  });
});

test("sslConfig: literal \\n sequences in PG_CA_CERT are restored to newlines", () => {
  withEnv({ PG_CA_CERT: PEM.replace(/\n/g, "\\n") }, () => {
    const cfg = sslConfig();
    assert.equal(cfg?.ca, PEM, "flattened env PEM must parse back to real newlines");
    assert.equal(cfg?.rejectUnauthorized, true);
  });
});

test("sslConfig: explicit PG_SSL=false wins even with a CA set (local no-SSL Postgres)", () => {
  withEnv({ PG_SSL: "false", PG_CA_CERT: PEM }, () => {
    assert.equal(sslConfig(), undefined);
  });
});

test("sslConfig: legacy fallbacks unchanged — PG_SSL=true or production without CA stay unverified", () => {
  withEnv({ PG_SSL: "true" }, () => {
    assert.deepEqual(sslConfig(), { rejectUnauthorized: false });
  });
  withEnv({ NODE_ENV: "production" }, () => {
    assert.deepEqual(sslConfig(), { rejectUnauthorized: false });
  });
  withEnv({}, () => {
    assert.equal(sslConfig(), undefined, "dev default: no TLS");
  });
});

test("sslConfig: production WITH a CA is verified — the C-3 target posture", () => {
  withEnv({ NODE_ENV: "production", PG_CA_CERT: PEM }, () => {
    const cfg = sslConfig();
    assert.equal(cfg?.rejectUnauthorized, true);
    assert.equal(cfg?.ca, PEM);
  });
});
