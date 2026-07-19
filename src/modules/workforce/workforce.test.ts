import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { buildApp, type App } from "../../app.js";

let __seq = 0;
const __schema = () => `test_${process.pid}_${Date.now().toString(36)}_${__seq++}`;
async function freshApp(): Promise<App> { return await buildApp({ schema: __schema() }); }
async function call(app: App, method: string, path: string, body?: unknown) {
  const { default: request } = await import("./test-request.js");
  return request(app.express, method, path, body);
}

function tokenFor(tenantId: string, role: "owner" | "manager" | "cashier"): string {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  return jwt.sign({ sub: `usr_${tenantId}_${role}`, tenantId, role }, secret, { expiresIn: "1h" });
}
function callAs(
  app: App,
  method: string,
  path: string,
  tenantId: string,
  role: "owner" | "manager" | "cashier",
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const full = path.startsWith("/api/v1/") ? path : path.replace("/api/", "/api/v1/");
  return new Promise((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") { server.close(); reject(new Error("bind failed")); return; }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1", port: address.port, path: full, method,
          headers: {
            authorization: `Bearer ${tokenFor(tenantId, role)}`,
            ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => { server.close(); resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }); });
        },
      );
      req.on("error", (err) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// Regression test for a double-URL-prefix bug: the module mounted at the
// default `/api/v1/workforce` while every route inside was ALSO prefixed
// with `/workforce`, producing `/api/v1/workforce/workforce/employees` — the
// single-prefix path the frontend actually calls 404'd.
test("single-prefix /api/v1/workforce/employees is reachable (not double-prefixed)", async () => {
  const app = await freshApp();
  const create = await call(app, "POST", "/api/v1/workforce/employees", { name: "Jordan" });
  assert.equal(create.status, 201);
  assert.equal(create.json.name, "Jordan");

  const list = await call(app, "GET", "/api/v1/workforce/employees");
  assert.equal(list.status, 200);
  assert.equal(list.json.items.length, 1);

  const doublePrefixed = await call(app, "GET", "/api/v1/workforce/workforce/employees");
  assert.equal(doublePrefixed.status, 404);
});

// ─── Employees CRUD ─────────────────────────────────────────────────────────

test("employees: create/list/update round-trip", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/workforce/employees", {
    name: "Alex Cook", role: "manager", email: "alex@example.com", avatar_color: "#112233",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.role, "manager");
  assert.equal(created.json.email, "alex@example.com");
  assert.ok(created.json.id.startsWith("emp_"));

  const list = await call(app, "GET", "/api/workforce/employees");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((e: any) => e.id === created.json.id));

  const updated = await call(app, "PATCH", `/api/workforce/employees/${created.json.id}`, { name: "Alex J. Cook", role: "supervisor" });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.name, "Alex J. Cook");
  assert.equal(updated.json.role, "supervisor");
  assert.equal(updated.json.email, "alex@example.com", "unspecified fields are preserved on partial update");
});

test("employees: default role is cashier and defaults apply when omitted", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/workforce/employees", { name: "No Role Given" });
  assert.equal(created.status, 201);
  assert.equal(created.json.role, "cashier");
  assert.equal(created.json.email, "");
  assert.equal(created.json.avatar_color, "#64748b");
  assert.equal(created.json.active, 1);
});

// NOTE: listEmployees() filters on `active = 1` and updateEmployee()'s type
// signature accepts an `active` field, but the PATCH /employees/:id zod
// schema (employeeSchema, routes.ts) never declares `active` as a field —
// zod silently strips unknown keys by default, so `{ active: 0 }` in a PATCH
// body is a no-op today. Nothing in the web app's workforce page ever sends
// `active` either (no deactivate/archive UI exists for this module). This is
// a real gap between the service layer's capability and what's reachable
// over HTTP, but not a clear bug with an established caller being broken —
// left as-is per instructions rather than inventing a deactivate endpoint/UI
// as a speculative product decision. This test documents current behavior.
test("employees: PATCH does not expose `active` (routes.ts schema gap — see NOTE above); the field is a no-op today", async () => {
  const app = await freshApp();
  const created = (await call(app, "POST", "/api/workforce/employees", { name: "Soon Inactive" })).json;
  assert.equal(created.active, 1);

  const attempted = await call(app, "PATCH", `/api/workforce/employees/${created.id}`, { active: 0 });
  assert.equal(attempted.status, 200);
  assert.equal(attempted.json.active, 1, "active is silently unchanged — the field isn't in employeeSchema");

  const list = await call(app, "GET", "/api/workforce/employees");
  assert.ok(list.json.items.some((e: any) => e.id === created.id), "employee still appears active since deactivation is unreachable via the API");
});

