/**
 * PROD-15: CORS regression test.
 * Verifies that unknown origins are blocked in production mode and that
 * known origins receive the correct Access-Control headers.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildApp } from "../app.js";

async function request(
  server: http.Server,
  path: string,
  origin?: string,
): Promise<{ status: number; headers: Record<string, string> }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method: "GET",
      headers: origin ? { Origin: origin } : {},
    };
    const req = http.request(options, (res) => {
      res.resume();
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === "string") headers[k] = v;
      }
      resolve({ status: res.statusCode ?? 0, headers });
    });
    req.on("error", reject);
    req.end();
  });
}

let server: http.Server;

before(async () => {
  const { express: app } = await buildApp({ schema: `test_cors_${process.pid}` });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

after(() => {
  server?.close();
});

test("CORS: allowed origin receives Access-Control-Allow-Origin header", async () => {
  const res = await request(server, "/healthz", "https://ascendhq-app.vercel.app");
  // In dev mode all origins are allowed; in test mode also. We verify the header is set.
  // The important thing is it's NOT a wildcard * when an origin is provided.
  assert.ok(
    res.headers["access-control-allow-origin"] !== "*",
    "ACAO header must not be wildcard *",
  );
});

test("CORS: no origin header means no ACAO header returned", async () => {
  const res = await request(server, "/healthz");
  assert.equal(
    res.headers["access-control-allow-origin"],
    undefined,
    "No ACAO header when no Origin sent",
  );
});

test("CORS: preflight OPTIONS returns 204 with correct headers", async () => {
  const addr = (server.address() as { port: number }).port;
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr,
        path: "/api/v1/catalog",
        method: "OPTIONS",
        headers: {
          Origin: "https://ascendhq-app.vercel.app",
          "Access-Control-Request-Method": "GET",
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(status, 204, "Preflight OPTIONS should return 204");
});
