/**
 * MSW request handlers — mock every known API path.
 *
 * These handlers are the offline stand-in for the backend.
 * They mirror the contract in contracts/openapi.yaml and the types in
 * api-client/types.ts.
 *
 * Toggle individual endpoints from mock → live by removing them from this
 * file once the backend ships the real route.
 */

import { http, HttpResponse, delay } from "msw";
import type {
  LoginResponse,
  RefreshResponse,
  HealthzResponse,
  ReadyzResponse,
  FlagsResponse,
  UserProfile,
  TerminalProduct,
  CatalogListResponse,
  Order,
  OrderLine,
  Payment,
  CreateOrderRequest,
  UpdateOrderRequest,
  CapturePaymentRequest,
  SalesSummary,
} from "@/api-client/types";
import { lightspeedHandlers } from "./lightspeedHandlers";

// Match both relative (browser) and absolute (Node/test) URL forms.
const IDENTITY = "*/api/identity";
const V1 = "*/api/v1";
const ROOT = "*";

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_USER: UserProfile = {
  id: "usr_01hx0000000000000000000001",
  email: "cashier@finder-pos.dev",
  name: "Demo Cashier",
  role: "cashier",
  tenantId: "ten_01hx0000000000000000000001",
};

const VALID_REFRESH_TOKEN = "mock-refresh-token-dev";

// ─── Mock catalog ─────────────────────────────────────────────────────────────

