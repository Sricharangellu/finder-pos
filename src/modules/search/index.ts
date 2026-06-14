import type { Response } from "express";
import type { PosModule } from "../types.js";
import { handler, badRequest } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { SearchService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

/** Global search (#15) — owns no tables; reads across modules for the ⌘K palette. */
export const searchModule: PosModule = {
  name: "search",
  migrations: [],
  register({ db, router }) {
    const service = new SearchService(db);
    router.get("/", handler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      if (q.trim().length < 1) throw badRequest("q is required");
      const type = typeof req.query.type === "string" ? req.query.type : undefined;
      res.json({ query: q, results: await service.search(q, tenantId(res), type) });
    }));
  },
};

export { SearchService } from "./service.js";