// ─── Employees validation (400s) ────────────────────────────────────────────

test("employees: create rejects empty name, bad email, bad avatar_color, bad role", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "POST", "/api/workforce/employees", { name: "" })).status, 400);
  assert.equal((await call(app, "POST", "/api/workforce/employees", { name: "X", email: "not-an-email" })).status, 400);
  assert.equal((await call(app, "POST", "/api/workforce/employees", { name: "X", avatar_color: "blue" })).status, 400);
  assert.equal((await call(app, "POST", "/api/workforce/employees", { name: "X", role: "ceo" })).status, 400);
  assert.equal((await call(app, "POST", "/api/workforce/employees", {})).status, 400, "name is required");
});

test("employees: email may be an explicit empty string (opt-out sentinel)", async () => {
  const app = await freshApp();
  const created = await call(app, "POST", "/api/workforce/employees", { name: "No Email", email: "" });
  assert.equal(created.status, 201);
  assert.equal(created.json.email, "");
});

// ─── Employees 404 ──────────────────────────────────────────────────────────

test("employees: 404 patching an unknown id", async () => {
  const app = await freshApp();
  const r = await call(app, "PATCH", "/api/workforce/employees/emp_missing", { name: "Ghost" });
  assert.equal(r.status, 404);
});

// ─── Shifts CRUD + filters ──────────────────────────────────────────────────

test("shifts: create/list/update/delete round-trip, denormalized employee_name+role travel with the shift", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Sam Stocker", role: "stock" })).json;

  const created = await call(app, "POST", "/api/workforce/shifts", {
    employee_id: emp.id, date: "2026-08-01", start_time: "09:00", end_time: "17:00", notes: "Opening shift",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.employee_name, "Sam Stocker");
  assert.equal(created.json.role, "stock");
  assert.ok(created.json.id.startsWith("sh_"));

  const list = await call(app, "GET", "/api/workforce/shifts");
  assert.equal(list.status, 200);
  assert.ok(list.json.items.some((s: any) => s.id === created.json.id));

  const updated = await call(app, "PATCH", `/api/workforce/shifts/${created.json.id}`, { end_time: "18:00", notes: "Extended" });
  assert.equal(updated.status, 200);
  assert.equal(updated.json.end_time, "18:00");
  assert.equal(updated.json.notes, "Extended");
  assert.equal(updated.json.start_time, "09:00", "unspecified fields untouched");

  const del = await call(app, "DELETE", `/api/workforce/shifts/${created.json.id}`);
  assert.equal(del.status, 204);

  const listAfter = await call(app, "GET", "/api/workforce/shifts");
  assert.ok(!listAfter.json.items.some((s: any) => s.id === created.json.id));
});

test("shifts: list filters by date_from/date_to and employee_id", async () => {
  const app = await freshApp();
  const empA = (await call(app, "POST", "/api/workforce/employees", { name: "Employee A" })).json;
  const empB = (await call(app, "POST", "/api/workforce/employees", { name: "Employee B" })).json;

  await call(app, "POST", "/api/workforce/shifts", { employee_id: empA.id, date: "2026-08-01", start_time: "09:00", end_time: "17:00" });
  await call(app, "POST", "/api/workforce/shifts", { employee_id: empA.id, date: "2026-08-05", start_time: "09:00", end_time: "17:00" });
  await call(app, "POST", "/api/workforce/shifts", { employee_id: empB.id, date: "2026-08-01", start_time: "10:00", end_time: "18:00" });

  const byRange = await call(app, "GET", "/api/workforce/shifts?date_from=2026-08-02&date_to=2026-08-10");
  assert.equal(byRange.json.items.length, 1);
  assert.equal(byRange.json.items[0].date, "2026-08-05");

  const byEmployee = await call(app, "GET", `/api/workforce/shifts?employee_id=${empB.id}`);
  assert.equal(byEmployee.json.items.length, 1);
  assert.equal(byEmployee.json.items[0].employee_id, empB.id);
});

