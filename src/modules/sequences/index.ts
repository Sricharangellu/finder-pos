import type { PosModule } from "../types.js";

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

/** Sequences — shared document-number counters. No routes. */
export const sequencesModule: PosModule = {
  name: "sequences",
  migrations: [CREATE_DOCUMENT_COUNTERS],
  register() {
    // DB-layer infrastructure only.
  },
};
