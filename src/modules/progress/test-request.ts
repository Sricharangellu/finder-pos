import http from "node:http";
import jwt from "jsonwebtoken";
import type { App } from "../../app.js";

export function request(app: App, method: string, path: string, role: string, body?: unknown, tenantId = "tnt_demo") {
  const secret = process.env.JWT_SECRET ?? "test-secret-finder-pos";
  const token = jwt.sign({ sub: `usr_test_${role}`, tenantId, role }, secret, { expiresIn: "1h" });
  const resolvedPath = path.startsWith("/api/") && !path.startsWith("/api/v1/")
    ? path.replace("/api/", "/api/v1/")
    : path;
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const server = http.createServer(app.express);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      const payload = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = { authorization: `Bearer ${token}` };
      if (payload) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(payload));
      }
      const req = http.request({ host: "127.0.0.1", port: addr.port, method, path: resolvedPath, headers }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          server.close();
          let json: any;
          try { json = data ? JSON.parse(data) : undefined; } catch { json = data; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}
