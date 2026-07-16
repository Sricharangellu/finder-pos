import type { Response } from "express";
import type { PosModule } from "../types.js";
import { handler, badRequest } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { SearchService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

// Trigram GIN indexes for the ILIKE '%term%' searches below. Without these,
// every palette keystroke is a sequential scan once catalogs reach real size.
// Guarded: if the pg_trgm extension is unavailable (locked-down hosts), boot
// continues and search stays correct — just unindexed.
const TRIGRAM_SEARCH_INDEXES = `
DO $$
BEGIN
  -- Pin to public so the operator class resolves from any tenant/test schema.
  CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;
  CREATE INDEX IF NOT EXISTS products_name_trgm_idx  ON products  USING gin (name public.gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS products_sku_trgm_idx   ON products  USING gin (sku public.gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (name public.gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS suppliers_name_trgm_idx ON suppliers USING gin (name public.gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  -- Indexes are an optimization; never block boot over them (locked-down
  -- hosts without pg_trgm, extension-in-another-schema, etc.).
  RAISE NOTICE 'pg_trgm indexes skipped: %', SQLERRM;
END;
$$;`;

/** Global search (#15) — owns no tables; reads across modules for the ⌘K palette. */
export const searchModule: PosModule = {
  name: "search",
  migrations: [TRIGRAM_SEARCH_INDEXES],
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
