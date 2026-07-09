#!/usr/bin/env tsx
import process from "node:process";

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail: string;
}

interface HttpResult {
  status: number;
  headers: Headers;
  text: string;
  json?: unknown;
}

const backendUrl = normalizeBaseUrl(
  process.argv[2] ?? process.env["OPS_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001",
);
const allowedOrigin = process.env["OPS_ALLOWED_ORIGIN"] ?? "https://finder-pos-frontend.vercel.app";
const blockedOrigin = process.env["OPS_BLOCKED_ORIGIN"] ?? "https://blocked.finder.invalid";
const metricsToken = process.env["METRICS_TOKEN"] ?? process.env["OPS_METRICS_TOKEN"];
const allowPublicMetrics = envFlag("OPS_ALLOW_PUBLIC_METRICS", false);
const allowDevVersion = envFlag("OPS_ALLOW_DEV_VERSION", backendUrl.startsWith("http://localhost") || backendUrl.startsWith("http://127.0.0.1"));
const timeoutMs = Number(process.env["OPS_CHECK_TIMEOUT_MS"] ?? 15_000);

const results: CheckResult[] = [];

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("backend URL is empty");
  return trimmed.replace(/\/+$/, "");
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function record(status: CheckStatus, name: string, detail: string): void {
  results.push({ status, name, detail });
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} did not return a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function request(path: string, init: RequestInit = {}, retries = 2): Promise<HttpResult> {
  const url = `${backendUrl}${path}`;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let json: unknown;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json") && text) {
        json = JSON.parse(text);
      }
      clearTimeout(timeout);
      return { status: response.status, headers: response.headers, text, json };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function checkHealthz(): Promise<void> {
  const res = await request("/healthz");
  if (res.status !== 200) throw new Error(`/healthz returned ${res.status}`);
  const body = requireObject(res.json, "/healthz");
  if (body["status"] !== "ok") throw new Error(`/healthz status is ${String(body["status"])}`);
  const version = String(body["version"] ?? "");
  const builtAt = String(body["builtAt"] ?? "");
  if (!version) throw new Error("/healthz missing version");
  if (version === "dev" && !allowDevVersion) throw new Error("/healthz reports dev version on a non-local backend");
  if (!builtAt && !allowDevVersion) throw new Error("/healthz missing builtAt");

  const requiredHeaders: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
  };
  for (const [key, expected] of Object.entries(requiredHeaders)) {
    const actual = res.headers.get(key);
    if (actual !== expected) throw new Error(`security header ${key} expected ${expected}, got ${actual ?? "missing"}`);
  }
  record("pass", "liveness + version", `version=${version}, builtAt=${builtAt}`);
}

async function checkReadyz(): Promise<void> {
  const res = await request("/readyz");
  if (res.status !== 200) throw new Error(`/readyz returned ${res.status}: ${res.text.slice(0, 160)}`);
  const body = requireObject(res.json, "/readyz");
  if (body["status"] !== "ok") throw new Error(`/readyz status is ${String(body["status"])}`);
  if (body["db"] !== "connected") throw new Error(`/readyz db is ${String(body["db"])}`);
  const modules = Array.isArray(body["modules"]) ? body["modules"].map(String) : [];
  for (const required of ["identity", "catalog", "inventory", "orders", "payments", "settings"]) {
    if (!modules.includes(required)) throw new Error(`/readyz missing module ${required}`);
  }
  const pool = body["pool"] && typeof body["pool"] === "object" ? body["pool"] as Record<string, unknown> : undefined;
  const waiting = Number(pool?.["waiting"] ?? 0);
  if (waiting > 0) throw new Error(`/readyz pool has waiting clients: ${waiting}`);
  record("pass", "readiness + database", `${modules.length} modules, pool waiting=${waiting}`);
}

