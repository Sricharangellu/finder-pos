import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { badRequest, notFound } from "../../shared/http.js";
import { writeAudit } from "../../shared/audit.js";
import {
  BUSINESS_BUNDLES,
  CORE_MODULES,
  GROUP_LABELS,
  MODULE_REGISTRY,
  moduleFlag,
} from "../../shared/moduleRegistry.js";

/**
 * Settings module (ERP benchmark #13): shipping methods, payment terms, payment
 * modes, tax rates, plus a key/value store for the business profile and feature
 * flags. Tenant-scoped. Mutations are role-gated at the route layer.
 */

export interface ShippingMethod {
  id: string; tenant_id: string; name: string; amount_cents: number; free_limit_cents: number | null;
  ecommerce: number; sequence: number; credit_account_id: string | null; debit_account_id: string | null; active: number;
}
export interface PaymentTerm { id: string; tenant_id: string; name: string; days_due: number; description: string | null; active: number; }
export interface PaymentMode { id: string; tenant_id: string; name: string; active: number; }
export interface TaxRate { id: string; tenant_id: string; name: string; rate_bps: number; apply_to_category: string | null; state: string | null; active: number; }

export interface CapabilitiesAuth {
  tenantId: string;
  userId: string;
  role: string;
  storeIds: string[];
  customRoleId?: string;
  permissions: string[];
  scopes: string[];
}

export interface CapabilitiesImpactRequest {
  businessType?: string;
  enabledModules?: string[];
  disabledModules?: string[];
}

type BusinessCapabilityProfile = {
  requiredFields: Record<string, string[]>;
  workflows: string[];
};

type SetupTask = {
  key: string;
  label: string;
  reason: string;
  moduleKeys?: string[];
};

type CapabilitiesBuildOptions = {
  businessType?: string;
  businessSource?: string;
  moduleOverrides?: Record<string, boolean>;
  useStoredModuleFlags?: boolean;
};

const DEFAULT_FLAGS: Record<string, boolean> = {
  quotations: true, achBatchPayout: false, imeiTracking: false, msaReporting: false,
  compositeProducts: false, customerPortal: false, ecommerce: true, commissionTracking: false,
  pickerFulfillment: true, batchDeposits: true,
  groupRetailPOS: true, groupWholesale: true, groupEnterprise: true,
};

const COMMON_PROFILE: BusinessCapabilityProfile = {
  requiredFields: {
    business: ["businessName", "taxProfile", "defaultOutlet", "defaultRegister"],
    product: ["name", "sku", "retailPriceCents", "taxCategory", "inventoryTracking"],
    customer: ["name", "phoneOrEmail"],
    transaction: ["outletId", "operatorId", "lineItems", "paymentTender"],
  },
  workflows: ["setup_business_profile", "create_product", "receive_inventory", "sell_or_invoice", "settle_payment", "report_day_end"],
};

const BUSINESS_CAPABILITY_PROFILES: Record<string, BusinessCapabilityProfile> = {
  retail: {
    requiredFields: {
      business: ["businessName", "taxProfile", "defaultOutlet", "defaultRegister", "receiptTemplate"],
      product: ["name", "sku", "retailPriceCents", "barcode", "taxCategory", "inventoryTracking"],
      customer: ["name", "phoneOrEmail"],
      transaction: ["outletId", "registerId", "cashierId", "lineItems", "paymentTender"],
    },
    workflows: ["retail_setup", "create_product", "receive_inventory", "open_register", "pos_sale", "refund_or_return", "close_register", "end_of_day_report"],
  },
  wholesale: {
    requiredFields: {
      business: ["legalName", "billingAddress", "taxProfile", "paymentTerms"],
      product: ["name", "sku", "costCents", "priceTiers", "inventoryTracking"],
      customer: ["legalBusinessName", "primaryContact", "billingAddress", "shippingAddresses", "taxIdOrResaleCertificate", "paymentTerms"],
      transaction: ["customerAccountId", "quoteOrOrderLines", "fulfillmentLocation", "invoiceTerms"],
    },
    workflows: ["wholesale_setup", "create_business_customer", "create_quote", "convert_quote_to_sales_order", "receive_inventory", "invoice_customer", "record_payment"],
  },
  restaurant: {
    requiredFields: {
      business: ["businessName", "taxProfile", "serviceAreas", "menuTaxes"],
      product: ["menuItemName", "menuPriceCents", "modifierGroups", "kitchenRoute"],
      customer: ["guestNameOrWalkIn", "phoneForReservation"],
      transaction: ["serviceArea", "serverId", "menuLines", "paymentTender"],
    },
    workflows: ["restaurant_setup", "create_menu_item", "open_table_or_tab", "send_to_kitchen", "take_payment", "close_shift"],
  },
  hybrid: {
    requiredFields: {
      business: ["businessName", "businessSegments", "taxProfile", "defaultOutlet", "defaultRegister"],
      product: ["name", "sku", "retailPriceCents", "costCents", "priceTiers", "inventoryTracking"],
      customer: ["name", "phoneOrEmail", "businessAccountFieldsWhenB2B"],
      transaction: ["outletId", "operatorId", "lineItems", "paymentTender", "invoiceTermsWhenB2B"],
    },
    workflows: ["hybrid_setup", "create_product", "receive_inventory", "pos_sale", "create_quote_or_invoice", "settle_payment", "end_of_day_report"],
  },
  custom: COMMON_PROFILE,
};

