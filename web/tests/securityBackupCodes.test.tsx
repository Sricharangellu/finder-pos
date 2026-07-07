/**
 * @vitest-environment jsdom
 *
 * SecuritySection backup-code management (#28): the settings surface must show
 * the remaining backup-code count and let an MFA-enabled user regenerate codes
 * through the real /api/identity/mfa/backup-codes/regenerate route, behind a
 * clear confirmation, then reveal the fresh set.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { ToastProvider } from "@/components/Toast";
import { SecuritySection } from "@/app/(protected)/settings/_components/SecuritySection";

// jsdom does not implement <dialog>.showModal()/close(); stub them so the
// ConfirmDialog can open (confirmRegenerate → showModal) without throwing.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; };
});

function renderSection() {
  return render(
    <ToastProvider>
      <SecuritySection />
    </ToastProvider>,
  );
}

const REGEN_CODES = [
  "AAAA-0001", "BBBB-0002", "CCCC-0003", "DDDD-0004",
  "EEEE-0005", "FFFF-0006", "GGGG-0007", "HHHH-0008",
];

describe("SecuritySection — backup code management", () => {
  it("shows the remaining backup-code count when MFA is enabled", async () => {
    server.use(
      http.get("*/api/identity/mfa/status", () =>
        HttpResponse.json({ enabled: true, setupRequired: false, backupCodesRemaining: 8 }),
      ),
    );

    renderSection();

    expect(await screen.findByText(/8 codes remaining/i)).toBeInTheDocument();
    // Regenerate is offered; enable/setup is not, since MFA is already on.
    expect(screen.getByRole("button", { name: /regenerate codes/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^enable mfa$/i })).not.toBeInTheDocument();
  });

  it("regenerates codes behind a confirmation and reveals the new set", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/identity/mfa/status", () =>
        HttpResponse.json({ enabled: true, setupRequired: false, backupCodesRemaining: 3 }),
      ),
      http.post("*/api/identity/mfa/backup-codes/regenerate", () =>
        HttpResponse.json({ ok: true, backupCodes: REGEN_CODES }),
      ),
    );

    renderSection();

    // No fresh codes are shown until the user confirms.
    await screen.findByText(/3 codes remaining/i);
    expect(screen.queryByText("AAAA-0001")).not.toBeInTheDocument();

    // Open the confirmation (card action), then confirm (uniquely-labelled).
    await user.click(screen.getByRole("button", { name: /regenerate codes/i }));
    expect(await screen.findByText(/invalidates all of your current backup codes/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /regenerate now/i }));

    // New codes are revealed and the count reflects the fresh full set.
    expect(await screen.findByText("AAAA-0001")).toBeInTheDocument();
    expect(screen.getByText("HHHH-0008")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/8 codes remaining/i)).toBeInTheDocument());
  });

  it("surfaces an error when regeneration fails and never leaks codes", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("*/api/identity/mfa/status", () =>
        HttpResponse.json({ enabled: true, setupRequired: false, backupCodesRemaining: 2 }),
      ),
      http.post("*/api/identity/mfa/backup-codes/regenerate", () =>
        HttpResponse.json({ error: { code: "mfa_not_enabled", message: "Enable MFA first." } }, { status: 400 }),
      ),
    );

    renderSection();

    await user.click(await screen.findByRole("button", { name: /regenerate codes/i }));
    await user.click(screen.getByRole("button", { name: /regenerate now/i }));

    // No fresh codes leak in on failure; the prior count remains.
    await waitFor(() => expect(screen.getByText(/2 codes remaining/i)).toBeInTheDocument());
    expect(screen.queryByText(/^[A-Z]{4}-\d{4}$/)).not.toBeInTheDocument();
  });
});
