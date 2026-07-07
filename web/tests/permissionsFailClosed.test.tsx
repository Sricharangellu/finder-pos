/**
 * @vitest-environment jsdom
 *
 * PermissionsContext must FAIL CLOSED. Before identity is known — during load,
 * on request failure, and for restricted roles without an explicit feature
 * grant — privileged feature-gated surfaces must stay hidden. Only a successful
 * /api/identity/me for an all-access role (owner/admin/manager) or an explicit
 * per-user feature list may unlock feature-gated UI.
 *
 * Regression guard for the fail-open privilege bug (#26): the old context
 * defaulted to owner/all-features and returned true for every feature while
 * loading or after an identity error.
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse, delay } from "msw";
import { server } from "@/mocks/server";
import { PermissionsProvider, usePermissions } from "@/contexts/PermissionsContext";

function Probe() {
  const { role, loading, error, hasFeature } = usePermissions();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{String(error)}</span>
      <span data-testid="role">{role}</span>
      <span data-testid="catalog">{String(hasFeature("catalog"))}</span>
      <span data-testid="register">{String(hasFeature("register"))}</span>
    </div>
  );
}

function renderProbe() {
  return render(
    <PermissionsProvider>
      <Probe />
    </PermissionsProvider>,
  );
}

describe("PermissionsContext — fail closed", () => {
  it("hides feature-gated surfaces while identity is loading", async () => {
    server.use(
      http.get("*/api/identity/me", async () => {
        await delay(50);
        return HttpResponse.json({ userId: "u", tenantId: "t", role: "owner" });
      }),
    );

    renderProbe();

    // Synchronously, before the request resolves: still loading, nothing granted.
    expect(screen.getByTestId("loading").textContent).toBe("true");
    expect(screen.getByTestId("catalog").textContent).toBe("false");
    expect(screen.getByTestId("register").textContent).toBe("false");

    // After it settles, the owner gets access — proving the deny was transient.
    await waitFor(() =>
      expect(screen.getByTestId("catalog").textContent).toBe("true"),
    );
    server.resetHandlers();
  });

  it("fails closed and flags an error when identity cannot be established", async () => {
    server.use(
      http.get("*/api/identity/me", () =>
        HttpResponse.json({ error: { code: "server_error" } }, { status: 500 }),
      ),
    );

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("error").textContent).toBe("true");
    expect(screen.getByTestId("role").textContent).toBe("");
    expect(screen.getByTestId("catalog").textContent).toBe("false");
    expect(screen.getByTestId("register").textContent).toBe("false");
    server.resetHandlers();
  });

  it("grants all features to owner after a successful identity load", async () => {
    server.use(
      http.get("*/api/identity/me", () =>
        HttpResponse.json({ userId: "u", tenantId: "t", role: "owner" }),
      ),
    );
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("catalog").textContent).toBe("true"),
    );
    expect(screen.getByTestId("error").textContent).toBe("false");
    expect(screen.getByTestId("register").textContent).toBe("true");
    server.resetHandlers();
  });

  it("grants all features to admin", async () => {
    server.use(
      http.get("*/api/identity/me", () =>
        HttpResponse.json({ userId: "u", tenantId: "t", role: "admin" }),
      ),
    );
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("catalog").textContent).toBe("true"),
    );
    server.resetHandlers();
  });

  it("grants all features to manager (mirrors backend allAccess)", async () => {
    server.use(
      http.get("*/api/identity/me", () =>
        HttpResponse.json({ userId: "u", tenantId: "t", role: "manager" }),
      ),
    );
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("catalog").textContent).toBe("true"),
    );
    server.resetHandlers();
  });

  it("restricted role sees only the features its identity grants", async () => {
    server.use(
      http.get("*/api/identity/me", () =>
        HttpResponse.json({
          userId: "u",
          tenantId: "t",
          role: "cashier",
          features: ["register", "sales"],
        }),
      ),
    );
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("register").textContent).toBe("true"); // granted
    expect(screen.getByTestId("catalog").textContent).toBe("false"); // not granted
    server.resetHandlers();
  });

  it("restricted role with no feature list gets no feature-gated access", async () => {
    server.use(
      http.get("*/api/identity/me", () =>
        HttpResponse.json({ userId: "u", tenantId: "t", role: "cashier" }),
      ),
    );
    renderProbe();
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("error").textContent).toBe("false");
    expect(screen.getByTestId("register").textContent).toBe("false");
    expect(screen.getByTestId("catalog").textContent).toBe("false");
    server.resetHandlers();
  });
});
