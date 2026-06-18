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
import { customRolesModule } from "./custom_roles/index.js";
import { outletsModule } from "./outlets/index.js";
import { purchasingModule } from "./purchasing/index.js";
import { billingModule } from "./billing/index.js";
import { fulfillmentModule } from "./fulfillment/index.js";
import { salesModule } from "./sales/index.js";
import { accountingModule } from "./accounting/index.js";
import { shippingModule } from "./shipping/index.js";
import { discountsModule } from "./discounts/index.js";
import { settingsModule } from "./settings/index.js";
import { searchModule } from "./search/index.js";
import { ecommerceModule } from "./ecommerce/index.js";
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
  customRolesModule,
  outletsModule,
  purchasingModule,
  billingModule,
  fulfillmentModule,
  salesModule,
  accountingModule,
  shippingModule,
  discountsModule,
  settingsModule,
  searchModule,
  ecommerceModule,
  reportsModule,
];