test("shifts: create rejects unknown employee_id, malformed date, malformed time", async () => {
  const app = await freshApp();
  const missingEmp = await call(app, "POST", "/api/workforce/shifts", {
    employee_id: "emp_missing", date: "2026-08-01", start_time: "09:00", end_time: "17:00",
  });
  assert.equal(missingEmp.status, 404);

  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Valid Emp" })).json;
  const badDate = await call(app, "POST", "/api/workforce/shifts", {
    employee_id: emp.id, date: "08/01/2026", start_time: "09:00", end_time: "17:00",
  });
  assert.equal(badDate.status, 400);

  const badTime = await call(app, "POST", "/api/workforce/shifts", {
    employee_id: emp.id, date: "2026-08-01", start_time: "9am", end_time: "17:00",
  });
  assert.equal(badTime.status, 400);
});

test("shifts: 404 for update/delete of an unknown shift id", async () => {
  const app = await freshApp();
  assert.equal((await call(app, "PATCH", "/api/workforce/shifts/sh_missing", { notes: "x" })).status, 404);
  assert.equal((await call(app, "DELETE", "/api/workforce/shifts/sh_missing")).status, 404);
});

// ─── Time-off CRUD ──────────────────────────────────────────────────────────

test("time-off: create/list/approve round-trip", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Requester" })).json;

  const created = await call(app, "POST", "/api/workforce/time-off", {
    employee_id: emp.id, date_from: "2026-09-01", date_to: "2026-09-05", reason: "Vacation",
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.status, "pending");
  assert.equal(created.json.employee_name, "Requester");
  assert.ok(created.json.id.startsWith("to_"));

  const list = await call(app, "GET", "/api/workforce/time-off");
  assert.ok(list.json.items.some((r: any) => r.id === created.json.id));

  const approved = await call(app, "PATCH", `/api/workforce/time-off/${created.json.id}`, { status: "approved" });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, "approved");
});

test("time-off: create rejects unknown employee_id and malformed dates", async () => {
  const app = await freshApp();
  const missingEmp = await call(app, "POST", "/api/workforce/time-off", {
    employee_id: "emp_missing", date_from: "2026-09-01", date_to: "2026-09-05",
  });
  assert.equal(missingEmp.status, 404);

  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Valid" })).json;
  const badDates = await call(app, "POST", "/api/workforce/time-off", {
    employee_id: emp.id, date_from: "not-a-date", date_to: "2026-09-05",
  });
  assert.equal(badDates.status, 400);
});

test("time-off: patch rejects an unrecognized status and 404s on unknown id", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Valid" })).json;
  const req = (await call(app, "POST", "/api/workforce/time-off", {
    employee_id: emp.id, date_from: "2026-09-01", date_to: "2026-09-05",
  })).json;

  const badStatus = await call(app, "PATCH", `/api/workforce/time-off/${req.id}`, { status: "bogus" });
  assert.equal(badStatus.status, 400);

  const missing = await call(app, "PATCH", "/api/workforce/time-off/to_missing", { status: "approved" });
  assert.equal(missing.status, 404);
});

// ─── Time clock (BE-40) lifecycle ───────────────────────────────────────────