const DEFAULT_PLAN_LIMITS = {
  maxUsers: 3,
  maxRegisters: 1,
  maxOutlets: 1,
};

const BUSINESS_SETUP_TASKS: Record<string, SetupTask[]> = {
  retail: [
    { key: "configure_outlet", label: "Configure outlet", reason: "Retail sales need a selling location." },
    { key: "configure_register", label: "Configure register", reason: "POS checkout needs a register and cash drawer.", moduleKeys: ["pos_terminal"] },
    { key: "configure_tax", label: "Configure taxes", reason: "Retail receipts need correct tax calculation." },
    { key: "configure_payment_modes", label: "Configure payment modes", reason: "Cash/card tenders must be available before checkout.", moduleKeys: ["payments"] },
    { key: "configure_receipt", label: "Configure receipt template", reason: "Retail customers expect receipts after payment.", moduleKeys: ["pos_terminal"] },
    { key: "create_first_product", label: "Create first product", reason: "Retail checkout needs sellable catalog items.", moduleKeys: ["catalog"] },
    { key: "receive_first_stock", label: "Receive first stock", reason: "Inventory must exist before selling tracked products.", moduleKeys: ["inventory"] },
  ],
  wholesale: [
    { key: "configure_payment_terms", label: "Configure payment terms", reason: "Wholesale invoices usually require terms.", moduleKeys: ["billing"] },
    { key: "configure_price_tiers", label: "Configure price tiers", reason: "Wholesale customers often need customer-specific pricing.", moduleKeys: ["price_book"] },
    { key: "create_business_account", label: "Create business customer account", reason: "Wholesale customers need company, contact, address, and tax details.", moduleKeys: ["customers"] },
    { key: "configure_quote_to_invoice", label: "Configure quote/order/invoice flow", reason: "Wholesale selling usually starts from quotes or sales orders.", moduleKeys: ["quotes", "sales_orders", "billing"] },
  ],
  restaurant: [
    { key: "configure_service_areas", label: "Configure service areas", reason: "Restaurant operations need tables, tabs, or counters.", moduleKeys: ["tables", "bar_tabs"] },
    { key: "create_menu_items", label: "Create menu items", reason: "Restaurant checkout needs menu items and modifiers.", moduleKeys: ["catalog", "menu_modifiers"] },
    { key: "configure_kitchen_display", label: "Configure kitchen routing", reason: "Food orders need kitchen visibility.", moduleKeys: ["kitchen"] },
  ],
  hybrid: [
    { key: "confirm_business_segments", label: "Confirm business segments", reason: "Hybrid tenants need clear rules for POS and invoice workflows." },
    { key: "configure_shared_catalog", label: "Configure shared catalog", reason: "Hybrid packs reuse one product catalog across channels.", moduleKeys: ["catalog"] },
  ],
};

