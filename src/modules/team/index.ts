import type { PosModule } from "../types.js";
import { TeamService } from "./service.js";
import { registerRoutes } from "./routes.js";

/** Team directory (Settings → Users). Read-only over the users table; owns no
 *  tables. Registered late so the users table already exists. */
export const teamModule: PosModule = {
  name: "team",
  migrations: [],
  async register({ db, router }) {
    const service = new TeamService(db);
    registerRoutes(router, service);
  },
};

export { TeamService } from "./service.js";
export type { TeamMember } from "./service.js";