test("time clock: clock-in then clock-out computes worked_minutes net of break", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Clocker" })).json;

  const ci = await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id, notes: "Morning shift" });
  assert.equal(ci.status, 201);
  assert.equal(ci.json.employee_id, emp.id);
  assert.equal(ci.json.clock_out, null);
  assert.equal(ci.json.notes, "Morning shift");

  // breakMinutes left at 0 here: the test clocks in and out within
  // milliseconds of real time, so any non-zero break would exceed the
  // actual elapsed duration and drive worked_minutes negative (a real
  // service-layer gap — see the dedicated test below — not exercised here).
  const co = await call(app, "POST", `/api/workforce/clock-out/${ci.json.id}`, { breakMinutes: 0 });
  assert.equal(co.status, 200);
  assert.equal(co.json.break_minutes, 0);
  assert.ok(co.json.clock_out !== null);

  const list = await call(app, "GET", `/api/workforce/time-entries?employeeId=${emp.id}`);
  assert.equal(list.status, 200);
  const entry = list.json.items.find((e: any) => e.id === ci.json.id);
  assert.ok(entry, "clocked entry must be visible in the listing");
  assert.equal(entry.employee_name, "Clocker");
  assert.ok(entry.worked_minutes >= 0);
});

// NOTE: neither clockOut nor the schema validates that breakMinutes doesn't
// exceed the actual elapsed clock-in→clock-out duration. This is a real gap
// (a manager could enter a break longer than the shift, producing a negative
// worked_minutes downstream in payroll/reporting), but it's an edge-case data
// -quality validation, not a broken established call path — documenting
// current behavior here rather than inventing new validation rules.
test("time clock: a breakMinutes value larger than the actual elapsed duration is accepted and yields a negative worked_minutes (unvalidated edge case)", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Overbroken" })).json;
  const ci = (await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id })).json;
  const co = await call(app, "POST", `/api/workforce/clock-out/${ci.id}`, { breakMinutes: 999999 });
  assert.equal(co.status, 200, "no validation currently rejects an unrealistic break duration");

  const list = await call(app, "GET", `/api/workforce/time-entries?employeeId=${emp.id}`);
  const entry = list.json.items.find((e: any) => e.id === ci.id);
  assert.ok(entry.worked_minutes < 0, "worked_minutes goes negative — documents the current unvalidated behavior");
});

test("time clock: cannot clock in twice without clocking out first (409 already_clocked_in)", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Double Clocker" })).json;

  const first = await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id });
  assert.equal(first.status, 201);

  const second = await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id });
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, "already_clocked_in");

  // After clocking out, the employee may clock in again.
  await call(app, "POST", `/api/workforce/clock-out/${first.json.id}`, {});
  const third = await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id });
  assert.equal(third.status, 201);
});

test("time clock: cannot clock out an already-closed entry (409 already_clocked_out)", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Closer" })).json;
  const ci = (await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id })).json;
  await call(app, "POST", `/api/workforce/clock-out/${ci.id}`, {});

  const again = await call(app, "POST", `/api/workforce/clock-out/${ci.id}`, {});
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "already_clocked_out");
});

test("time clock: clock-out 404s for an unknown entry id", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/workforce/clock-out/te_missing", {});
  assert.equal(r.status, 404);
});

// Regression test for a real bug found during this session's verification
// pass: clockIn previously never checked whether employeeId referred to a
// real employee (createShift/createTimeOff already did this check; clockIn
// did not). A bogus employeeId would return 201 and insert a row into
// time_entries that then could never appear in listTimeEntries (which INNER
// JOINs employees), while still permanently occupying the "already clocked
// in" slot for that id — an invisible, unrecoverable stuck entry. Fixed by
// validating employee existence before insert, matching the other creators.
test("time clock: clock-in rejects an unknown employeeId with 404 (regression — previously silently created an orphaned, invisible entry)", async () => {
  const app = await freshApp();
  const r = await call(app, "POST", "/api/workforce/clock-in", { employeeId: "emp_totally_bogus" });
  assert.equal(r.status, 404);

  const list = await call(app, "GET", "/api/workforce/time-entries");
  assert.equal(list.json.items.length, 0, "no orphaned time entry should have been created");

  // Confirms the id isn't stuck in a phantom "already clocked in" state either.
  const retry = await call(app, "POST", "/api/workforce/clock-in", { employeeId: "emp_totally_bogus" });
  assert.equal(retry.status, 404);
});

test("time clock: validation rejects missing employeeId and negative breakMinutes", async () => {
  const app = await freshApp();
  const noEmployee = await call(app, "POST", "/api/workforce/clock-in", {});
  assert.equal(noEmployee.status, 400);

  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Valid" })).json;
  const ci = (await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id })).json;
  const badBreak = await call(app, "POST", `/api/workforce/clock-out/${ci.id}`, { breakMinutes: -5 });
  assert.equal(badBreak.status, 400);
});

