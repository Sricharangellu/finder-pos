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

// ─── Products (Wave 1, pre-typed for MSW mocks) ───────────────────────────────
export interface Product {
  id: string;
  sku: string;
  name: string;
  /** integer cents */
  priceCents: number;
  category: string;
  taxClass: "standard" | "exempt";
  barcode?: string;
  status: "active" | "draft" | "archived";
  createdAt: number;
  updatedAt: number;
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
  items: Product[];
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

// ── Lightspeed-style retail operations (Cycle 3 backend) ───────────────────
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
}

export interface InvoicesResponse {
  items: Invoice[];
}

export interface RecordPaymentRequest {
  amountCents: number;
  method?: string;
}
