/**
 * AUTO-GENERATED — do not hand-edit.
 *
 * Regenerate with:
 *   npx openapi-typescript ../contracts/openapi.yaml -o api-client/types.ts
 *
 * This file was seeded from the Wave 0 stub openapi.yaml.  When the Backend
 * agent publishes real paths, re-run the command above and commit the result.
 *
 * Until the generator can run (empty spec / no network), the types below are
 * authored to match the known contract surface described in
 * contracts/openapi.yaml + 00_EXECUTION_PROMPT_BOOK.md.  They will be
 * overwritten on the first successful generator run.
 */

// ─── Error envelope ──────────────────────────────────────────────────────────
export interface ApiError {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  /** seconds until the access token expires */
  expiresIn: number;
  refreshToken: string;
  user: UserProfile;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

// ─── Users / RBAC ─────────────────────────────────────────────────────────────
export type Role = "owner" | "manager" | "cashier";

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
}

// ─── Health / readiness ───────────────────────────────────────────────────────
export interface HealthzResponse {
  status: "ok";
  ts: number;
}

export interface ReadyzResponse {
  status: "ready" | "not_ready";
  checks: Record<string, "ok" | "fail">;
}

// ─── Feature flags ────────────────────────────────────────────────────────────
export interface FlagsResponse {
  flags: Record<string, boolean>;
}