const MOCK_PRODUCTS: TerminalProduct[] = [
  {
    id: "prod_001",
    sku: "LATTE-12",
    name: "Latte",
    priceCents: 499,
    category: "Coffee",
    taxClass: "standard",
    barcode: "123456789",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_002",
    sku: "ESPRESSO-8",
    name: "Espresso",
    priceCents: 299,
    category: "Coffee",
    taxClass: "standard",
    barcode: "123456790",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_003",
    sku: "CAPPUCCINO-12",
    name: "Cappuccino",
    priceCents: 449,
    category: "Coffee",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_004",
    sku: "CROISSANT-1",
    name: "Butter Croissant",
    priceCents: 325,
    category: "Pastry",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_005",
    sku: "MUFFIN-1",
    name: "Blueberry Muffin",
    priceCents: 349,
    category: "Pastry",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_006",
    sku: "COLD-BREW-12",
    name: "Cold Brew",
    priceCents: 549,
    category: "Cold Drinks",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_007",
    sku: "OJ-8",
    name: "Orange Juice",
    priceCents: 399,
    category: "Cold Drinks",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_008",
    sku: "WATER-1",
    name: "Sparkling Water",
    priceCents: 199,
    category: "Cold Drinks",
    taxClass: "exempt",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_009",
    sku: "MATCHA-12",
    name: "Matcha Latte",
    priceCents: 529,
    category: "Specialty",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_010",
    sku: "MOCHA-12",
    name: "Mocha",
    priceCents: 519,
    category: "Coffee",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_011",
    sku: "SCONE-1",
    name: "Plain Scone",
    priceCents: 275,
    category: "Pastry",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_012",
    sku: "CHAI-12",
    name: "Chai Latte",
    priceCents: 479,
    category: "Specialty",
    taxClass: "standard",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: "prod_013",
    sku: "BEER-355ML",
    name: "Craft Beer (355ml)",
    priceCents: 699,
    category: "Alcohol",
    taxClass: "standard",
    status: "active",
    ageRestricted: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

// ─── Mock order store (in-memory for dev session) ─────────────────────────────

interface MockOrder extends Order {
  _paymentId?: string;
}

const orderStore = new Map<string, MockOrder>();
let orderCounter = 1;

function makeMockOrderId(): string {
  return `ord_${String(orderCounter++).padStart(8, "0")}`;
}

function makeMockPaymentId(): string {
  return `pay_${Math.random().toString(36).slice(2, 12)}`;
}

/** Compute totals from lines. Tax = 8.5% on taxable items (integer cents). */
function computeOrderTotals(
  lines: Array<{ productId: string; quantity: number }>
): Omit<Order, "id" | "orderNumber" | "status" | "createdAt" | "updatedAt" | "lines"> & {
  lines: OrderLine[];
} {
  const orderLines: OrderLine[] = lines.map((l, i) => {
    const product = MOCK_PRODUCTS.find((p) => p.id === l.productId);
    if (!product) throw new Error(`Product ${l.productId} not found`);
    const unitCents = product.priceCents;
    const lineCents = unitCents * l.quantity;
    const taxable = product.taxClass === "standard";
    // 8.5% tax, integer arithmetic, floor
    const taxCents = taxable ? Math.floor((lineCents * 85) / 1000) : 0;
    return {
      id: `line_${i + 1}`,
      orderId: "",
      productId: l.productId,
      name: product.name,
      quantity: l.quantity,
      unitCents,
      taxCents,
      lineCents,
      taxable,
    };
  });

  const subtotalCents = orderLines.reduce((s, l) => s + l.lineCents, 0);
  const taxCents = orderLines.reduce((s, l) => s + l.taxCents, 0);
  const discountCents = 0;
  const totalCents = subtotalCents + taxCents - discountCents;

  return {
    stateCode: "CA",
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
    lines: orderLines,
  };
}

// ─── Simulated latency ────────────────────────────────────────────────────────

const LAT = { min: 80, max: 200 } as const;
const latency = () =>
  delay(Math.floor(Math.random() * (LAT.max - LAT.min) + LAT.min));

// ─── Handlers ────────────────────────────────────────────────────────────────

export const handlers = [
  // ── POST /api/identity/login ─────────────────────────────────────────────
  http.post(`${IDENTITY}/login`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as { email?: string; password?: string };

    if (!body.email || !body.password) {
      return HttpResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "email and password are required",
            requestId: mockRequestId(),
          },
        },
        { status: 400 }
      );
    }

    if (body.password === "wrong") {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid email or password",
            requestId: mockRequestId(),
          },
        },
        { status: 401 }
      );
    }

    const response: LoginResponse = {
      accessToken: `mock-access-token.${Date.now()}`,
      expiresIn: 900,
      refreshToken: VALID_REFRESH_TOKEN,
      user: {
        ...MOCK_USER,
        email: body.email,
      },
    };

    return HttpResponse.json(response, { status: 200 });
  }),

  // ── POST /api/identity/refresh ───────────────────────────────────────────
  http.post(`${IDENTITY}/refresh`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as { refreshToken?: string };

    if (body.refreshToken !== VALID_REFRESH_TOKEN) {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_REFRESH_TOKEN",
            message: "Refresh token is invalid or expired",
            requestId: mockRequestId(),
          },
        },
        { status: 401 }
      );
    }

    const response: RefreshResponse = {
      accessToken: `mock-access-token.${Date.now()}`,
      expiresIn: 900,
    };

    return HttpResponse.json(response, { status: 200 });
  }),

  // ── GET /healthz ─────────────────────────────────────────────────────────
  http.get(`${ROOT}/healthz`, async () => {
    const response: HealthzResponse = { status: "ok", ts: Date.now() };
    return HttpResponse.json(response, { status: 200 });
  }),

  // ── GET /readyz ──────────────────────────────────────────────────────────
  http.get(`${ROOT}/readyz`, async () => {
    const response: ReadyzResponse = {
      status: "ready",
      checks: { db: "ok", cache: "ok" },
    };
    return HttpResponse.json(response, { status: 200 });
  }),

  // ── GET /api/v1/flags ────────────────────────────────────────────────────
  http.get(`${V1}/flags`, async () => {
    await latency();
    const response: FlagsResponse = {
      flags: {
        // Wave 1 features — enabled for dev
        product_grid: true,
        cart: true,
        tender_screen: true,
        offline_checkout: true,
        checkout_split_tender: true,
        // Wave 2
        reporting_dashboard: false,
        multi_store_switcher: false,
      },
    };
    return HttpResponse.json(response, { status: 200 });
  }),

  // ── GET /api/v1/catalog ──────────────────────────────────────────────────
  http.get(`${V1}/catalog`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.toLowerCase() ?? "";
    const category = url.searchParams.get("category") ?? "";
    const page = parseInt(url.searchParams.get("page") ?? "1", 10);
    const pageSize = parseInt(url.searchParams.get("pageSize") ?? "50", 10);

    let items = MOCK_PRODUCTS.filter((p) => p.status === "active");

    if (search) {
      items = items.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.sku.toLowerCase().includes(search) ||
          p.barcode?.toLowerCase().includes(search)
      );
    }

    if (category) {
      items = items.filter((p) => p.category === category);
    }

    const total = items.length;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    const response: CatalogListResponse = {
      items: paged,
      total,
      page,
      pageSize,
    };

    return HttpResponse.json(response, { status: 200 });
  }),

  // ── POST /api/v1/orders ──────────────────────────────────────────────────
  http.post(`${V1}/orders`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as CreateOrderRequest;

    if (!body.lines || body.lines.length === 0) {
      return HttpResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Order must have at least one line",
            requestId: mockRequestId(),
          },
        },
        { status: 400 }
      );
    }

    try {
      const id = makeMockOrderId();
      const totals = computeOrderTotals(body.lines);
      const orderLines = totals.lines.map((l) => ({ ...l, orderId: id }));
      const now = Date.now();
      const orderNum = `ORD-${String(orderCounter - 1).padStart(5, "0")}`;

      const order: MockOrder = {
        id,
        orderNumber: orderNum,
        stateCode: (body.stateCode as Order["stateCode"]) ?? "CA",
        status: "open",
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        lines: orderLines,
        createdAt: now,
        updatedAt: now,
      };

      orderStore.set(id, order);
      return HttpResponse.json(order, { status: 201 });
    } catch (err) {
      return HttpResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: err instanceof Error ? err.message : "Invalid order",
            requestId: mockRequestId(),
          },
        },
        { status: 400 }
      );
    }
  }),

  // ── GET /api/v1/orders (list) ────────────────────────────────────────────
  http.get(`${V1}/orders`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);
    let items = Array.from(orderStore.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (statusFilter) items = items.filter((o) => o.status === statusFilter);
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return HttpResponse.json({ items: page, total, limit, offset });
  }),

  // ── GET /api/v1/orders/:id ───────────────────────────────────────────────
  http.get(`${V1}/orders/:id`, async ({ params }) => {
    await latency();
    const order = orderStore.get(params.id as string);
    if (!order) {
      return HttpResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Order ${params.id as string} not found`,
            requestId: mockRequestId(),
          },
        },
        { status: 404 }
      );
    }
    return HttpResponse.json(order, { status: 200 });
  }),

  // ── PUT /api/v1/orders/:id ───────────────────────────────────────────────
  http.put(`${V1}/orders/:id`, async ({ params, request }) => {
    await latency();
    const id = params.id as string;
    const existing = orderStore.get(id);

    if (!existing) {
      return HttpResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Order ${id} not found`,
            requestId: mockRequestId(),
          },
        },
        { status: 404 }
      );
    }

    if (existing.status !== "open") {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_STATE",
            message: `Order ${id} is ${existing.status} and cannot be modified`,
            requestId: mockRequestId(),
          },
        },
        { status: 409 }
      );
    }

    const body = (await request.json()) as UpdateOrderRequest;

    if (!body.lines || body.lines.length === 0) {
      // Empty cart — delete the order
      orderStore.delete(id);
      return new HttpResponse(null, { status: 204 });
    }

    try {
      const totals = computeOrderTotals(body.lines);
      const orderLines = totals.lines.map((l) => ({ ...l, orderId: id }));

      const updated: MockOrder = {
        ...existing,
        stateCode: (body.stateCode as Order["stateCode"]) ?? existing.stateCode,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        lines: orderLines,
        updatedAt: Date.now(),
      };

      orderStore.set(id, updated);
      return HttpResponse.json(updated, { status: 200 });
    } catch (err) {
      return HttpResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: err instanceof Error ? err.message : "Invalid order",
            requestId: mockRequestId(),
          },
        },
        { status: 400 }
      );
    }
  }),

  // ── POST /api/v1/payments ────────────────────────────────────────────────
  http.post(`${V1}/payments`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as CapturePaymentRequest;

    const order = orderStore.get(body.orderId);
    if (!order) {
      return HttpResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Order ${body.orderId} not found`,
            requestId: mockRequestId(),
          },
        },
        { status: 404 }
      );
    }

    if (order.status !== "open") {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_STATE",
            message: `Order is ${order.status} — cannot capture payment`,
            requestId: mockRequestId(),
          },
        },
        { status: 409 }
      );
    }

    const cashCents = body.cashCents ?? 0;
    const cardCents = body.cardCents ?? 0;
    const totalTendered = cashCents + cardCents;

    if (totalTendered < order.totalCents) {
      return HttpResponse.json(
        {
          error: {
            code: "INSUFFICIENT_TENDER",
            message: `Tendered ${totalTendered}¢ is less than total ${order.totalCents}¢`,
            requestId: mockRequestId(),
          },
        },
        { status: 422 }
      );
    }

    const changeCents = body.method === "cash" ? totalTendered - order.totalCents : 0;

    const payment: Payment = {
      id: makeMockPaymentId(),
      orderId: body.orderId,
      method: body.method,
      amountCents: order.totalCents,
      cashCents,
      cardCents,
      changeCents,
      cardLast4: body.cardLast4,
      authCode: body.method !== "cash" ? `AUTH${Math.floor(Math.random() * 999999)}` : undefined,
      status: "captured",
      createdAt: Date.now(),
    };

    // Complete the order
    const completedOrder: MockOrder = {
      ...order,
      status: "completed",
      updatedAt: Date.now(),
      _paymentId: payment.id,
    };
    orderStore.set(body.orderId, completedOrder);

    return HttpResponse.json(payment, { status: 201 });
  }),

  // ── POST /api/v1/orders/:id/refund ───────────────────────────────────────
  http.post(`${V1}/orders/:id/refund`, async ({ params }) => {
    await latency();
    const id = params.id as string;
    const order = orderStore.get(id);

    if (!order) {
      return HttpResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Order ${id} not found`,
            requestId: mockRequestId(),
          },
        },
        { status: 404 }
      );
    }

    if (order.status !== "completed") {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_STATE",
            message: `Only completed orders can be refunded (order is ${order.status})`,
            requestId: mockRequestId(),
          },
        },
        { status: 409 }
      );
    }

    const refunded: MockOrder = {
      ...order,
      status: "refunded",
      updatedAt: Date.now(),
    };
    orderStore.set(id, refunded);

    return HttpResponse.json(refunded, { status: 200 });
  }),

  // ── POST /api/v1/orders/:id/void ─────────────────────────────────────────
  http.post(`${V1}/orders/:id/void`, async ({ params }) => {
    await latency();
    const id = params.id as string;
    const order = orderStore.get(id);

    if (!order) {
      return HttpResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `Order ${id} not found`,
            requestId: mockRequestId(),
          },
        },
        { status: 404 }
      );
    }

    if (order.status === "refunded" || order.status === "voided") {
      return HttpResponse.json(
        {
          error: {
            code: "INVALID_STATE",
            message: `Order is already ${order.status}`,
            requestId: mockRequestId(),
          },
        },
        { status: 409 }
      );
    }

    const voided: MockOrder = {
      ...order,
      status: "voided",
      updatedAt: Date.now(),
    };
    orderStore.set(id, voided);

    return HttpResponse.json(voided, { status: 200 });
  }),

  // ── GET /api/v1/search ───────────────────────────────────────────────────
  http.get(`${V1}/search`, async ({ request }) => {
    await latency();
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase().trim() ?? "";
    if (!q) return HttpResponse.json({ query: "", results: {} }, { status: 200 });

    const results: Record<string, Array<{ type: string; id: string; label: string; sublabel?: string }>> = {};

    // Products
    const matchedProducts = MOCK_PRODUCTS.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q),
    ).slice(0, 6);
    if (matchedProducts.length > 0) {
      results.products = matchedProducts.map((p) => ({
        type: "product",
        id: p.id,
        label: p.name,
        sublabel: p.sku,
      }));
    }

    // Orders (search by order number)
    const matchedOrders = Array.from(orderStore.values())
      .filter((o) => o.orderNumber.toLowerCase().includes(q))
      .slice(0, 4);
    if (matchedOrders.length > 0) {
      results.orders = matchedOrders.map((o) => ({
        type: "order",
        id: o.id,
        label: o.orderNumber,
        sublabel: o.status,
      }));
    }

    return HttpResponse.json({ query: q, results }, { status: 200 });
  }),

  // ── GET /api/v1/reports/summary ──────────────────────────────────────────
  http.get(`${V1}/reports/summary`, async () => {
    await latency();
    const response: SalesSummary = {
      orders: { open: 1, completed: 3, refunded: 0, voided: 0, total: 4 },
      revenue: { grossCents: 6497, taxCents: 497, netCents: 6000 },
      payments: { capturedCount: 3, capturedCents: 6497, byMethod: { cash: 3247, card: 3250 } },
    };
    return HttpResponse.json(response, { status: 200 });
  }),

  // ── Gift cards (S7-GIFTCARDS) ─────────────────────────────────────────────────
  http.get(`${V1}/giftcards`, async () => {
    await latency();
    const now = Date.now();
    return HttpResponse.json({ items: [
      { id: "gft_1", code: "GC-ABCD-EFGH-JKLM", initial_cents: 5000, balance_cents: 5000, status: "active", created_at: now - 2*86_400_000 },
      { id: "gft_2", code: "GC-WXYZ-1234-PQRS", initial_cents: 10000, balance_cents: 2500, status: "active", created_at: now - 5*86_400_000 },
      { id: "gft_3", code: "GC-MNOP-5678-TUVA", initial_cents: 2500, balance_cents: 0, status: "redeemed", created_at: now - 10*86_400_000 },
    ], total: 3 });
  }),
  http.get(`${V1}/giftcards/:code`, async ({ params }) => {
    await latency();
    const code = String(params.code).toUpperCase();
    const cards: Record<string, { id: string; code: string; initial_cents: number; balance_cents: number; status: "active"|"redeemed"|"void"; created_at: number }> = {
      "GC-ABCD-EFGH-JKLM": { id: "gft_1", code: "GC-ABCD-EFGH-JKLM", initial_cents: 5000, balance_cents: 5000, status: "active", created_at: Date.now() - 2*86_400_000 },
      "GC-WXYZ-1234-PQRS": { id: "gft_2", code: "GC-WXYZ-1234-PQRS", initial_cents: 10000, balance_cents: 2500, status: "active", created_at: Date.now() - 5*86_400_000 },
    };
    const card = cards[code];
    if (!card) return HttpResponse.json({ error: { code: "not_found", message: `gift card '${code}' not found` } }, { status: 404 });
    return HttpResponse.json(card);
  }),
  http.post(`${V1}/giftcards`, async ({ request }) => {
    await latency();
    const b = (await request.json()) as Record<string, unknown>;
    const code = `GC-${Math.random().toString(36).slice(2,6).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
    return HttpResponse.json({ id: `gft_new`, code, initial_cents: Number(b.amountCents), balance_cents: Number(b.amountCents), status: "active", created_at: Date.now() }, { status: 201 });
  }),
  http.post(`${V1}/giftcards/:code/redeem`, async () => {
    await latency();
    return HttpResponse.json({ code: "GC-ABCD-EFGH-JKLM", redeemedCents: 1000, balanceCents: 4000, status: "active" });
  }),
  http.post(`${V1}/giftcards/:code/void`, async ({ params }) => {
    await latency();
    return HttpResponse.json({ id: "gft_1", code: String(params.code), initial_cents: 5000, balance_cents: 5000, status: "void", created_at: Date.now() });
  }),

  // ── Tenant registration (S7-SIGNUP) ──────────────────────────────────────────
  http.post("/api/identity/register", async ({ request }) => {
    await latency();
    const b = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresIn: 900,
      user: { id: "usr_new", email: String(b.email ?? ""), name: String(b.email ?? "").split("@")[0], role: "owner", tenantId: "tnt_new" },
    }, { status: 201 });
  }),

  // ── Email receipt (S5-EMAIL) ─────────────────────────────────────────────────
  http.post(`${V1}/orders/:id/email-receipt`, async () => {
    await latency();
    return HttpResponse.json({ sent: false, to: "customer@example.com", preview: "<p>Receipt preview</p>" });
  }),

  // ── Sales by category (S5-ANALYTICS) ─────────────────────────────────────────
  http.get(`${V1}/reports/sales-by-category`, async () => {
    await latency();
    const cats = [
      { key: "Beverages", name: "Beverages", units: 84, revenueCents: 28400 },
      { key: "Snacks", name: "Snacks", units: 62, revenueCents: 22100 },
      { key: "Tobacco", name: "Tobacco", units: 40, revenueCents: 51960 },
      { key: "Apparel", name: "Apparel", units: 18, revenueCents: 39600 },
    ];
    return HttpResponse.json({ items: cats });
  }),

  // ── Revenue trend (S4-CHARTS) ────────────────────────────────────────────────
  http.get(`${V1}/reports/revenue-trend`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const days = url.searchParams.get("range") === "30d" ? 30 : 7;
    const items = Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.now() - (days - 1 - i) * 86_400_000);
      const label = days <= 7
        ? d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return { date: d.toISOString().slice(0, 10), label, revenueCents: Math.floor(Math.random() * 50000) + 10000, orderCount: Math.floor(Math.random() * 20) + 5 };
    });
    return HttpResponse.json({ items });
  }),

  http.get(`${V1}/reports/hourly`, async () => {
    await latency();
    const items = Array.from({ length: 24 }, (_, hour) => {
      const period = hour < 12 ? "AM" : "PM";
      const h12 = hour % 12 === 0 ? 12 : hour % 12;
      const label = `${h12} ${period}`;
      const peak = hour >= 10 && hour <= 14 ? 1.5 : hour >= 17 && hour <= 19 ? 1.2 : 0.3;
      const revenueCents = Math.floor(Math.random() * 15000 * peak);
      return { hour, label, orderCount: Math.floor(revenueCents / 2500), revenueCents, value: Math.floor(revenueCents / 200) };
    });
    return HttpResponse.json({ items });
  }),

  // ── Loyalty tier rules (S4-LOYALTY) ─────────────────────────────────────────
  http.get(`${V1}/customers/loyalty-tiers`, async () => {
    await latency();
    return HttpResponse.json({ items: [] });
  }),

  http.put(`${V1}/customers/loyalty-tiers/:level`, async () => {
    await latency();
    return HttpResponse.json({}, { status: 200 });
  }),

  http.delete(`${V1}/customers/loyalty-tiers/:level`, async () => {
    await latency();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${V1}/customers/:id/loyalty`, async ({ params }) => {
    await latency();
    return HttpResponse.json({
      customerId: params.id, currentPoints: 350, currentTierLevel: 1,
      currentTierName: "Bronze", pointMultiplier: 1.0, discountPct: 0,
      nextTierName: "Silver", pointsToNextTier: 150,
    });
  }),

  // Cycle-3 modules (customers, gift cards, webhooks, inventory overview, team).
  // Maintained in a separate file to avoid cross-agent edit collisions.
  ...lightspeedHandlers,
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function mockRequestId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
}
