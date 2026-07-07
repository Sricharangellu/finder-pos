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
import { mockHandlers } from "./mockHandlers";
import { verticalHandlers } from "./verticalModules";

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
  {
    id: "prod_014",
    sku: "VAPE-MNG-50",
    name: "Mango Blast Vape 50mg",
    priceCents: 1499,
    category: "Tobacco",
    taxClass: "exempt" as const,
    status: "active",
    ageRestricted: true,
    tobaccoType: "ecigarette",
    flavored: true,
    msaReportable: true,
    restrictedStates: ["CA", "MA", "NJ", "RI", "IL"],
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

  // GET /api/v1/catalog is handled by mockHandlers (richer: filtering, pagination, detail by ID).

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
      cardLast4: body.stripePaymentIntentId ? "4242" : undefined,
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

  // ── GET /api/v1/reports/recommendations ──────────────────────────────────
  http.get(`${V1}/reports/recommendations`, async () => {
    await latency();
    const generatedAt = Date.now();
    return HttpResponse.json({
      ready: false,
      recommendations: [
        {
          id: "rec_negative_net_profit",
          signalCode: "negative_net_profit",
          category: "profit",
          severity: "critical",
          title: "Review negative net profit",
          detail: "Net profit is below zero after cost of goods and expenses.",
          action: "Open profit report",
          href: "/reports/p-l",
          count: 1,
          rank: 1,
        },
        {
          id: "rec_low_stock",
          signalCode: "low_stock",
          category: "inventory",
          severity: "warning",
          title: "Restock low inventory",
          detail: "Some products are at or below their reorder point.",
          action: "Review reorder list",
          href: "/inventory/reorder",
          count: 4,
          rank: 2,
        },
        {
          id: "rec_uncategorized_expenses",
          signalCode: "uncategorized_expenses",
          category: "expenses",
          severity: "info",
          title: "Categorize expenses",
          detail: "Uncategorized expenses reduce confidence in profit reports.",
          action: "Open expenses",
          href: "/finance",
          count: 3,
          rank: 3,
        },
      ],
      summary: { total: 3, critical: 1, warning: 1, info: 1 },
      generatedAt,
      recentDays: 30,
    });
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

  // ── Quotes (S10A) ─────────────────────────────────────────────────────────────
  ...(() => {
    const now = Date.now();
    let quotesStore: Array<{
      id: string; quote_number: string; status: string; customer_id: string;
      total_cents: number; currency: string; valid_until: number; created_at: number;
    }> = [
      { id: "qt_001", quote_number: "QT-00001", status: "draft",    customer_id: "Acme Corp", total_cents: 125000, currency: "USD", valid_until: now + 30 * 86_400_000, created_at: now - 2 * 86_400_000 },
      { id: "qt_002", quote_number: "QT-00002", status: "sent",     customer_id: "Beta Ltd",  total_cents:  47500, currency: "EUR", valid_until: now + 15 * 86_400_000, created_at: now - 5 * 86_400_000 },
      { id: "qt_003", quote_number: "QT-00003", status: "accepted", customer_id: "Gamma Inc", total_cents:  89900, currency: "USD", valid_until: now +  7 * 86_400_000, created_at: now - 10 * 86_400_000 },
    ];
    const quoteLines: Record<string, Array<{ id: string; name: string; quantity: number; unit_cents: number; sku?: string }>> = {
      qt_001: [
        { id: "ql_001a", name: "Consulting Package", quantity: 5, unit_cents: 20000, sku: "SVC-001" },
        { id: "ql_001b", name: "Setup Fee",          quantity: 1, unit_cents: 25000 },
      ],
      qt_002: [{ id: "ql_002a", name: "Widget Pro",        quantity: 10, unit_cents: 4750,  sku: "WDG-PRO" }],
      qt_003: [{ id: "ql_003a", name: "Enterprise License", quantity: 1, unit_cents: 89900, sku: "LIC-ENT" }],
    };
    let qtSeq = 3;

    return [
      http.get(`${V1}/quotes`, async () => {
        await latency();
        return HttpResponse.json({ items: [...quotesStore].sort((a, b) => b.created_at - a.created_at), total: quotesStore.length });
      }),
      http.post(`${V1}/quotes`, async ({ request }) => {
        await latency();
        const b = (await request.json()) as Record<string, unknown>;
        const id = `qt_${Math.random().toString(36).slice(2, 10)}`;
        const rawLines = (b.lines as Array<{ name: string; quantity: number; unitCents: number; sku?: string }>) ?? [];
        const lines = rawLines.map((l, i) => ({
          id: `ql_${id}_${i}`, name: l.name, quantity: l.quantity, unit_cents: l.unitCents ?? 0, sku: l.sku,
        }));
        const total = lines.reduce((s, l) => s + l.unit_cents * l.quantity, 0);
        const q = {
          id, quote_number: `QT-${String(++qtSeq).padStart(5, "0")}`,
          status: "draft", customer_id: String(b.customerId ?? ""),
          total_cents: total, currency: String(b.currency ?? "USD"),
          valid_until: (b.validUntil as number) ?? Date.now() + 30 * 86_400_000,
          created_at: Date.now(),
        };
        quotesStore.push(q);
        quoteLines[id] = lines;
        return HttpResponse.json({ ...q, lines }, { status: 201 });
      }),
      http.get(`${V1}/quotes/:id`, async ({ params }) => {
        await latency();
        const q = quotesStore.find((x) => x.id === String(params.id));
        if (!q) return HttpResponse.json({ error: { code: "not_found", message: "quote not found" } }, { status: 404 });
        return HttpResponse.json({ ...q, lines: quoteLines[q.id] ?? [] });
      }),
      http.patch(`${V1}/quotes/:id/status`, async ({ params, request }) => {
        await latency();
        const { status } = (await request.json()) as { status: string };
        const q = quotesStore.find((x) => x.id === String(params.id));
        if (!q) return HttpResponse.json({ error: { code: "not_found", message: "quote not found" } }, { status: 404 });
        q.status = status;
        return HttpResponse.json(q);
      }),
      http.post(`${V1}/quotes/:id/convert`, async ({ params }) => {
        await latency();
        const q = quotesStore.find((x) => x.id === String(params.id));
        if (!q) return HttpResponse.json({ error: { code: "not_found", message: "quote not found" } }, { status: 404 });
        q.status = "accepted";
        return HttpResponse.json({ quoteId: q.id, message: `Quote ${q.quote_number} converted to order` });
      }),
      http.delete(`${V1}/quotes/:id`, async ({ params }) => {
        await latency();
        const before = quotesStore.length;
        quotesStore = quotesStore.filter((x) => x.id !== String(params.id));
        if (quotesStore.length === before) return HttpResponse.json({ error: { code: "not_found", message: "quote not found" } }, { status: 404 });
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── POST /api/v1/imports/products (Sprint 15) ───────────────────────────────
  http.post(`${V1}/imports/products`, async ({ request }) => {
    await latency();
    const body = (await request.json()) as { csv?: string; mappings?: unknown };
    const lines = (body.csv ?? "").split(/\r?\n/).filter((l: string) => l.trim());
    const total = Math.max(0, lines.length - 1);
    return HttpResponse.json(
      { batch_id: `imp_${Math.random().toString(36).slice(2, 14)}`, total, status: "processing" },
      { status: 201 }
    );
  }),

  // ── GET /api/v1/customers/search (Sprint 15) ─────────────────────────────────
  http.get(`${V1}/customers/search`, async ({ request }) => {
    await latency();
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
    const seed = [
      { id: "cust_dup_001", name: "Jane Smith", email: "jane.smith@example.com", phone: "555-0101" },
      { id: "cust_dup_002", name: "Robert Johnson", email: "rjohnson@example.com", phone: "555-0202" },
      { id: "cust_dup_003", name: "Maria Garcia", email: "maria.garcia@example.com", phone: "555-0303" },
    ];
    const filtered = q
      ? seed.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
      : seed;
    return HttpResponse.json(filtered);
  }),

  // ── POST /api/v1/customers/:id/merge (Sprint 15) ─────────────────────────────
  http.post(`${V1}/customers/:id/merge`, async ({ params, request }) => {
    await latency();
    const { merge_from_id } = (await request.json()) as { merge_from_id: string };
    return HttpResponse.json({ success: true, merged_from_id: merge_from_id, primary_id: String(params.id) });
  }),

  // ── Current identity — mirrors real GET /api/identity/me ({userId,tenantId,role};
  //    name/email added for the demo). PermissionsContext reads this. ──────────────
  http.get("*/api/identity/me", async () => {
    await latency();
    return HttpResponse.json({
      userId: "usr_demo_owner",
      tenantId: "tnt_demo",
      role: "owner",
      name: "Demo Owner",
      email: "owner@finder-pos.dev",
    });
  }),

  // ── MFA (Sprint 10C) ─────────────────────────────────────────────────────────
  http.get("*/api/identity/mfa/status", async () => { await latency(); return HttpResponse.json({ enabled: false, setupRequired: true }); }),
  http.post("*/api/identity/mfa/setup", async () => { await latency(); return HttpResponse.json({ secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/FinderPOS:demo@example.com?secret=JBSWY3DPEHPK3PXP&issuer=FinderPOS" }); }),
  http.post("*/api/identity/mfa/verify", async () => {
    await latency();
    return HttpResponse.json({
      ok: true,
      message: "MFA enabled successfully",
      backupCodes: ["ABCD-2345", "EFGH-6789", "JKLM-2345", "NPQR-6789"],
    });
  }),
  http.post("*/api/identity/mfa/disable", async () => { await latency(); return HttpResponse.json({ ok: true }); }),

  // ── Backup codes (Sprint 16) ──────────────────────────────────────────────
  ...(() => {
    let backupCodes: string[] = [];
    return [
      http.get("*/api/v1/auth/backup-codes", async () => {
        await latency();
        return HttpResponse.json({ codes: backupCodes, remaining: backupCodes.length });
      }),
      http.post("*/api/v1/auth/backup-codes", async () => {
        await latency();
        backupCodes = [];
        return HttpResponse.json({ codes: backupCodes });
      }),
    ];
  })(),

  // Cycle-3 modules (customers, gift cards, webhooks, inventory overview, team).
  // Maintained in a separate file to avoid cross-agent edit collisions.
  ...mockHandlers,
  ...verticalHandlers,

  // ── API Keys (Sprint 10B) ────────────────────────────────────────────────────
  ...(() => {
    let apiKeys: Array<{ id: string; name: string; key_prefix: string; scopes: string; last_used_at: string | null; expires_at: string | null; created_at: string }> = [];
    return [
      http.get(`${IDENTITY}/api-keys`, async () => {
        await delay(Math.floor(Math.random() * 120) + 60);
        return HttpResponse.json({ items: apiKeys });
      }),
      http.post(`${IDENTITY}/api-keys`, async ({ request }) => {
        await delay(Math.floor(Math.random() * 120) + 60);
        const b = (await request.json()) as { name?: string; scopes?: string; expiresAt?: string };
        const prefix = "fpk_demo_ke";
        const key = `fpk_demo_key_shown_once_${Math.random().toString(36).slice(2, 10)}`;
        const id = `apk_${Math.random().toString(36).slice(2, 10)}`;
        apiKeys.push({ id, name: b.name ?? "Unnamed key", key_prefix: prefix, scopes: b.scopes ?? "[]", last_used_at: null, expires_at: b.expiresAt ?? null, created_at: new Date().toISOString() });
        return HttpResponse.json({ id, key, prefix }, { status: 201 });
      }),
      http.delete(`${IDENTITY}/api-keys/:id`, async ({ params }) => {
        await delay(Math.floor(Math.random() * 120) + 60);
        apiKeys = apiKeys.filter(k => k.id !== String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    ];
  })(),

  // ── Settings: Currencies ─────────────────────────────────────────────────────
  http.get(`${V1}/settings/currencies`, async () => {
    await latency();
    return HttpResponse.json({ items: [
      { currency_code: "USD", currency_name: "US Dollar",       symbol: "$",  exchange_rate: 1.0,  is_base: true,  is_active: true },
      { currency_code: "EUR", currency_name: "Euro",            symbol: "€",  exchange_rate: 0.92, is_base: false, is_active: true },
      { currency_code: "GBP", currency_name: "British Pound",   symbol: "£",  exchange_rate: 0.79, is_base: false, is_active: true },
      { currency_code: "CAD", currency_name: "Canadian Dollar", symbol: "C$", exchange_rate: 1.36, is_base: false, is_active: true },
    ]});
  }),

  // ── End-of-Day Z-Report ───────────────────────────────────────────────────────
  http.get(`${V1}/reports/end-of-day`, async () => {
    await latency();
    return HttpResponse.json({
      date: new Date().toISOString().slice(0, 10),
      businessDate: new Intl.DateTimeFormat("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date()),
      openedAt: Date.now() - 8 * 3600 * 1000,
      closedAt: null,
      status: "open",
      transactions: { count: 47, voidCount: 2, refundCount: 1, averageTicket_cents: 2340 },
      sales: { grossSales_cents: 124850, discounts_cents: 4200, refunds_cents: 1500, netSales_cents: 119150, taxCollected_cents: 9532, totalCollected_cents: 128682 },
      tenders: [
        { method: "Cash", count: 18, total_cents: 42300 },
        { method: "Card", count: 26, total_cents: 78382 },
        { method: "Gift Card", count: 3, total_cents: 8000 },
      ],
      topItems: [
        { productId: "prod_1", productName: "Marlboro Red King", quantitySold: 24, total_cents: 23976 },
        { productId: "prod_2", productName: "Coca-Cola 12oz", quantitySold: 18, total_cents: 3582 },
        { productId: "prod_3", productName: "Newport Menthol 100s", quantitySold: 15, total_cents: 14985 },
        { productId: "prod_4", productName: "Red Bull 8.4oz", quantitySold: 12, total_cents: 7188 },
        { productId: "prod_5", productName: "Swisher Sweets Cigarillos", quantitySold: 11, total_cents: 8789 },
      ],
      cashDrawer: { openingFloat_cents: 20000, cashSales_cents: 42300, cashRefunds_cents: 1500, expectedCash_cents: 60800, actualCash_cents: null, variance_cents: null },
    });
  }),

  // ── Inventory Transfers ───────────────────────────────────────────────────────
  http.post(`${V1}/inventory/transfers`, async () => {
    await latency();
    return HttpResponse.json({ success: true, message: "Stock transferred successfully." });
  }),
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function mockRequestId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
}
