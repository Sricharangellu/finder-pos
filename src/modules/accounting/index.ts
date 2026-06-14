import type { PosModule } from "../types.js";
import { AccountingService } from "./service.js";
import { registerRoutes } from "./routes.js";

const CREATE_ACCOUNTS = `
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  parent_id  TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  UNIQUE (tenant_id, code)
);`;

const CREATE_BATCH_DEPOSITS = `
CREATE TABLE IF NOT EXISTS batch_deposits (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  batch_number TEXT NOT NULL,
  description  TEXT,
  account_id   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending_approval',
  total_cents  BIGINT NOT NULL,
  deposit_date BIGINT,
  created_at   BIGINT NOT NULL,
  decided_at   BIGINT,
  UNIQUE (tenant_id, batch_number)
);`;

const CREATE_DEPOSIT_ITEMS = `
CREATE TABLE IF NOT EXISTS batch_deposit_items (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  batch_id     TEXT NOT NULL,
  payment_id   TEXT NOT NULL,
  amount_cents BIGINT NOT NULL
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS accounts_tenant_type_idx ON accounts (tenant_id, type, code);
CREATE INDEX IF NOT EXISTS batch_deposits_tenant_status_idx ON batch_deposits (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS deposit_items_batch_idx ON batch_deposit_items (tenant_id, batch_id);`;

/** Accounting — Chart of Accounts + Batch Deposits (ERP benchmark #9). */
export const accountingModule: PosModule = {
  name: "accounting",
  migrations: [CREATE_ACCOUNTS, CREATE_BATCH_DEPOSITS, CREATE_DEPOSIT_ITEMS, INDEXES],
  register({ db, router }) {
    registerRoutes(router, new AccountingService(db));
  },
};

export { AccountingService } from "./service.js";
export type { Account, AccountNode, AccountType, BatchDeposit, BatchDepositItem, DepositStatus } from "./service.js";
