import type { PosModule } from "../types.js";
import { BusinessService } from "./service.js";
import { registerRoutes } from "./routes.js";

// ── Business separation backbone ────────────────────────────────────────────
// A tenant runs one or more BUSINESS UNITS (a retail store group, a wholesale
// operation, an ecommerce arm, …). Each unit has CHANNELS (retail_pos,
// wholesale_b2b, …), a set of enabled MODULES, and a default landing route.
// Users are granted access to specific units. This is what keeps retail and
// wholesale activity from mixing in navigation, permissions, pricing, and
// reports — the whole app reads the caller's units from GET /api/v1/me/context.
//
// This module OWNS these tables (do not create them elsewhere):
//   business_units, business_unit_locations, business_unit_channels,
//   tenant_capabilities, user_business_unit_access

const CREATE_BUSINESS_UNITS = `
CREATE TABLE IF NOT EXISTS business_units (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  modules       TEXT NOT NULL DEFAULT '[]',
  default_route TEXT NOT NULL DEFAULT '/',
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS business_units_tenant_idx ON business_units (tenant_id, created_at);
`;

const CREATE_BUSINESS_UNIT_LOCATIONS = `
CREATE TABLE IF NOT EXISTS business_unit_locations (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  business_unit_id TEXT NOT NULL,
  location_id      TEXT NOT NULL,
  created_at       BIGINT NOT NULL,
  UNIQUE (tenant_id, business_unit_id, location_id)
);
CREATE INDEX IF NOT EXISTS business_unit_locations_bu_idx ON business_unit_locations (tenant_id, business_unit_id);
`;

const CREATE_BUSINESS_UNIT_CHANNELS = `
CREATE TABLE IF NOT EXISTS business_unit_channels (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  business_unit_id TEXT NOT NULL,
  channel          TEXT NOT NULL,
  created_at       BIGINT NOT NULL,
  UNIQUE (tenant_id, business_unit_id, channel)
);
CREATE INDEX IF NOT EXISTS business_unit_channels_bu_idx ON business_unit_channels (tenant_id, business_unit_id);
`;

const CREATE_TENANT_CAPABILITIES = `
CREATE TABLE IF NOT EXISTS tenant_capabilities (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  capability  TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  UNIQUE (tenant_id, capability)
);
`;

const CREATE_USER_BU_ACCESS = `
CREATE TABLE IF NOT EXISTS user_business_unit_access (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  business_unit_id TEXT NOT NULL,
  created_at       BIGINT NOT NULL,
  UNIQUE (tenant_id, user_id, business_unit_id)
);
CREATE INDEX IF NOT EXISTS user_bu_access_user_idx ON user_business_unit_access (tenant_id, user_id);
`;

export const businessModule: PosModule = {
  name: "business",
  // Top-level resource routes (/api/v1/me/context, /api/v1/business-units).
  mountPath: "/api/v1",
  migrations: [
    CREATE_BUSINESS_UNITS,
    CREATE_BUSINESS_UNIT_LOCATIONS,
    CREATE_BUSINESS_UNIT_CHANNELS,
    CREATE_TENANT_CAPABILITIES,
    CREATE_USER_BU_ACCESS,
  ],
  async register({ db, router }) {
    const service = new BusinessService(db);
    await service.seedDemo();
    registerRoutes(router, service);
  },
};

export { BusinessService } from "./service.js";
export type { BusinessUnit, MeContext, CreateBusinessUnitInput } from "./service.js";
