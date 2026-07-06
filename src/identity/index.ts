import type { PosModule } from "../modules/types.js";
import { IdentityService } from "./service.js";
import { registerIdentityRoutes } from "./routes.js";
import { IDENTITY_MIGRATIONS } from "./migrations.js";

export const identityModule: PosModule = {
  name: "identity",
  migrations: IDENTITY_MIGRATIONS,
  async register({ db, events, router }) {
    const service = new IdentityService(db, events);
    // Idempotent demo seed (only runs when the users table is empty).
    await service.seedDemo();
    // Production defense-in-depth: neutralize any pre-existing demo account that
    // still carries the published password (no-op outside production).
    await service.neutralizeDemoAccountsInProduction();
    registerIdentityRoutes(router, service);
  },
};

export { IdentityService } from "./service.js";
export { requireRole } from "./service.js";
export type { Role, TokenClaims, UserRow, AuditLogRow } from "./types.js";
export { hasRole, ROLE_ORDER } from "./types.js";
export { IDENTITY_MIGRATIONS } from "./migrations.js";
