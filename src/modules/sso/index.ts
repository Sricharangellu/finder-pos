import type { PosModule } from "../types.js";
import { SsoService } from "./service.js";
import { registerRoutes } from "./routes.js";

/** SSO module — OAuth2/OIDC single sign-on for enterprise tenants.
 *  Config stored in settings_kv; owns no additional tables. */
export const ssoModule: PosModule = {
  name: "sso",
  migrations: [],
  register({ db, router }) {
    registerRoutes(router, new SsoService(db));
  },
};

export { SsoService } from "./service.js";
export type { IdentityProviderConfig, SanitizedIdPConfig } from "./service.js";
