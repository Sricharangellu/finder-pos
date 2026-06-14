import type { PosModule } from "../types.js";
import { FulfillmentService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_LOCATIONS = `
CREATE TABLE IF NOT EXISTS locations (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT,
  kind       TEXT NOT NULL DEFAULT 'bin',
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, code)
);`;

const CREATE_PRODUCT_LOCATIONS = `
CREATE TABLE IF NOT EXISTS product_locations (
  tenant_id   TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  location_id TEXT NOT NULL,
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, product_id)
);`;

const CREATE_PICK_LISTS = `
CREATE TABLE IF NOT EXISTS pick_lists (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  order_id   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'picking',
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);`;

const CREATE_PICK_LINES = `
CREATE TABLE IF NOT EXISTS pick_list_lines (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  pick_list_id  TEXT NOT NULL,
  product_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  picked_qty    INTEGER NOT NULL DEFAULT 0,
  location_code TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS pick_lists_tenant_idx ON pick_lists (tenant_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pick_lists_order_uidx ON pick_lists (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS pick_lines_list_idx ON pick_list_lines (tenant_id, pick_list_id);`;

/** Fulfillment / WMS — locations, product placement, and pick/pack of orders. */
export const fulfillmentModule: PosModule = {
  name: "fulfillment",
  migrations: [CREATE_LOCATIONS, CREATE_PRODUCT_LOCATIONS, CREATE_PICK_LISTS, CREATE_PICK_LINES, INDEXES],
  async register({ db, router }) {
    registerRoutes(router, new FulfillmentService(db));
  },
};

export { FulfillmentService } from "./service.js";
export type { Location, PickList, PickListLine } from "./service.js";