const MODULE_PERMISSIONS: Record<string, string[]> = {
  catalog: ["catalog:read", "catalog:write"],
  inventory: ["inventory:read", "inventory:write"],
  customers: ["customers:read", "customers:write"],
  reports: ["reports:read"],
  team: ["team:read"],
  pos_terminal: ["orders:read", "orders:write", "orders:void"],
  discounts: ["discounts:read", "discounts:write"],
  loyalty: ["customers:read", "customers:write"],
  ecommerce: ["ecommerce:read", "ecommerce:write"],
  online_store: ["ecommerce:read", "ecommerce:write"],
  sales_orders: ["orders:read", "orders:write"],
  quotes: ["orders:read", "orders:write"],
  purchasing: ["purchasing:read", "purchasing:write"],
  billing: ["reports:read"],
  accounting: ["reports:read"],
  price_book: ["catalog:read", "catalog:write"],
};

const MODULE_REPORTS: Record<string, string[]> = {
  pos_terminal: ["end_of_day", "register_closures", "sales"],
  discounts: ["promotion_performance"],
  loyalty: ["loyalty_activity"],
  gift_cards: ["gift_card_liability"],
  sales_orders: ["sales_pipeline"],
  quotes: ["quote_conversion"],
  purchasing: ["purchase_orders"],
  billing: ["ar_ap_aging"],
  accounting: ["profit_and_loss"],
  ecommerce: ["online_orders"],
  order_fulfillment: ["fulfillment_pipeline"],
  inventory: ["inventory", "reorder"],
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function queryValues(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  const rawValues = Array.isArray(value) ? value : [value];
  const parts: string[] = [];
  for (const raw of rawValues) {
    if (typeof raw !== "string") throw badRequest(`${field} must be a comma-separated string`);
    parts.push(...raw.split(",").map((part) => part.trim()).filter(Boolean));
  }
  return unique(parts);
}

function queryScalar(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length !== 1) throw badRequest(`${field} may only be specified once`);
    return queryScalar(value[0], field);
  }
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseCapabilitiesImpactQuery(query: Record<string, unknown>): CapabilitiesImpactRequest {
  return {
    businessType: queryScalar(query["businessType"], "businessType"),
    enabledModules: queryValues(query["enabledModules"], "enabledModules"),
    disabledModules: queryValues(query["disabledModules"], "disabledModules"),
  };
}

function diffLists(current: string[], target: string[]) {
  const currentSet = new Set(current);
  const targetSet = new Set(target);
  return {
    added: target.filter((item) => !currentSet.has(item)),
    removed: current.filter((item) => !targetSet.has(item)),
    unchanged: target.filter((item) => currentSet.has(item)),
  };
}

function diffRecordLists(current: Record<string, string[]>, target: Record<string, string[]>) {
  const keys = unique([...Object.keys(current), ...Object.keys(target)]);
  const added: Record<string, string[]> = {};
  const removed: Record<string, string[]> = {};
  const changedEntities: string[] = [];
  for (const key of keys) {
    const diff = diffLists(current[key] ?? [], target[key] ?? []);
    if (diff.added.length > 0) added[key] = diff.added;
    if (diff.removed.length > 0) removed[key] = diff.removed;
    if (diff.added.length > 0 || diff.removed.length > 0) changedEntities.push(key);
  }
  return { added, removed, changedEntities };
}

export class SettingsService {
  constructor(private readonly db: DB) {}

