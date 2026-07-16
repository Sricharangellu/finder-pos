import type { PosModule } from "../types.js";
import { CREATE_EVENT_OUTBOX, CREATE_EVENT_CONSUMPTIONS } from "../../shared/outbox.js";

// Per-(tenant, kind) monotonic counters backing race-free document numbering
// (see src/shared/docnumber.ts). Registered before any module that seeds a
// counter so the table exists when those seeding migrations run.
const CREATE_DOCUMENT_COUNTERS = `
CREATE TABLE IF NOT EXISTS document_counters (
  tenant_id TEXT   NOT NULL,
  kind      TEXT   NOT NULL,
  val       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, kind)
);`;

/** Sequences — platform DB infrastructure: document-number counters, the
 *  event outbox (ACPA M1) and consumer idempotency claims (M1.3). Registered
 *  first so later modules rely on all three. */
export const sequencesModule: PosModule = {
  name: "sequences",
  migrations: [CREATE_DOCUMENT_COUNTERS, CREATE_EVENT_OUTBOX, CREATE_EVENT_CONSUMPTIONS],
  register() {
    // DB-layer infrastructure only.
  },
};
