import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { requireCapability } from "./auth.js";
import { HttpError } from "../shared/http.js";

/** Run the guard against a fake res.locals and return whatever it passed to next(). */
async function run(locals: Record<string, unknown>, capability = "wholesale"): Promise<unknown> {
  let passed: unknown = "UNSET";
  const next: NextFunction = ((err?: unknown) => { passed = err; }) as NextFunction;
  await requireCapability(capability)({} as Request, { locals } as unknown as Response, next);
  return passed;
}

const okDb = { one: async () => ({ enabled: true }) };
const missingDb = { one: async () => undefined };
const erroringDb = { one: async () => { throw new Error("db down"); } };

test("requireCapability: allows a tenant whose capability is enabled", async () => {
  const err = await run({ auth: { tenantId: "tnt_a" }, db: okDb });
  assert.equal(err, undefined, "next() called with no error");
});

test("requireCapability: 403 when the capability is not enabled (fail-closed)", async () => {
  const err = await run({ auth: { tenantId: "tnt_a" }, db: missingDb });
  assert.ok(err instanceof HttpError && err.status === 403, "denied with 403");
  assert.ok(!/wholesale/i.test((err as HttpError).message), "403 message must not name the capability");
});

test("requireCapability: 403 (fail-closed) when DB context is missing", async () => {
  const err = await run({ auth: { tenantId: "tnt_a" } });
  assert.ok(err instanceof HttpError && err.status === 403, "deny-by-default when unverifiable");
});

test("requireCapability: 403 (fail-closed) when the capability query errors", async () => {
  const err = await run({ auth: { tenantId: "tnt_a" }, db: erroringDb });
  assert.ok(err instanceof HttpError && err.status === 403, "deny-by-default on error");
});

test("requireCapability: 401 when unauthenticated", async () => {
  const err = await run({});
  assert.ok(err instanceof HttpError && err.status === 401, "401 without auth");
});
