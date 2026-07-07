import http from "node:http";
import jwt from "jsonwebtoken";
import type { Express } from "express";

/**
 * Tiny test client for the business module. Like the other modules' helpers it
 * spins up the app on an ephemeral port for one request, but it lets each test
 * sign a DIFFERENT identity (user/tenant/role) so access-separation can be
 * exercised. Defaults to the demo owner. The harness sets JWT_SECRET.
 */
export interface TestClaims {
  sub?: string;
  tenantId?: string;
  role?: string;
}

function testAuthToken(claims: TestClaims): string {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  return jwt.sign(
    { sub: claims.sub ?? "usr_demo_owner", tenantId: claims.tenantId ?? "tnt_demo", role: claims.role ?? "owner" },
    secret,
    { expiresIn: "1h" },
  );
}

export default function request(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  claims: TestClaims = {},
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("failed to bind test server"));
        return;
      }
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const headers: Record<string, string> = {
        authorization: `Bearer ${testAuthToken(claims)}`,
      };
      if (payload) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(payload));
      }
      const req = http.request(
        { host: "127.0.0.1", port: address.port, method, path, headers },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            server.close();
            let json: any = undefined;
            try {
              json = data ? JSON.parse(data) : undefined;
            } catch {
              json = data;
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
