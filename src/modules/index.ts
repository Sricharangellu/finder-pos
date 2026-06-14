import type { PosModule } from "./types.js";
import { catalogModule } from "./catalog/index.js";
import { inventoryModule } from "./inventory/index.js";
import { ordersModule } from "./orders/index.js";
import { paymentsModule } from "./payments/index.js";
import { syncModule } from "./sync/index.js";
import { customersModule } from "./customers/index.js";
import { giftcardsModule } from "./giftcards/index.js";
import { webhooksModule } from "./webhooks/index.js";
import { teamModule } from "./team/index.js";
import { outletsModule } from "./outlets/index.js";
import { purchasingModule } from "./purchasing/index.js";
import { billingModule } from "./billing/index.js";
import { fulfillmentModule } from "./fulfillment/index.js";
import { salesModule } from "./sales/index.js";
import { accountingModule } from "./accounting/index.js";
import { reportsModule } from "./reports/index.js";

/**
 * Registration order = migration order. Keep dependencies earlier:
 * catalog -> inventory -> orders -> payments -> sync -> customers -> giftcards -> webhooks -> team -> outlets -> purchasing -> reports.
 */
export const modules: PosModule[] = [
  catalogModule,
  inventoryModule,
  ordersModule,
  paymentsModule,
  syncModule,
  customersModule,
  giftcardsModule,
  webhooksModule,
  teamModule,
  outletsModule,
  purchasingModule,
  billingModule,
  fulfillmentModule,
  salesModule,
  accountingModule,
  reportsModule,
];
