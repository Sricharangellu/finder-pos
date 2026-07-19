/**
 * @vitest-environment jsdom
 *
 * Integration test for the API client against MSW mocks.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { apiDownload, apiPost, ApiResponseError } from "@/api-client/client";
import type { LoginResponse } from "@/api-client/types";
import { clearSession, setSession } from "@/lib/auth";
import { server } from "@/mocks/server";

beforeEach(() => {
  clearSession();
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

describe("apiFetch — login flow", () => {
  it("returns a session on valid credentials", async () => {
    const data = await apiPost<LoginResponse>(
      "/api/identity/login",
      { email: "test@example.com", password: "anypassword" },
      { anonymous: true }
    );
    expect(data.accessToken).toBeTruthy();
    expect(data.expiresIn).toBeGreaterThan(0);
    expect(data.user.email).toBe("test@example.com");
    expect(data.refreshToken).toBeTruthy();
  });

  it("throws ApiResponseError on wrong credentials", async () => {
    await expect(
      apiPost(
        "/api/identity/login",
        { email: "test@example.com", password: "wrong" },
        { anonymous: true }
      )
    ).rejects.toBeInstanceOf(ApiResponseError);
  });

  it("ApiResponseError carries code and requestId", async () => {
    try {
      await apiPost(
        "/api/identity/login",
        { email: "test@example.com", password: "wrong" },
        { anonymous: true }
      );
    } catch (err) {
      expect(err).toBeInstanceOf(ApiResponseError);
      const apiErr = err as ApiResponseError;
      expect(apiErr.code).toBe("INVALID_CREDENTIALS");
      expect(apiErr.status).toBe(401);
      expect(apiErr.requestId).toBeTruthy();
    }
  });
});

describe("apiFetch — health endpoints", () => {
  it("GET /healthz returns ok", async () => {
    const { apiGet } = await import("@/api-client/client");
    const data = await apiGet<{ status: string }>("/healthz");
    expect(data.status).toBe("ok");
  });

  it("GET /flags returns a flags map", async () => {
    const { apiGet } = await import("@/api-client/client");
    const { setSession } = await import("@/lib/auth");
    // Need a valid session so the client adds the auth header
    setSession("test-token", 900, "ref", {
      id: "u1",
      email: "e@e.com",
      name: "T",
      role: "cashier",
      tenantId: "t1",
    });
    const data = await apiGet<{ flags: Record<string, boolean> }>("/api/v1/flags");
    expect(typeof data.flags).toBe("object");
  });
});

describe("apiDownload", () => {
  it("downloads blob responses with the bearer token", async () => {
    let authHeader = "";
    server.use(
      http.get("*/api/v1/catalog/export", ({ request }) => {
        authHeader = request.headers.get("authorization") ?? "";
        return new HttpResponse("sku,name\nA-1,Apple\n", {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        });
      }),
    );

    setSession("download-token", 900, "ref", {
      id: "u1",
      email: "owner@example.com",
      name: "Owner",
      role: "owner",
      tenantId: "t1",
    });

    const blob = await apiDownload("/api/v1/catalog/export");
    expect(authHeader).toBe("Bearer download-token");
    expect(await readBlob(blob)).toBe("sku,name\nA-1,Apple\n");
  });

  it("refreshes once on 401 before retrying a blob download", async () => {
    localStorage.setItem("ascend_demo", "1");
    let exportCalls = 0;
    const seenAuthHeaders: string[] = [];
    server.use(
      http.get("*/api/v1/catalog/export", ({ request }) => {
        exportCalls += 1;
        seenAuthHeaders.push(request.headers.get("authorization") ?? "");
        if (exportCalls === 1) {
          return HttpResponse.json(
            { error: { code: "unauthenticated", message: "Expired", requestId: "req_1" } },
            { status: 401 },
          );
        }
        return new HttpResponse("sku,name\nB-2,Banana\n", {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        });
      }),
    );

    setSession("expired-token", 900, "mock-refresh-token-dev", {
      id: "u1",
      email: "owner@example.com",
      name: "Owner",
      role: "owner",
      tenantId: "t1",
    });
    document.cookie = "finder_session_hint=1; Path=/; SameSite=Lax";

    const blob = await apiDownload("/api/v1/catalog/export");
    expect(await readBlob(blob)).toBe("sku,name\nB-2,Banana\n");
    expect(exportCalls).toBe(2);
    expect(seenAuthHeaders[0]).toBe("Bearer expired-token");
    expect(seenAuthHeaders[1]).toMatch(/^Bearer mock-access-token\./);
  });
});