test("time clock: list supports from/to range filtering and limit", async () => {
  const app = await freshApp();
  const emp = (await call(app, "POST", "/api/workforce/employees", { name: "Ranger" })).json;
  const ci1 = (await call(app, "POST", "/api/workforce/clock-in", { employeeId: emp.id })).json;
  await call(app, "POST", `/api/workforce/clock-out/${ci1.id}`, {});

  const futureFrom = Date.now() + 1000 * 60 * 60 * 24 * 365; // a year from now
  const noneInFuture = await call(app, "GET", `/api/workforce/time-entries?employeeId=${emp.id}&from=${futureFrom}`);
  assert.equal(noneInFuture.json.items.length, 0);

  const limited = await call(app, "GET", `/api/workforce/time-entries?employeeId=${emp.id}&limit=1`);
  assert.equal(limited.json.items.length, 1);
});

// ─── Role gating ────────────────────────────────────────────────────────────

test("role gating: cashier is rejected from employee/shift mutations but reads remain open", async () => {
  const app = await freshApp();
  const createEmpAsCashier = await callAs(app, "POST", "/api/v1/workforce/employees", "tnt_demo", "cashier", { name: "Nope" });
  assert.equal(createEmpAsCashier.status, 403);

  const emp = (await callAs(app, "POST", "/api/v1/workforce/employees", "tnt_demo", "manager", { name: "By Manager" })).json;

  const patchEmpAsCashier = await callAs(app, "PATCH", `/api/v1/workforce/employees/${emp.id}`, "tnt_demo", "cashier", { name: "Hacked" });
  assert.equal(patchEmpAsCashier.status, 403);

  const createShiftAsCashier = await callAs(app, "POST", "/api/v1/workforce/shifts", "tnt_demo", "cashier", {
    employee_id: emp.id, date: "2026-08-01", start_time: "09:00", end_time: "17:00",
  });
  assert.equal(createShiftAsCashier.status, 403);

  const readEmpAsCashier = await callAs(app, "GET", "/api/v1/workforce/employees", "tnt_demo", "cashier");
  assert.equal(readEmpAsCashier.status, 200);
  const readShiftsAsCashier = await callAs(app, "GET", "/api/v1/workforce/shifts", "tnt_demo", "cashier");
  assert.equal(readShiftsAsCashier.status, 200);
});

test("role gating: cashier can create their own time-off request and use the time clock (no manager gate on those actions)", async () => {
  const app = await freshApp();
  const emp = (await callAs(app, "POST", "/api/v1/workforce/employees", "tnt_demo", "manager", { name: "Self Service" })).json;

  const timeOffAsCashier = await callAs(app, "POST", "/api/v1/workforce/time-off", "tnt_demo", "cashier", {
    employee_id: emp.id, date_from: "2026-09-01", date_to: "2026-09-02",
  });
  assert.equal(timeOffAsCashier.status, 201, "time-off creation is not manager-gated");

  const approveAsCashier = await callAs(app, "PATCH", `/api/v1/workforce/time-off/${timeOffAsCashier.json.id}`, "tnt_demo", "cashier", { status: "approved" });
  assert.equal(approveAsCashier.status, 403, "approving/denying time-off is manager-gated");

  const clockInAsCashier = await callAs(app, "POST", "/api/v1/workforce/clock-in", "tnt_demo", "cashier", { employeeId: emp.id });
  assert.equal(clockInAsCashier.status, 201, "clock-in is not manager-gated");

  const clockOutAsCashier = await callAs(app, "POST", `/api/v1/workforce/clock-out/${clockInAsCashier.json.id}`, "tnt_demo", "cashier", {});
  assert.equal(clockOutAsCashier.status, 200, "clock-out is not manager-gated");
});

