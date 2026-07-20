import type { PosModule } from "./types.js";
import { sequencesModule } from "./sequences/index.js";
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
import { insightsModule } from "./insights/index.js";
import { workflowsModule } from "./workflows/index.js";
import { ssoModule } from "./sso/index.js";
import { monitoringModule } from "./monitoring/index.js";
import { quotesModule } from "./quotes/index.js";
import { notificationsModule } from "./notifications/index.js";
import { auditLogModule } from "./audit_log/index.js";
import { loyaltyModule } from "./loyalty/index.js";
import { rlsModule } from "./rls/index.js";
import { storeLocationsModule } from "./store_locations/index.js";
import { permissionRequestsModule } from "./permission_requests/index.js";
import { productBatchesModule } from "./product_batches/index.js";
import { customerInvoicesModule } from "./customer_invoices/index.js";
import { serviceOrdersModule } from "./service_orders/index.js";
import { serialNumbersModule } from "./serial_numbers/index.js";
import { workforceModule } from "./workforce/index.js";
import { restaurantModule } from "./restaurant/index.js";
import { appointmentsModule } from "./appointments/index.js";
import { healthcareModule } from "./healthcare/index.js";
import { automotiveModule } from "./automotive/index.js";
import { hospitalityModule } from "./hospitality/index.js";
import { manufacturingModule } from "./manufacturing/index.js";
import { rentalModule } from "./rental/index.js";
import { entertainmentModule } from "./entertainment/index.js";
import { educationModule } from "./education/index.js";
import { expensesModule } from "./expenses/index.js";
import { progressModule } from "./progress/index.js";
import { businessModule } from "./business/index.js";

/**
 * Registration order = migration order. Keep dependencies earlier:
 * catalog -> inventory -> orders -> payments -> sync -> customers -> giftcards -> webhooks -> team -> outlets -> purchasing -> reports.
 */
export const modules: PosModule[] = [
  sequencesModule, // must precede modules that seed a document_counters row
  catalogModule,
  // serialNumbersModule must be registered (and thus app.use-mounted) before
  // inventoryModule: its mountPath is "/api/v1" and it registers full paths
  // starting with "/inventory/…" (e.g. "/inventory/serials"). inventoryModule
  // mounts at "/api/v1/inventory" with a "/:productId" catch-all inside, which
  // matches ANY single remaining path segment — including "serials". If
  // inventory's app.use is registered first, Express matches its mount prefix
  // first and the request never reaches this module's router at all. Found
  // 2026-07-18: GET/POST/PATCH /api/v1/inventory/serials were 100% silently
  // routed into inventory's per-product handlers instead (wrong shape, no
  // error) until this was reordered.
  serialNumbersModule,
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
  insightsModule,
  workflowsModule,
  ssoModule,
  monitoringModule,
  quotesModule,
  notificationsModule,
  auditLogModule,
  loyaltyModule,
  storeLocationsModule,
  permissionRequestsModule,
  productBatchesModule,
  customerInvoicesModule,
  serviceOrdersModule,
  workforceModule,
  restaurantModule,
  appointmentsModule,
  healthcareModule,
  automotiveModule,
  hospitalityModule,
  manufacturingModule,
  rentalModule,
  entertainmentModule,
  educationModule,
  expensesModule,
  progressModule,
  businessModule,
  rlsModule,  // must be last — runs after all tenant tables exist
];