  // ── Key/value: business profile + feature flags ──────────────────────────
  private async kvGet<T>(key: string, tenantId: string, fallback: T): Promise<T> {
    const row = await this.db.one<{ value_json: string }>("SELECT value_json FROM settings_kv WHERE tenant_id = @t AND key = @k", { t: tenantId, k: key });
    return row ? (JSON.parse(row.value_json) as T) : fallback;
  }
  private async kvSet(key: string, value: unknown, tenantId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO settings_kv (tenant_id, key, value_json, updated_at) VALUES (@t,@k,@v,@now)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at`,
      { t: tenantId, k: key, v: JSON.stringify(value), now: Date.now() },
    );
  }

  getBusiness(tenantId: string) { return this.kvGet("business", tenantId, {} as Record<string, unknown>); }
  async setBusiness(patch: Record<string, unknown>, tenantId: string) {
    const cur = await this.getBusiness(tenantId);
    const merged = { ...cur, ...patch };
    await this.kvSet("business", merged, tenantId);
    return merged;
  }

  /** Audit a business-type or module-flag change (Settings requirement:
   *  "last business-type/module changes with actor and timestamp").
   *  Best-effort via writeAudit — never fails the mutation it records. */
  async auditBusinessProfileChange(
    tenantId: string,
    actorId: string,
    action: "business_profile.type_changed" | "business_profile.modules_changed",
    detail: { before?: unknown; after?: unknown },
  ): Promise<void> {
    await writeAudit(this.db, {
      tenantId,
      actorId,
      action,
      entityType: "business_profile",
      entityId: "business_profile",
      before: detail.before,
      after: detail.after,
    });
  }

  async getFlags(tenantId: string) {
    const flags = { ...DEFAULT_FLAGS, ...(await this.kvGet("feature_flags", tenantId, {} as Record<string, boolean>)) };
    const accountMode = flags["groupEnterprise"] ? "ENTERPRISE" : flags["groupWholesale"] ? "WHOLESALE" : "RETAIL";
    return { ...flags, accountMode };
  }
  async setFlags(patch: Record<string, boolean>, tenantId: string) {
    const cur = await this.kvGet("feature_flags", tenantId, {} as Record<string, boolean>);
    const merged = { ...cur, ...patch };
    await this.kvSet("feature_flags", merged, tenantId);
    return { ...DEFAULT_FLAGS, ...merged };
  }

  private async getSubscriptionSummary(tenantId: string) {
    try {
      const row = await this.db.one<{
        plan: string;
        status: string;
        max_users: number;
        max_registers: number;
        max_outlets: number;
        trial_ends_at: number | null;
        renews_at: number | null;
      }>(
        `SELECT plan, status, max_users, max_registers, max_outlets, trial_ends_at, renews_at
         FROM subscriptions
         WHERE tenant_id = @tenantId
         LIMIT 1`,
        { tenantId },
      );
      if (!row) {
        return {
          name: "starter",
          status: "active",
          source: "default",
          limits: DEFAULT_PLAN_LIMITS,
        };
      }
      return {
        name: row.plan,
        status: row.status,
        source: "subscription",
        limits: {
          maxUsers: row.max_users,
          maxRegisters: row.max_registers,
          maxOutlets: row.max_outlets,
        },
        trialEndsAt: row.trial_ends_at,
        renewsAt: row.renews_at,
      };
    } catch {
      return {
        name: "starter",
        status: "unknown",
        source: "fallback",
        limits: DEFAULT_PLAN_LIMITS,
      };
    }
  }

  private async readCapabilityInputs(tenantId: string) {
    const [businessData, flags, plan] = await Promise.all([
      this.getBusiness(tenantId),
      this.getFlags(tenantId) as Promise<Record<string, boolean | string>>,
      this.getSubscriptionSummary(tenantId),
    ]);
    return { businessData, flags, plan };
  }

  private validateImpactRequest(target: CapabilitiesImpactRequest) {
    if (target.businessType && !BUSINESS_BUNDLES[target.businessType]) {
      throw badRequest(`unknown businessType '${target.businessType}'`);
    }
    const knownModules = new Set(MODULE_REGISTRY.map((mod) => mod.key));
    const enabledModules = unique(target.enabledModules ?? []);
    const disabledModules = unique(target.disabledModules ?? []);
    for (const key of [...enabledModules, ...disabledModules]) {
      if (!knownModules.has(key)) throw badRequest(`unknown module '${key}'`);
      if (CORE_MODULES.has(key) && disabledModules.includes(key)) {
        throw badRequest(`core module '${key}' cannot be disabled`);
      }
    }
    const disabledSet = new Set(disabledModules);
    const overlap = enabledModules.filter((key) => disabledSet.has(key));
    if (overlap.length > 0) {
      throw badRequest(`module cannot be both enabled and disabled: ${overlap.join(", ")}`);
    }
    return { businessType: target.businessType, enabledModules, disabledModules };
  }

  private buildCapabilitiesResponse(
    auth: CapabilitiesAuth,
    businessData: Record<string, unknown>,
    flags: Record<string, boolean | string>,
    plan: Awaited<ReturnType<SettingsService["getSubscriptionSummary"]>>,
    options: CapabilitiesBuildOptions = {},
  ) {
    const storedBusinessType = typeof businessData["businessType"] === "string"
      ? businessData["businessType"]
      : undefined;
    const businessType = options.businessType && BUSINESS_BUNDLES[options.businessType]
      ? options.businessType
      : storedBusinessType && BUSINESS_BUNDLES[storedBusinessType]
      ? storedBusinessType
      : "retail";
    const bundle = BUSINESS_BUNDLES[businessType] ?? BUSINESS_BUNDLES["retail"];
    const defaultModules = new Set(bundle.modules);
    const profile = BUSINESS_CAPABILITY_PROFILES[businessType] ?? COMMON_PROFILE;
    const moduleOverrides = options.moduleOverrides ?? {};
    const useStoredModuleFlags = options.useStoredModuleFlags ?? true;

    const modules = MODULE_REGISTRY.map((mod) => {
      const flagKey = moduleFlag(mod.key);
      const explicitFlag = flags[flagKey];
      const hasPreviewOverride = Object.prototype.hasOwnProperty.call(moduleOverrides, mod.key);
      const hasManualOverride = useStoredModuleFlags && typeof explicitFlag === "boolean";
      const defaultEnabled = Boolean(mod.core) || defaultModules.has(mod.key);
      const enabled = mod.core
        ? true
        : hasPreviewOverride
          ? moduleOverrides[mod.key]
          : hasManualOverride
            ? explicitFlag
            : defaultEnabled;
      const source = mod.core
        ? "core"
        : hasPreviewOverride
          ? "preview_override"
          : hasManualOverride
          ? "manual_override"
          : defaultEnabled
            ? "business_pack"
            : "not_in_business_pack";
      return {
        ...mod,
        flagKey,
        enabled,
        defaultEnabled,
        source,
        disabledReason: enabled
          ? null
          : hasPreviewOverride
            ? "preview_override_disabled"
            : hasManualOverride
              ? "manual_override_disabled"
              : "not_in_business_pack",
      };
    });

    const allAccess = auth.role === "owner" || auth.role === "manager";
    const enabledModuleKeys = new Set(modules.filter((mod) => mod.enabled).map((mod) => mod.key));
    const groupRetailPOS = enabledModuleKeys.has("pos_terminal");
    const groupWholesale = enabledModuleKeys.has("sales_orders") || enabledModuleKeys.has("purchasing");
    const groupEnterprise = enabledModuleKeys.has("sso") || enabledModuleKeys.has("webhooks");
    const accountMode = groupEnterprise ? "ENTERPRISE" : groupWholesale ? "WHOLESALE" : "RETAIL";
    const effectiveFeatures = {
      ...flags,
      groupRetailPOS,
      groupWholesale,
      groupEnterprise,
      accountMode,
    };

    return {
      capabilitiesVersion: 1,
      tenant: {
        id: auth.tenantId,
      },
      user: {
        id: auth.userId,
        role: auth.role,
        customRoleId: auth.customRoleId ?? null,
        storeIds: auth.storeIds,
        storeScope: auth.storeIds.length === 0 ? "all" : "restricted",
        permissions: auth.permissions,
        scopes: auth.scopes,
        allAccess,
        apiKeyRestricted: auth.scopes.length > 0,
      },
      business: {
        type: businessType,
        source: options.businessSource ?? (storedBusinessType && BUSINESS_BUNDLES[storedBusinessType] ? "stored" : "default"),
        label: bundle.name,
        description: bundle.description,
        icon: bundle.icon,
      },
      plan,
      entitlements: {
        source: "placeholder",
        enforced: false,
        note: "Paid plan-to-module enforcement is not implemented yet; enabled modules currently come from business pack defaults plus feature flag overrides.",
      },
      features: effectiveFeatures,
      requiredFields: profile.requiredFields,
      workflows: profile.workflows,
      moduleGroups: GROUP_LABELS,
      availableBusinessTypes: Object.entries(BUSINESS_BUNDLES).map(([key, item]) => ({
        key,
        name: item.name,
        description: item.description,
        icon: item.icon,
        modules: item.modules,
      })),
      modules,
      coreModules: Array.from(CORE_MODULES),
    };
  }

  private moduleSummary(module: ReturnType<SettingsService["buildCapabilitiesResponse"]>["modules"][number]) {
    return {
      key: module.key,
      name: module.name,
      description: module.description,
      group: module.group,
      route: module.route ?? null,
      core: Boolean(module.core),
      source: module.source,
      disabledReason: module.disabledReason,
    };
  }

  private moduleMap(capabilities: ReturnType<SettingsService["buildCapabilitiesResponse"]>) {
    return new Map(capabilities.modules.map((module) => [module.key, module]));
  }

  private enabledModuleKeys(capabilities: ReturnType<SettingsService["buildCapabilitiesResponse"]>) {
    return capabilities.modules.filter((module) => module.enabled).map((module) => module.key);
  }

  private collectDetails(keys: string[], source: Record<string, string[]>): string[] {
    return unique(keys.flatMap((key) => source[key] ?? []));
  }

  private setupTasksForImpact(targetBusinessType: string, addedModuleKeys: string[]) {
    const addedSet = new Set(addedModuleKeys);
    const tasks = BUSINESS_SETUP_TASKS[targetBusinessType] ?? BUSINESS_SETUP_TASKS["retail"];
    return tasks.filter((task) => {
      if (!task.moduleKeys || task.moduleKeys.length === 0) return true;
      return task.moduleKeys.some((key) => addedSet.has(key));
    });
  }

  async getCapabilities(auth: CapabilitiesAuth) {
    const { businessData, flags, plan } = await this.readCapabilityInputs(auth.tenantId);
    return this.buildCapabilitiesResponse(auth, businessData, flags, plan);
  }

  async getCapabilitiesImpact(auth: CapabilitiesAuth, requestedTarget: CapabilitiesImpactRequest) {
    const targetRequest = this.validateImpactRequest(requestedTarget);
    const { businessData, flags, plan } = await this.readCapabilityInputs(auth.tenantId);
    const current = this.buildCapabilitiesResponse(auth, businessData, flags, plan);
    const targetBusinessType = targetRequest.businessType ?? current.business.type;
    const moduleOverrides: Record<string, boolean> = {};
    for (const key of targetRequest.enabledModules) moduleOverrides[key] = true;
    for (const key of targetRequest.disabledModules) moduleOverrides[key] = false;

    const target = this.buildCapabilitiesResponse(auth, businessData, flags, plan, {
      businessType: targetBusinessType,
      businessSource: targetRequest.businessType ? "preview" : current.business.source,
      moduleOverrides,
      useStoredModuleFlags: !targetRequest.businessType,
    });

    const currentEnabledKeys = this.enabledModuleKeys(current);
    const targetEnabledKeys = this.enabledModuleKeys(target);
    const moduleDiff = diffLists(currentEnabledKeys, targetEnabledKeys);
    const currentModules = this.moduleMap(current);
    const targetModules = this.moduleMap(target);
    const addedModules = moduleDiff.added.map((key) => this.moduleSummary(targetModules.get(key)!));
    const removedModules = moduleDiff.removed.map((key) => this.moduleSummary(currentModules.get(key)!));
    const requiredFieldDiff = diffRecordLists(current.requiredFields, target.requiredFields);
    const workflowDiff = diffLists(current.workflows, target.workflows);
    const permissions = {
      added: this.collectDetails(moduleDiff.added, MODULE_PERMISSIONS),
      removed: this.collectDetails(moduleDiff.removed, MODULE_PERMISSIONS),
    };
    const reports = {
      added: this.collectDetails(moduleDiff.added, MODULE_REPORTS),
      removed: this.collectDetails(moduleDiff.removed, MODULE_REPORTS),
    };
    const pages = {
      added: unique(addedModules.map((module) => module.route).filter((route): route is string => Boolean(route))),
      removed: unique(removedModules.map((module) => module.route).filter((route): route is string => Boolean(route))),
    };
    const setupTasks = this.setupTasksForImpact(target.business.type, moduleDiff.added);
    const hasModuleOverrides = Object.keys(moduleOverrides).length > 0;

    return {
      impactVersion: 1,
      readOnly: true,
      from: {
        businessType: current.business.type,
        label: current.business.label,
        enabledModuleCount: currentEnabledKeys.length,
      },
      to: {
        businessType: target.business.type,
        label: target.business.label,
        enabledModuleCount: targetEnabledKeys.length,
      },
      summary: {
        businessTypeChanged: current.business.type !== target.business.type,
        modulesAdded: addedModules.length,
        modulesRemoved: removedModules.length,
        requiredFieldEntitiesChanged: requiredFieldDiff.changedEntities.length,
        workflowsAdded: workflowDiff.added.length,
        workflowsRemoved: workflowDiff.removed.length,
        setupTasksRequired: setupTasks.length,
      },
      modules: {
        added: addedModules,
        removed: removedModules,
        unchangedEnabled: moduleDiff.unchanged,
        targetEnabled: targetEnabledKeys,
      },
      requiredFields: requiredFieldDiff,
      workflows: workflowDiff,
      permissions,
      reports,
      pages,
      setupTasks,
      current: {
        business: current.business,
        features: current.features,
        requiredFields: current.requiredFields,
        workflows: current.workflows,
        enabledModules: currentEnabledKeys,
      },
      target: {
        business: target.business,
        features: target.features,
        requiredFields: target.requiredFields,
        workflows: target.workflows,
        enabledModules: targetEnabledKeys,
      },
      apply: {
        method: "POST",
        endpoint: "/api/v1/settings/business-profile",
        body: hasModuleOverrides
          ? { businessType: target.business.type, enabledModules: targetEnabledKeys }
          : { businessType: target.business.type },
      },
      warnings: [
        "Preview is read-only; it does not change tenant settings.",
        "Plan-to-module entitlement enforcement is still a placeholder.",
        "Only retail may be treated as Built and verified until retail release gates pass.",
      ],
    };
  }

  // ── Shipping methods ──────────────────────────────────────────────────────
  async listShipping(tenantId: string) {
    return this.db.query<ShippingMethod>("SELECT * FROM shipping_methods WHERE tenant_id = @t ORDER BY sequence ASC, name ASC LIMIT 200", { t: tenantId });
  }
  async createShipping(b: { name: string; amountCents: number; freeLimitCents?: number; ecommerce?: boolean; sequence?: number; creditAccountId?: string; debitAccountId?: string }, tenantId: string) {
    const row: ShippingMethod = { id: `shm_${uuidv7()}`, tenant_id: tenantId, name: b.name, amount_cents: b.amountCents, free_limit_cents: b.freeLimitCents ?? null, ecommerce: b.ecommerce ? 1 : 0, sequence: b.sequence ?? 0, credit_account_id: b.creditAccountId ?? null, debit_account_id: b.debitAccountId ?? null, active: 1 };
    await this.db.query(
      `INSERT INTO shipping_methods (id, tenant_id, name, amount_cents, free_limit_cents, ecommerce, sequence, credit_account_id, debit_account_id, active)
       VALUES (@id,@tenant_id,@name,@amount_cents,@free_limit_cents,@ecommerce,@sequence,@credit_account_id,@debit_account_id,@active)`,
      row as unknown as Record<string, unknown>,
    );
    return row;
  }
  async deleteShipping(id: string, tenantId: string) {
    const r = await this.db.one("SELECT id FROM shipping_methods WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!r) throw notFound(`shipping method '${id}' not found`);
    await this.db.query("DELETE FROM shipping_methods WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    return { ok: true };
  }

  // ── Payment terms ─────────────────────────────────────────────────────────
  async listTerms(tenantId: string) { return this.db.query<PaymentTerm>("SELECT * FROM payment_terms WHERE tenant_id = @t ORDER BY days_due ASC LIMIT 200", { t: tenantId }); }
  async createTerm(b: { name: string; daysDue: number; description?: string }, tenantId: string) {
    const row: PaymentTerm = { id: `pt_${uuidv7()}`, tenant_id: tenantId, name: b.name, days_due: b.daysDue, description: b.description ?? null, active: 1 };
    await this.db.query("INSERT INTO payment_terms (id, tenant_id, name, days_due, description, active) VALUES (@id,@tenant_id,@name,@days_due,@description,@active)", row as unknown as Record<string, unknown>);
    return row;
  }

  // ── Payment modes ─────────────────────────────────────────────────────────
  async listModes(tenantId: string) { return this.db.query<PaymentMode>("SELECT * FROM payment_modes WHERE tenant_id = @t ORDER BY name ASC LIMIT 200", { t: tenantId }); }
  async createMode(b: { name: string }, tenantId: string) {
    const row: PaymentMode = { id: `pm_${uuidv7()}`, tenant_id: tenantId, name: b.name, active: 1 };
    await this.db.query("INSERT INTO payment_modes (id, tenant_id, name, active) VALUES (@id,@tenant_id,@name,@active)", row as unknown as Record<string, unknown>);
    return row;
  }

  // ── Tax rates ─────────────────────────────────────────────────────────────
  async listTaxRates(tenantId: string) { return this.db.query<TaxRate>("SELECT * FROM tax_rates WHERE tenant_id = @t ORDER BY name ASC LIMIT 200", { t: tenantId }); }
  async createTaxRate(b: { name: string; rateBps: number; applyToCategory?: string; state?: string }, tenantId: string) {
    const row: TaxRate = { id: `tax_${uuidv7()}`, tenant_id: tenantId, name: b.name, rate_bps: b.rateBps, apply_to_category: b.applyToCategory ?? null, state: b.state ?? null, active: 1 };
    await this.db.query("INSERT INTO tax_rates (id, tenant_id, name, rate_bps, apply_to_category, state, active) VALUES (@id,@tenant_id,@name,@rate_bps,@apply_to_category,@state,@active)", row as unknown as Record<string, unknown>);
    return row;
  }

  // ── Currencies ────────────────────────────────────────────────────────────
  async listCurrencies(tenantId: string) {
    return this.db.query(
      "SELECT * FROM supported_currencies WHERE tenant_id = @t AND is_active = true ORDER BY is_base DESC, currency_code ASC",
      { t: tenantId }
    );
  }

  // ── Receipt templates (one per outlet, stored in settings_kv) ─────────────

  private receiptKey(outletId: string) { return `receipt_template:${outletId}`; }

  private defaultReceipt(outletId: string) {
    return {
      outletId,
      headerText: "Thank you for visiting!",
      footerText: "See you again soon.",
      contactInfo: "",
      returnPolicy: "Returns accepted within 30 days with receipt.",
      showLogo: true,
      showBarcode: true,
      showTaxBreakdown: true,
    };
  }

  async getReceiptTemplate(outletId: string, tenantId: string) {
    return this.kvGet(this.receiptKey(outletId), tenantId, this.defaultReceipt(outletId));
  }

  async setReceiptTemplate(outletId: string, data: Record<string, unknown>, tenantId: string) {
    const current = await this.getReceiptTemplate(outletId, tenantId);
    const merged = { ...current, ...data, outletId };
    await this.kvSet(this.receiptKey(outletId), merged, tenantId);
    return merged;
  }

  /** Seed sensible defaults (idempotent: only when a table is empty). */
  async seedDefaults(tenantId: string) {
    const sm = await this.listShipping(tenantId);
    if (sm.length === 0) {
      await this.createShipping({ name: "Delivery", amountCents: 1500, sequence: 1, ecommerce: true }, tenantId);
      await this.createShipping({ name: "In-store Pickup", amountCents: 0, sequence: 2, ecommerce: true }, tenantId);
    }
    const pt = await this.listTerms(tenantId);
    if (pt.length === 0) {
      for (const [name, days] of [["COD", 0], ["Net 15", 15], ["Net 30", 30]] as Array<[string, number]>) await this.createTerm({ name, daysDue: days }, tenantId);
    }
    const pm = await this.listModes(tenantId);
    if (pm.length === 0) for (const name of ["Cash", "Check", "ACH", "Credit Card", "Wire"]) await this.createMode({ name }, tenantId);
    return { ok: true };
  }
}