test("role gating: manager can create/update employees and shifts", async () => {
  const app = await freshApp();
  const emp = await callAs(app, "POST", "/api/v1/workforce/employees", "tnt_demo", "manager", { name: "Manager Made" });
  assert.equal(emp.status, 201);
  const updated = await callAs(app, "PATCH", `/api/v1/workforce/employees/${emp.json.id}`, "tnt_demo", "manager", { role: "supervisor" });
  assert.equal(updated.status, 200);
});

// ─── Tenant isolation ───────────────────────────────────────────────────────

test("tenant isolation: an employee created under one tenant is invisible to another", async () => {
  const app = await freshApp();
  const created = await callAs(app, "POST", "/api/v1/workforce/employees", "tnt_demo", "owner", { name: "Isolated Employee" });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const crossPatch = await callAs(app, "PATCH", `/api/v1/workforce/employees/${id}`, "tnt_other", "owner", { name: "Hijacked" });
  assert.equal(crossPatch.status, 404, "cross-tenant patch must 404, not act on another tenant's employee");

  const crossList = await callAs(app, "GET", "/api/v1/workforce/employees", "tnt_other", "owner");
  assert.equal(crossList.status, 200);
  assert.ok(!crossList.json.items.some((e: any) => e.id === id), "cross-tenant list must not leak rows");

  const ownGet = await callAs(app, "GET", "/api/v1/workforce/employees", "tnt_demo", "owner");
  assert.ok(ownGet.json.items.some((e: any) => e.id === id && e.name === "Isolated Employee"), "original tenant's employee untouched");
});

test("tenant isolation: shifts, time-off, and time-clock rows are scoped per tenant", async () => {
  const app = await freshApp();
  const empA = (await callAs(app, "POST", "/api/v1/workforce/employees", "tnt_demo", "owner", { name: "Tenant A Emp" })).json;
  const empB = (await callAs(app, "POST", "/api/v1/workforce/employees", "tnt_other", "owner", { name: "Tenant B Emp" })).json;

  // A shift for tenant A's employee cannot be created/managed using tenant B's session.
  const shiftA = await callAs(app, "POST", "/api/v1/workforce/shifts", "tnt_demo", "owner", {
    employee_id: empA.id, date: "2026-08-01", start_time: "09:00", end_time: "17:00",
  });
  assert.equal(shiftA.status, 201);

  const crossPatchShift = await callAs(app, "PATCH", `/api/v1/workforce/shifts/${shiftA.json.id}`, "tnt_other", "owner", { notes: "Hijacked" });
  assert.equal(crossPatchShift.status, 404);

  const tenantBShiftList = await callAs(app, "GET", "/api/v1/workforce/shifts", "tnt_other", "owner");
  assert.ok(!tenantBShiftList.json.items.some((s: any) => s.id === shiftA.json.id));

  // Tenant B cannot reference tenant A's employee id when creating its own shift.
  const crossEmployeeShift = await callAs(app, "POST", "/api/v1/workforce/shifts", "tnt_other", "owner", {
    employee_id: empA.id, date: "2026-08-01", start_time: "09:00", end_time: "17:00",
  });
  assert.equal(crossEmployeeShift.status, 404, "tenant B must not be able to schedule tenant A's employee");

  // Time clock: tenant A clocks in; tenant B cannot see or clock out that entry.
  const ciA = await callAs(app, "POST", "/api/v1/workforce/clock-in", "tnt_demo", "owner", { employeeId: empA.id });
  assert.equal(ciA.status, 201);

  const tenantBTimeEntries = await callAs(app, "GET", "/api/v1/workforce/time-entries", "tnt_other", "owner");
  assert.ok(!tenantBTimeEntries.json.items.some((e: any) => e.id === ciA.json.id));

  const crossClockOut = await callAs(app, "POST", `/api/v1/workforce/clock-out/${ciA.json.id}`, "tnt_other", "owner", {});
  assert.equal(crossClockOut.status, 404, "cross-tenant clock-out must 404");

  // Tenant B can independently clock in its own employee with an open entry
  // at the same time — proves isolation isn't accidentally serializing tenants.
  const ciB = await callAs(app, "POST", "/api/v1/workforce/clock-in", "tnt_other", "owner", { employeeId: empB.id });
  assert.equal(ciB.status, 201);
});
