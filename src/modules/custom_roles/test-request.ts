import http from "node:http";
import jwt from "jsonwebtoken";
import type { Express } from "express";

function testAuthToken(
  role: string,
  extra?: { customRoleId?: string; permissions?: string[] },
): string {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  return jwt.sign(
    {
      sub: `usr_demo_${role}`,
      tenantId: "tnt_demo",
      role,
      ...(extra?.customRoleId ? { customRoleId: extra.customRoleId } : {}),
      ...(extra?.permissions ? { permissions: extra.permissions } : {}),
    },
    secret,
    { expiresIn: "1h" },
  );
}

function resolvePath(path: string): string {
  if (
    path.startsWith("/api/") &&
    !path.startsWith("/api/v1/") &&
    !path.startsWith("/api/identity/")
  ) {
    return path.replace("/api/", "/api/v1/");
  }
  return path;
}

export default function request(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  role: string = "owner",
  extra?: { customRoleId?: string; permissions?: string[] },
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
        authorization: `Bearer ${testAuthToken(role, extra)}`,
      };
      if (payload) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(payload));
      }
      const req = http.request(
        { host: "127.0.0.1", port: address.port, method, path: resolvePath(path), headers },
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
