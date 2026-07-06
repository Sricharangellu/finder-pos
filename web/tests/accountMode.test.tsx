/**
 * @vitest-environment jsdom
 *
 * AccountModeProvider now derives from the capabilities contract (the single
 * tenant-layer gating authority) instead of a separate /settings/feature-flags
 * fetch. These tests prove it reads accountMode + edition flags from
 * capabilities and never calls /settings/feature-flags.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { CapabilitiesProvider, invalidateCapabilitiesCache } from "@/contexts/CapabilitiesContext";
import { AccountModeProvider, useAccountMode } from "@/lib/useAccountMode";

function Probe() {
  const { mode, isRetail, editionFlags } = useAccountMode();
  return (
    <div>
      <p>mode:{mode}</p>
      <p>retail:{String(isRetail)}</p>
      <p>pos:{String(editionFlags["groupRetailPOS"] ?? "unset")}</p>
    </div>
  );
}

beforeEach(() => {
  invalidateCapabilitiesCache();
});

describe("AccountModeProvider (capabilities-derived)", () => {
  it("derives account mode + edition flags from capabilities", async () => {
    render(
      <CapabilitiesProvider>
        <AccountModeProvider>
          <Probe />
        </AccountModeProvider>
      </CapabilitiesProvider>,
    );

    // Mock tenant is retail → capabilities.features.accountMode = RETAIL.
    expect(await screen.findByText("mode:RETAIL")).toBeInTheDocument();
    expect(screen.getByText("retail:true")).toBeInTheDocument();
    // groupRetailPOS edition flag flows through from capabilities.features.
    expect(screen.getByText("pos:true")).toBeInTheDocument();
  });

  it("never fetches /settings/feature-flags (capabilities is the single source)", async () => {
    const flagsHit = vi.fn();
    server.use(
      http.get("*/api/v1/settings/feature-flags", () => {
        flagsHit();
        return HttpResponse.json({});
      }),
    );

    render(
      <CapabilitiesProvider>
        <AccountModeProvider>
          <Probe />
        </AccountModeProvider>
      </CapabilitiesProvider>,
    );

    await screen.findByText(/mode:/);
    await waitFor(() => expect(screen.getByText(/mode:/)).toBeInTheDocument());
    expect(flagsHit).not.toHaveBeenCalled();

    server.resetHandlers();
  });
});