// ─── Pagination wrapper ───────────────────────────────────────────────────────
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Products (Wave 1 terminal/cart types — camelCase, used by register flow) ──
/** Lightweight terminal product used by the register/cart flow (Wave 1). */
export interface TerminalProduct {
  id: string;
  sku: string;
  name: string;
  /** integer cents */
  priceCents: number;
  category: string;
  taxClass: "standard" | "exempt";
  barcode?: string;
  status: "active" | "draft" | "archived";
  ageRestricted?: boolean;
  restrictedStates?: string[];
  tobaccoType?: string | null;
  flavored?: boolean;
  menthol?: boolean;
  msaReportable?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RegisterSession {
  id: string;
  tenant_id: string;
  register_id: string;
  opened_by: string;
  opening_float_cents: number;
  closing_float_cents: number | null;
  counted_cash_cents: number | null;
  variance_cents: number | null;
  status: "open" | "closed";
  opened_at: number;
  closed_at: number | null;
}

// ─── Orders (Wave 1, pre-typed for MSW mocks) ─────────────────────────────────
export type OrderStatus = "open" | "completed" | "refunded" | "voided";
export type StateCode = "CA" | "NY" | "TX" | "FL";

export interface OrderLine {
  id: string;
  orderId: string;
  productId: string;
  name: string;
  quantity: number;
  /** integer cents */
  unitCents: number;
  /** integer cents */
  taxCents: number;
  /** integer cents */
  lineCents: number;
  taxable: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  stateCode: StateCode;
  status: OrderStatus;
  /** integer cents */
  subtotalCents: number;
  /** integer cents */
  discountCents: number;
  /** integer cents */
  taxCents: number;
  /** integer cents */
  totalCents: number;
  customerId?: string;
  lines: OrderLine[];
  createdAt: number;
  updatedAt: number;
}

// ─── Payments (Wave 1, pre-typed for MSW mocks) ───────────────────────────────
export type PaymentMethod = "cash" | "card" | "split";
export type PaymentStatus = "captured" | "declined";

export interface Payment {
  id: string;
  orderId: string;
  method: PaymentMethod;
  /** integer cents */
  amountCents: number;
  /** integer cents */
  cashCents: number;
  /** integer cents */
  cardCents: number;
  /** integer cents */
  changeCents: number;
  cardLast4?: string;
  authCode?: string;
  status: PaymentStatus;
  createdAt: number;
}

// ─── Catalog (Wave 1) ─────────────────────────────────────────────────────────
export interface CatalogListResponse {
  items: TerminalProduct[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Orders: create/update (Wave 1) ───────────────────────────────────────────
export interface CreateOrderRequest {
  lines: Array<{
    productId: string;
    quantity: number;
  }>;
  stateCode?: string;
}

export interface UpdateOrderRequest {
  lines: Array<{
    productId: string;
    quantity: number;
  }>;
  stateCode?: string;
}

// ─── Payments: capture (Wave 1) ───────────────────────────────────────────────
export interface CapturePaymentRequest {
  orderId: string;
  method: PaymentMethod;
  /** integer cents tendered (cash) */
  cashCents?: number;
  /** integer cents charged to card */
  cardCents?: number;
  /** EMV/card last 4 digits */
  cardLast4?: string;
}

// ─── Refund / void (Wave 1) ───────────────────────────────────────────────────
export interface RefundRequest {
  reason?: string;
}

// ─── Sync queue (offline outbox) ──────────────────────────────────────────────
export interface SyncQueueItem {
  id: string;
  type: "create_order" | "capture_payment";
  payload: unknown;
  createdAt: number;
  retryCount: number;
}

// ─── OpenAPI paths type map ───────────────────────────────────────────────────
// When openapi-typescript generates from a populated spec, this section will be
// replaced with a full paths object.  For now we define the shape manually so
// the fetch wrapper can be typed.
export interface paths {
  "/auth/login": {
    post: {
      requestBody: { content: { "application/json": LoginRequest } };
      responses: {
        200: { content: { "application/json": LoginResponse } };
        401: { content: { "application/json": ApiError } };
      };
    };
  };
  "/auth/refresh": {
    post: {
      requestBody: { content: { "application/json": RefreshRequest } };
      responses: {
        200: { content: { "application/json": RefreshResponse } };
        401: { content: { "application/json": ApiError } };
      };
    };
  };
  "/auth/logout": {
    post: {
      responses: {
        204: Record<string, never>;
        401: { content: { "application/json": ApiError } };
      };
    };
  };
  "/healthz": {
    get: {
      responses: {
        200: { content: { "application/json": HealthzResponse } };
      };
    };
  };
  "/readyz": {
    get: {
      responses: {
        200: { content: { "application/json": ReadyzResponse } };
        503: { content: { "application/json": ReadyzResponse } };
      };
    };
  };
  "/flags": {
    get: {
      responses: {
        200: { content: { "application/json": FlagsResponse } };
      };
    };
  };
}

// ── Reports (Wave 2 analytics) ──────────────────────────────────────────────
export interface SalesSummary {
  orders: {
    open: number;
    completed: number;
    refunded: number;
    voided: number;
    total: number;
  };
  revenue: {
    grossCents: number;
    taxCents: number;
    netCents: number;
  };
  payments: {
    capturedCount: number;
    capturedCents: number;
    byMethod: Record<string, number>;
  };
}

// ── Retail operations (Cycle 3 backend) ────────────────────────────────────
export interface InventoryLevel {
  id: string;
  sku: string;
  name: string;
  category: string;
  status: "active" | "draft" | "archived" | string;
  priceCents: number;
  onHand: number;
  committed: number;
  available: number;
  reorderPoint: number;
  lowStock: boolean;
  costCents: number | null;
  velocity: number;
}

export interface InventoryLevelsResponse {
  pageSize: number;
  items: InventoryLevel[];
}

export interface Supplier {
  id: string;
  name: string;
  email: string | null;
}

export interface SuppliersResponse {
  items: Supplier[];
}

export interface PurchaseOrderLine {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost_cents: number;
  line_cost_cents: number;
}

export interface PurchaseOrder {
  id: string;
  supplier_id: string;
  status: "ordered" | "received" | string;
  total_cost_cents: number;
  created_at: number;
  received_at: number | null;
  lines?: PurchaseOrderLine[];
}

export interface PurchaseOrdersResponse {
  items: PurchaseOrder[];
}

export interface CreatePurchaseOrderLineRequest {
  productId: string;
  quantity: number;
  unitCostCents: number;
  expiryDate?: number;
  lotCode?: string;
}

export interface CreatePurchaseOrderRequest {
  supplierId: string;
  lines: CreatePurchaseOrderLineRequest[];
}

export interface RetailCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  points: number;
  created_at?: number;
}

export interface CustomersResponse {
  items: RetailCustomer[];
}

export interface CustomerSummary {
  customer: RetailCustomer;
  visits: number;
  totalSpentCents: number;
  avgOrderCents: number;
  lastVisitAt: number | null;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    createdAt: number;
  }>;
}

export interface TopProduct {
  productId: string;
  name: string;
  units: number;
  revenueCents: number;
}

export interface TopProductsResponse {
  items: TopProduct[];
}

export interface SalesByProductItem {
  productId: string;
  sku: string;
  name: string;
  category: string;
  units: number;
  revenueCents: number;
  costCents: number;
  marginPct: number;
}

export interface SalesByProductResponse {
  items: SalesByProductItem[];
}

export interface MarginByCategoryItem {
  category: string;
  revenueCents: number;
  costCents: number;
  marginPct: number;
  units: number;
}

export interface MarginByCategoryResponse {
  items: MarginByCategoryItem[];
}

export interface InventoryValuationRow {
  productId: string;
  name: string;
  stockQty: number;
  costCents: number;
  retailCents: number;
  costValueCents: number;
  retailValueCents: number;
}

export interface InventoryValuationResponse {
  rows: InventoryValuationRow[];
  totalCostCents: number;
  totalRetailCents: number;
}

export interface LowStockItem {
  id: string;
  sku: string;
  name: string;
  stock_qty: number;
  reorder_pt: number;
  category: string;
}

export interface Register {
  id: string;
  name: string;
  status: "open" | "closed" | string;
  outlet_id: string;
}

export interface Outlet {
  id: string;
  name: string;
  timezone: string;
  registers: Register[];
}

export interface OutletsResponse {
  items: Outlet[];
}

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

export interface AgingRow {
  partyId: string;
  buckets: AgingBuckets;
}

export interface AgingReport {
  totals: AgingBuckets;
  parties: AgingRow[];
}

export type BillingStatus = "open" | "partial" | "paid" | "void";

export interface Bill {
  id: string;
  supplier_id: string;
  po_id: string | null;
  bill_number: string;
  status: BillingStatus;
  total_cents: number;
  paid_cents: number;
  due_date: number | null;
  issued_at: number;
}

export interface BillsResponse {
  items: Bill[];
}

export interface Invoice {
  id: string;
  customer_id: string;
  order_id: string | null;
  invoice_number: string;
  status: BillingStatus;
  total_cents: number;
  paid_cents: number;
  due_date: number | null;
  issued_at: number;
  dunning_level?: 0 | 1 | 2 | 3 | null;
}

export interface InvoicesResponse {
  items: Invoice[];
}

export interface RecordPaymentRequest {
  amountCents: number;
  method?: string;
}

// ─── Catalog (BE-6/BE-7/BE-8) ────────────────────────────────────────────────
export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  /** integer cents */
  price_cents: number;
  /** legacy single category string */
  category: string;
  tax_class: "standard" | "exempt";
  barcode?: string;
  status: "active" | "draft" | "archived";
  description?: string;
  brand?: string;
  length_mm?: number;
  width_mm?: number;
  height_mm?: number;
  weight_grams?: number;
  image_url?: string;
  preferred_vendor_id?: string;
  vendor_upc?: string;
  min_qty_to_sell?: number;
  max_qty_to_sell?: number;
  qty_increment?: number;
  parent_product_id?: string;
  variant_label?: string;
  tobacco_type?: string | null;
  flavored?: number;
  menthol?: number;
  msa_reportable?: number;
  restricted_states?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CatalogCategory {
  id: string;
  name: string;
  parent_id: string | null;
  tenant_id: string;
}

export interface CatalogProductsResponse {
  items: CatalogProduct[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CatalogCategoriesResponse {
  items: CatalogCategory[];
}

export interface CatalogBarcode {
  barcode: string;
  kind: string;
  packSize?: number;
}

export interface CatalogBarcodesResponse {
  items: CatalogBarcode[];
}

// ─── Accounting ───────────────────────────────────────────────────────────────

export type AccountType = "asset" | "liability" | "income" | "expense";

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType | string;
  parent_id?: string | null;
  is_active: number; // 1 = active, 0 = inactive (SQLite integer)
}

export interface AccountsResponse {
  items: Account[];
}

export type DepositStatus = "pending_approval" | "approved" | "rejected";

export interface Deposit {
  id: string;
  batch_number: string;
  description?: string | null;
  note?: string | null;
  status: DepositStatus | string;
  total_cents: number;
  account_id: string;
  created_at: number;
}

export interface DepositsResponse {
  items: Deposit[];
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ShippingMethod {
  id: string;
  name: string;
  amount_cents: number;
  free_limit_cents?: number | null;
  ecommerce?: number | boolean | null;
  sequence?: number;
}

export interface ShippingMethodsResponse {
  items: ShippingMethod[];
}

export interface PaymentTerm {
  id: string;
  name: string;
  days_due: number;
  description?: string | null;
}

export interface PaymentTermsResponse {
  items: PaymentTerm[];
}

export interface PaymentMode {
  id: string;
  name: string;
  active?: number;
}

export interface PaymentModesResponse {
  items: PaymentMode[];
}

export interface TaxRate {
  id: string;
  name: string;
  rate_bps: number;
  apply_to_category?: string | null;
  state?: string | null;
}

export interface TaxRatesResponse {
  items: TaxRate[];
}

// ─── Sales (Quotations & Sales Orders) ───────────────────────────────────────

export type QuotationStatus = "draft" | "sent" | "accepted" | "cancelled" | "expired";

export interface Quotation {
  id: string;
  quote_number: string;
  customer_id: string;
  status: QuotationStatus | string;
  total_cents: number;
  created_at: number;
}

export interface QuotationsResponse {
  items: Quotation[];
}

export type SalesOrderStatus = "pending_approve" | "approved" | "fulfilled" | "cancelled";

export interface SalesOrder {
  id: string;
  so_number: string;
  customer_id: string;
  status: SalesOrderStatus | string;
  total_cents: number;
  store_id: string | null;
  created_at: number;
}

export interface SalesOrdersResponse {
  items: SalesOrder[];
}

// ─── Shipping ─────────────────────────────────────────────────────────────────

export type ShipmentStatus = "pending" | "shipped" | "delivered" | "cancelled";

export interface Shipment {
  id: string;
  ship_number: string;
  invoice_id: string;
  status: ShipmentStatus | string;
  method: string;
  carrier: string | null;
  tracking_number: string | null;
}

export interface ShipmentsResponse {
  items: Shipment[];
}

// ─── Fulfillment (Locations & Pick Lists) ────────────────────────────────────

export interface FulfillmentLocation {
  id: string;
  code: string;
  name?: string;
  kind?: string;
  type?: string;
  description?: string;
}

export interface FulfillmentLocationsResponse {
  items: FulfillmentLocation[];
}

export interface PickListLine {
  id: string;
  product_id: string;
  quantity: number;
  picked_qty: number;
  status: string;
}

export type PickListStatus = "picking" | "picked" | "packed";

export interface PickList {
  id: string;
  pick_number?: string;
  status: PickListStatus | string;
  assigned_to?: string;
  created_at: number;
  lines?: PickListLine[];
  line_count?: number;
}

export interface PickListsResponse {
  items: PickList[];
}

// ─── Discounts ────────────────────────────────────────────────────────────────

export type RuleType = "simple" | "volume" | "bxgy";
export type DiscountType = "fixed" | "percent";
export type ApplyTo = "order" | "product" | "category";
export type DiscountStatus = "active" | "paused" | "archived";

export interface Discount {
  id: string;
  name: string;
  coupon_code: string | null;
  rule_type: RuleType;
  discount_type: DiscountType;
  value: number;
  apply_to: ApplyTo;
  status: DiscountStatus;
  auto_applicable: number;
  used_count: number;
  usage_limit?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  min_order_cents?: number | null;
  min_qty?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  tier_restriction?: number | null;
  per_customer_limit?: number | null;
}

export interface DiscountsResponse {
  items: Discount[];
}

// ─── Ecommerce ────────────────────────────────────────────────────────────────

export interface OnlineOrder {
  id: string;
  so_number?: string;
  /** camelCase alias some mock handlers return */
  orderNumber?: string;
  customer_id?: string;
  /** display name returned by some handlers */
  customerName?: string;
  status: string;
  total_cents?: number;
  /** camelCase alias some mock handlers return */
  totalCents?: number;
  created_at?: number;
  /** camelCase alias some mock handlers return */
  createdAt?: number;
}

export interface OnlineOrdersResponse {
  items: OnlineOrder[];
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export type ProductStatus = "active" | "draft" | "archived";
export type TaxClass = "standard" | "exempt";

export interface Product {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  price_cents: number;
  category: string;
  tax_class: TaxClass;
  barcode: string | null;
  status: ProductStatus;
  created_at: number;
  updated_at: number;
  // Descriptive
  description: string | null;
  brand: string | null;
  manufacturer: string | null;
  tags: string | null;
  image_url: string | null;
  // Pricing
  msrp_cents: number | null;
  raw_cost_price_cents: number | null;
  wholesale_price_cents: number | null;
  // Dimensions
  weight_grams: number | null;
  // Vendor
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  vendor_upc: string | null;
  reorder_quantity: number | null;
  // Qty limits
  min_qty_to_sell: number | null;
  max_qty_to_sell: number | null;
  qty_increment: number;
  // Variant
  parent_product_id: string | null;
  variant_label: string | null;
  // Flags (1|0)
  age_restricted: number;
  returnable: number;
  track_inventory: number;
  ecommerce: number;
}

export interface ProductsResponse {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
}

export interface CategoriesResponse {
  items: Category[];
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export type TriggerCondition =
  | "age_verification"
  | "loyalty_capture"
  | "id_scan"
  | "customer_required"
  | "signature_required"
  | "custom_prompt";

export type StepType = "prompt" | "gate" | "capture" | "external_api";

export interface WorkflowStep {
  id: string;
  workflowId: string;
  tenantId: string;
  name: string;
  stepType: StepType;
  triggerCondition: TriggerCondition;
  config: Record<string, unknown>;
  position: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowDefinition {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  outletId: string | null;
  enabled: boolean;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowsResponse {
  items: WorkflowDefinition[];
}

// ─── Global Search (⌘K command palette) ──────────────────────────────────────
export type SearchHitType =
  | "product"
  | "customer"
  | "vendor"
  | "invoice"
  | "sales_order"
  | "quotation"
  | "purchase_order"
  | "order";

export interface SearchHit {
  type: SearchHitType;
  id: string;
  label: string;
  sublabel?: string;
}

/** Keyed by group name (e.g. "products", "customers", "orders"). */
export type SearchResults = Record<string, SearchHit[]>;

export interface SearchResponse {
  query: string;
  results: SearchResults;
}

// ─── Loyalty Program ──────────────────────────────────────────────────────────

/** The tier level label displayed to customers. */
export type LoyaltyTierLevel = "bronze" | "silver" | "gold" | "platinum";

/**
 * A loyalty tier. Customers are promoted when their lifetime points
 * reach `points_required`. Higher tiers receive a larger `discount_pct`.
 */
export interface LoyaltyTier {
  id: string;
  name: string;
  level: LoyaltyTierLevel;
  /** Lifetime points needed to reach this tier. */
  points_required: number;
  /** Percentage discount (0–100) applied to every purchase at this tier. */
  discount_pct: number;
  /** Optional description shown in customer-facing materials. */
  description: string | null;
  /** Number of members currently in this tier (read-only, computed). */
  member_count: number;
  created_at: number;
  updated_at: number;
}

export interface LoyaltyTiersResponse {
  items: LoyaltyTier[];
}

/**
 * A customer enrolled in the loyalty programme.
 * Points are earned at a rate configured in loyalty settings.
 */
export interface LoyaltyMember {
  id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  tier_id: string;
  tier_name: string;
  tier_level: LoyaltyTierLevel;
  /** Current redeemable points balance. */
  points_balance: number;
  /** Total points ever earned (used for tier promotion). */
  points_lifetime: number;
  /** ISO date the customer enrolled. */
  joined_at: number;
  last_activity_at: number | null;
}

export interface LoyaltyMembersResponse {
  items: LoyaltyMember[];
  total: number;
}

/** Status of a loyalty reward offer. */
export type LoyaltyRewardStatus = "active" | "inactive" | "archived";

/**
 * A redeemable reward. Members spend `points_cost` to receive
 * `discount_cents` off a future purchase (or a free item).
 */
export interface LoyaltyReward {
  id: string;
  name: string;
  description: string | null;
  /** Points a member must spend to redeem this reward. */
  points_cost: number;
  /** Discount value in integer cents. */
  discount_cents: number;
  status: LoyaltyRewardStatus;
  /** How many times this reward has been redeemed in total. */
  redemption_count: number;
  created_at: number;
  updated_at: number;
}

export interface LoyaltyRewardsResponse {
  items: LoyaltyReward[];
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationSeverity = "info" | "warning" | "critical";
export type NotificationType =
  | "low_stock"
  | "payment_failed"
  | "new_order"
  | "order_fulfilled"
  | "purchase_order_received"
  | "sync_error"
  | "system";

export interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** ID of the related resource (order, product, etc.), if any. */
  resource_id: string | null;
  resource_type: string | null;
  read: boolean;
  created_at: number;
}

export interface NotificationsResponse {
  items: Notification[];
  total: number;
  unread_count: number;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditAction =
  | "created"
  | "updated"
  | "deleted"
  | "login"
  | "logout"
  | "exported"
  | "refunded"
  | "voided"
  | "approved"
  | "rejected";

export interface AuditActor {
  id: string;
  email: string;
  role: string;
}

export interface AuditEvent {
  id: string;
  actor: AuditActor;
  action: AuditAction;
  resource_type: string;
  resource_id: string;
  resource_label: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  ip_address: string | null;
  created_at: number;
}

export interface AuditLogResponse {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

// ── Service Orders ────────────────────────────────────────────────────────────

export type ServiceOrderStatus =
  | "draft"
  | "open"
  | "in_progress"
  | "ready"
  | "closed";

export interface ServiceOrder {
  id: string;
  customer_id: string;
  customer_name: string;
  title: string;
  description: string;
  status: ServiceOrderStatus;
  assigned_to: string | null;
  assigned_to_name: string | null;
  estimate_cents: number;
  actual_cents: number | null;
  created_at: number;
  updated_at: number;
}

export interface ServiceOrderResponse {
  items: ServiceOrder[];
  total: number;
  limit: number;
  offset: number;
}

// ── Store Locations ───────────────────────────────────────────────────────────

export interface StoreLocation {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  aisle: string;
  shelf: string;
  bin: string;
  label: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProductLocation {
  id: string;
  product_id: string;
  location_id: string;
  qty_at_location: number;
  notes: string | null;
  aisle: string;
  shelf: string;
  bin: string;
  label: string;
  product_name: string;
  product_sku: string;
  created_at: number;
  updated_at: number;
}

export interface StoreMapBin {
  location: StoreLocation;
  products: ProductLocation[];
}

export interface StoreMapShelf {
  name: string;
  bins: StoreMapBin[];
}

export interface StoreMapAisle {
  name: string;
  shelves: StoreMapShelf[];
}

export interface StoreMap {
  aisles: StoreMapAisle[];
}

// ── Product Batches / Expiry ──────────────────────────────────────────────────

export type ExpiryStatus = "expired" | "critical" | "warning" | "ok";

export interface ProductBatch {
  id: string;
  product_id: string;
  batch_number: string;
  expiry_date: number | null;
  qty: number;
  cost_cents: number;
  received_at: number;
  supplier_name: string | null;
  notes: string | null;
  product_name: string;
  product_sku: string;
  category: string;
  expiry_status: ExpiryStatus | undefined;
  days_until_expiry: number | null;
  created_at: number;
  updated_at: number;
}

export interface ExpirySummary {
  expired: number;
  critical: number;
  warning: number;
  ok: number;
  expired_qty: number;
  critical_qty: number;
  warning_qty: number;
}

// ── Customer Invoices ─────────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "void";

export interface CustomerInvoiceLine {
  id: string;
  invoice_id: string;
  product_id: string | null;
  upc: string | null;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_rate_pct: number;
  line_total_cents: number;
  sort_order: number;
}

export interface CustomerInvoice {
  id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  billing_address: string | null;
  status: InvoiceStatus;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  paid_cents: number;
  due_date: number | null;
  paid_at: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  lines?: CustomerInvoiceLine[];
}

export interface CustomerInvoiceResponse {
  items: CustomerInvoice[];
  total: number;
}

// ─── Serialized Inventory (FE-17 / BE-24) ────────────────────────────────────
export type SerialStatus = "in_stock" | "sold" | "returned" | "service";

export interface SerialNumber {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  serial: string;
  status: SerialStatus;
  sold_at: number | null;
  service_order_id: string | null;
  received_at: number;
  notes: string | null;
  created_at: number;
}

export interface SerialsResponse {
  items: SerialNumber[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Workforce / Employee Scheduling (FE-18) ──────────────────────────────────
export type ShiftRole = "cashier" | "manager" | "stock" | "supervisor" | "delivery";

export interface Employee {
  id: string;
  name: string;
  role: ShiftRole;
  email: string;
  avatar_color: string;
}

export interface Shift {
  id: string;
  employee_id: string;
  employee_name: string;
  role: ShiftRole;
  date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface ShiftsResponse {
  items: Shift[];
  total: number;
}

export type TimeOffStatus = "pending" | "approved" | "denied";

export interface TimeOffRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  date_from: string;
  date_to: string;
  reason: string | null;
  status: TimeOffStatus;
  created_at: number;
}

// ─── Customer Contacts + Addresses (FE-22 / BE-26) ───────────────────────────
export interface CustomerContact {
  id: string;
  customer_id: string;
  contact_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: number;
  updated_at: number;
}

export interface CustomerAddress {
  id: string;
  customer_id: string;
  address_type: "billing" | "shipping" | string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string;
  county: string | null;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

// ── Reorder Suggestions (BE-27) ───────────────────────────────────────────────
export interface ReorderSuggestion {
  product_id: string;
  product_name: string;
  sku: string | null;
  stock_qty: number;
  reorder_pt: number;
  suggested_qty: number;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
}

export interface ReorderSuggestionsResponse {
  items: ReorderSuggestion[];
}

// ── Sales Reps (BE-29) ────────────────────────────────────────────────────────
export interface SalesRep {
  id: string;
  name: string;
  email: string | null;
  commission_pct: number;
  active: boolean;
  created_at: number;
}

export interface SalesRepsResponse {
  items: SalesRep[];
}

export interface SalesRepPerformance {
  rep_id: string;
  rep_name: string;
  total_revenue_cents: number;
  order_count: number;
  avg_deal_cents: number;
  from_ts: number;
  to_ts: number;
}

// ── Cycle Count Sessions (BE-10 / FE-26) ─────────────────────────────────────
export type CycleCountStatus = "open" | "closed";

export interface CycleCountSession {
  id: string;
  status: CycleCountStatus;
  opened_by: string;
  opened_at: number;
  closed_at: number | null;
  note: string | null;
}

export interface CycleCountSessionsResponse {
  items: CycleCountSession[];
}

export interface CycleCountLine {
  id: string;
  session_id: string;
  product_id: string;
  product_name?: string;
  sku?: string | null;
  expected_qty: number;
  counted_qty: number | null;
  variance: number | null;
  recorded_at: number | null;
}

export interface CycleCountLinesResponse {
  items: CycleCountLine[];
}