async function checkServiceInfo(): Promise<void> {
  const res = await request("/health");
  if (res.status !== 200) throw new Error(`/health returned ${res.status}`);
  const body = requireObject(res.json, "/health");
  if (body["status"] !== "ok") throw new Error(`/health status is ${String(body["status"])}`);
  const modules = Array.isArray(body["modules"]) ? body["modules"].map(String) : [];
  for (const required of ["catalog", "inventory", "orders", "payments", "settings"]) {
    if (!modules.includes(required)) throw new Error(`/health module list missing ${required}`);
  }
  record("pass", "service module info", `${modules.length} modules mounted`);
}

async function checkCors(): Promise<void> {
  const allowed = await request("/healthz", { headers: { Origin: allowedOrigin } });
  const allowedHeader = allowed.headers.get("access-control-allow-origin");
  if (allowedHeader !== allowedOrigin) {
    throw new Error(`allowed origin ${allowedOrigin} did not receive ACAO header; got ${allowedHeader ?? "missing"}`);
  }

  const blocked = await request("/healthz", { headers: { Origin: blockedOrigin } });
  const blockedHeader = blocked.headers.get("access-control-allow-origin");
  if (blockedHeader === blockedOrigin || blockedHeader === "*") {
    throw new Error(`blocked origin ${blockedOrigin} was allowed by CORS`);
  }
  record("pass", "CORS allowlist", `allowed=${allowedOrigin}, blocked=${blockedOrigin}`);
}

async function checkProtectedApi(): Promise<void> {
  const res = await request("/api/v1/flags", {}, 0);
  if (res.status !== 401) throw new Error(`/api/v1/flags without auth returned ${res.status}, expected 401`);
  record("pass", "auth boundary", "/api/v1/flags rejects unauthenticated requests");
}

async function checkMetrics(): Promise<void> {
  const unauth = await request("/metrics", {}, 0);
  if (unauth.status === 200 && !allowPublicMetrics) {
    throw new Error("/metrics is publicly readable; set METRICS_TOKEN or keep production metrics disabled");
  }
  if (unauth.status === 200 && allowPublicMetrics) {
    record("warn", "metrics protection", "public metrics allowed by OPS_ALLOW_PUBLIC_METRICS");
    return;
  }
  if (![401, 403, 503].includes(unauth.status)) {
    throw new Error(`/metrics without token returned ${unauth.status}, expected 401/403/503`);
  }

  if (!metricsToken) {
    record("warn", "metrics authorized scrape", `/metrics is not public, but authorized scrape was not verified because METRICS_TOKEN/OPS_METRICS_TOKEN is unset`);
    return;
  }

  const authed = await request("/metrics", { headers: { Authorization: `Bearer ${metricsToken}` } }, 0);
  if (authed.status !== 200) throw new Error(`/metrics with token returned ${authed.status}`);
  if (!authed.text.includes("http_requests_total") || !authed.text.includes("http_request_duration_ms")) {
    throw new Error("/metrics response is missing RED metrics");
  }
  record("pass", "metrics authorized scrape", "Prometheus RED metrics available with bearer token");
}

async function runCheck(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    record("fail", name, err instanceof Error ? err.message : String(err));
  }
}

console.log(`Ascend backend operational readiness check`);
console.log(`Backend: ${backendUrl}`);
console.log("");

await runCheck("liveness + version", checkHealthz);
await runCheck("readiness + database", checkReadyz);
await runCheck("service module info", checkServiceInfo);
await runCheck("CORS allowlist", checkCors);
await runCheck("auth boundary", checkProtectedApi);
await runCheck("metrics", checkMetrics);

for (const result of results) {
  const label = result.status === "pass" ? "PASS" : result.status === "warn" ? "WARN" : "FAIL";
  console.log(`[${label}] ${result.name} - ${result.detail}`);
}

const failures = results.filter((result) => result.status === "fail");
const warnings = results.filter((result) => result.status === "warn");
console.log("");
if (failures.length > 0) {
  console.error(`Operational readiness failed: ${failures.length} failure(s), ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`Operational readiness passed: ${results.length - warnings.length} check(s), ${warnings.length} warning(s).`);
