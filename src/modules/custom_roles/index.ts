import type { PosModule } from "../types.js";
import { CustomRolesService } from "./service.js";
import { registerRoutes } from "./routes.js";

export const customRolesModule: PosModule = {
  name: "custom-roles",
  migrations: [],
  register({ db, router }) {
    registerRoutes(router, new CustomRolesService(db));
  },
};

export { CustomRolesService } from "./service.js";
export { KNOWN_PERMISSIONS } from "./routes.js";
