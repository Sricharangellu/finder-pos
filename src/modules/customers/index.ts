import type { PosModule } from "../types.js";
import { CustomersService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_CUSTOMERS_TABLE = `
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  points      BIGINT NOT NULL DEFAULT 0,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);
`;

const CREATE_CUSTOMERS_INDEXES = `
CREATE INDEX IF NOT EXISTS customers_tenant_created_idx ON customers (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS customers_tenant_email_idx ON customers (tenant_id, email);
`;

// Wave B — B2B customer profile + financial fields (idempotent ALTERs).
const ADD_PROFILE_COLUMNS = `
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tier INTEGER NOT NULL DEFAULT 5;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS dba TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS license_no TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shipping_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_rep_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS store_credit_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS excess_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit_cents BIGINT;
`;

// Customer type: 'retail' (B2C) or 'business' (B2B). contact_person is the named
// rep at a business account (separate from the company name). date_of_birth is stored
// as epoch ms — used for age-restricted product verification and birthday rewards.
const ADD_CUSTOMER_TYPE_FIELDS = `
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'retail';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth BIGINT;
CREATE INDEX IF NOT EXISTS customers_tenant_type_idx ON customers (tenant_id, customer_type);
`;

// Customer template XLSX columns. Regulatory/compliance license tracking is critical
// for tobacco/vape distribution businesses (tobacco, cigarette, vapor, hemp, sales tax IDs).
// Structured address fields (address1/city/zip/county) replace the single billing_address blob
// for import/export compatibility; billing_address is kept for backward compat.
// first_name/last_name split enables proper addressing while name stays as display name.
// payment_term_days is the AP/AR net term (e.g. Net 30 = 30). ach_verified tracks whether
// the customer's ACH bank details have been verified for e-check payments.
const ADD_CUSTOMER_XLSX_FIELDS = `
ALTER TABLE customers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_term_days INTEGER;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS fein_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tobacco_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tobacco_license_expiry BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cigarette_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cigarette_license_expiry BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vapor_tax_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vapor_tax_expiry BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_tax_id TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_tax_expiry BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS driving_license_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS hemp_license_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS hemp_license_expiry BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ach_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_rep_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS primary_business TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address1 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address2 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS county TEXT;
`;

// Configurable loyalty tier rules: Bronze/Silver/Gold/Platinum (or any names).
// tier_level maps to customers.tier (1 = entry/lowest, 5 = top). Each rule sets
// the point multiplier earned and the auto-discount on purchase for that tier.
const CREATE_LOYALTY_TIER_RULES = `
CREATE TABLE IF NOT EXISTS loyalty_tier_rules (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  name             TEXT NOT NULL,
  tier_level       INTEGER NOT NULL,
  min_points       INTEGER NOT NULL DEFAULT 0,
  point_multiplier REAL NOT NULL DEFAULT 1.0,
  discount_pct     REAL NOT NULL DEFAULT 0.0,
  created_at       BIGINT NOT NULL,
  updated_at       BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_tier_rules_tenant_level_idx ON loyalty_tier_rules (tenant_id, tier_level);
`;

/**
 * Customers + loyalty. Tenant-scoped. Reacts to `payment.captured`: looks up the
 * paid order's customer and awards loyalty points ($1 net spent = 1 point).
 * Net spent = amountCents − changeCents (i.e. the order total, change excluded).
 */
const CREATE_CUSTOMER_ADDRESSES = `
CREATE TABLE IF NOT EXISTS customer_addresses (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  customer_id   TEXT NOT NULL,
  address_type  TEXT NOT NULL DEFAULT 'billing',
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  state         TEXT,
  zip           TEXT,
  country       TEXT NOT NULL DEFAULT 'US',
  county        TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses (tenant_id, customer_id);
`;

const CREATE_CUSTOMER_CONTACTS = `
CREATE TABLE IF NOT EXISTS customer_contacts (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  customer_id   TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  title         TEXT,
  email         TEXT,
  phone         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_contacts_customer_idx ON customer_contacts (tenant_id, customer_id);
`;

const CREATE_CUSTOMER_GROUPS = `
CREATE TABLE IF NOT EXISTS customer_groups (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_group_members (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  customer_id       TEXT NOT NULL,
  customer_group_id TEXT NOT NULL,
  created_at        BIGINT NOT NULL,
  CONSTRAINT customer_group_members_unique UNIQUE (tenant_id, customer_id, customer_group_id)
);
CREATE INDEX IF NOT EXISTS customer_group_members_customer_idx ON customer_group_members (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS customer_group_members_group_idx ON customer_group_members (tenant_id, customer_group_id);
`;

const CREATE_CUSTOMER_NOTES = `
CREATE TABLE IF NOT EXISTS customer_notes (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  note        TEXT NOT NULL,
  note_type   TEXT NOT NULL DEFAULT 'general',
  created_by  TEXT,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_notes_customer_idx ON customer_notes (tenant_id, customer_id, created_at DESC);
`;

export const customersModule: PosModule = {
  name: "customers",
  migrations: [CREATE_CUSTOMERS_TABLE, CREATE_CUSTOMERS_INDEXES, ADD_PROFILE_COLUMNS, ADD_CUSTOMER_TYPE_FIELDS, ADD_CUSTOMER_XLSX_FIELDS, CREATE_LOYALTY_TIER_RULES, CREATE_CUSTOMER_ADDRESSES, CREATE_CUSTOMER_CONTACTS, CREATE_CUSTOMER_GROUPS, CREATE_CUSTOMER_NOTES],
  async register({ db, events, router }) {
    const service = new CustomersService(db, events);

    events.on("payment.captured", async (event) => {
      const p = event.payload as {
        tenantId?: string;
        orderId?: string;
        amountCents?: number;
        changeCents?: number;
      };
      const tenantId = p.tenantId ?? "";
      const orderId = p.orderId ?? "";
      if (!tenantId || !orderId) return;
      const customerId = await service.customerForOrder(orderId, tenantId);
      if (!customerId) return; // walk-in / no loyalty account
      const netSpent = (p.amountCents ?? 0) - (p.changeCents ?? 0);
      const points = Math.floor(netSpent / 100);
      await service.awardPoints(customerId, points, tenantId);
    });

    registerRoutes(router, service);
  },
};

export { CustomersService } from "./service.js";
export type { Customer, CreateCustomerInput } from "./service.js";
