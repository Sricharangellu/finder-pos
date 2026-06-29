"use client";

import { useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { clsx } from "clsx";

interface ModuleDef {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  enabled: boolean;
  plan: "starter" | "growth" | "enterprise";
}

const MODULES: ModuleDef[] = [
  // Core
  { id: "catalog",        name: "Product Catalog",      description: "Products, variants, categories, and pricing",             category: "Core",          icon: "📦", enabled: true,  plan: "starter" },
  { id: "inventory",      name: "Inventory",             description: "Stock tracking, adjustments, low-stock alerts",          category: "Core",          icon: "🏪", enabled: true,  plan: "starter" },
  { id: "orders",         name: "Orders",                description: "Order management and fulfillment",                       category: "Core",          icon: "🛒", enabled: true,  plan: "starter" },
  { id: "payments",       name: "Payments",              description: "Multi-tender payments with receipt printing",            category: "Core",          icon: "💳", enabled: true,  plan: "starter" },
  { id: "customers",      name: "Customers",             description: "Customer profiles, history, and segments",               category: "Core",          icon: "👥", enabled: true,  plan: "starter" },
  // Retail
  { id: "discounts",      name: "Discounts & Promotions",description: "Coupon codes, bulk pricing, flash sales",                category: "Retail",        icon: "🏷️", enabled: true,  plan: "starter" },
  { id: "gift-cards",     name: "Gift Cards",            description: "Physical and digital gift card management",              category: "Retail",        icon: "🎁", enabled: true,  plan: "growth"  },
  { id: "loyalty",        name: "Loyalty Program",       description: "Points, tiers, and rewards for repeat customers",        category: "Retail",        icon: "⭐", enabled: false, plan: "growth"  },
  { id: "ecommerce",      name: "E-Commerce",            description: "Online store with cart, checkout, and product pages",    category: "Retail",        icon: "🌐", enabled: false, plan: "growth"  },
  // Operations
  { id: "purchasing",     name: "Purchasing",            description: "Purchase orders, supplier management, receiving",        category: "Operations",    icon: "📋", enabled: true,  plan: "growth"  },
  { id: "fulfillment",    name: "Fulfillment",           description: "Pick, pack, and ship with barcode scanning",            category: "Operations",    icon: "📬", enabled: false, plan: "growth"  },
  { id: "shipping",       name: "Shipping",              description: "Carrier integrations, label printing, tracking",         category: "Operations",    icon: "🚚", enabled: false, plan: "growth"  },
  { id: "returns",        name: "Returns & Refunds",     description: "RMA workflow, refund policies, restocking",             category: "Operations",    icon: "↩️", enabled: true,  plan: "growth"  },
  // Finance
  { id: "accounting",     name: "Accounting",            description: "GL, P&L, balance sheet, journal entries",               category: "Finance",       icon: "📊", enabled: false, plan: "growth"  },
  { id: "invoicing",      name: "Customer Invoices",     description: "B2B invoicing with payment terms and net30/60",         category: "Finance",       icon: "🧾", enabled: false, plan: "growth"  },
  { id: "quotes",         name: "Quotes",                description: "Sales quotes with approval workflow",                   category: "Finance",       icon: "📝", enabled: false, plan: "growth"  },
  // Vertical: Restaurant
  { id: "restaurant-floor-plan", name: "Floor Plan",    description: "Table management, sections, and session tracking",       category: "Restaurant",    icon: "🍽️", enabled: false, plan: "growth"  },
  { id: "restaurant-kitchen",    name: "Kitchen Display",description: "KDS with course-by-course order routing",               category: "Restaurant",    icon: "👨‍🍳", enabled: false, plan: "growth"  },
  { id: "restaurant-tabs",       name: "Bar Tabs",       description: "Open tabs, multi-round ordering, tab closure",          category: "Restaurant",    icon: "🍺", enabled: false, plan: "growth"  },
  // Vertical: Hospitality
  { id: "hospitality-rooms",    name: "Room Management", description: "Hotel rooms, status, folio charges",                    category: "Hospitality",   icon: "🛏️", enabled: false, plan: "growth"  },
  // Vertical: Services
  { id: "appointments",         name: "Appointments",    description: "Online booking, service catalog, staff scheduling",     category: "Services",      icon: "📅", enabled: false, plan: "growth"  },
  { id: "service-orders",       name: "Service Orders",  description: "Repair tracking with parts and labor billing",         category: "Services",      icon: "🔧", enabled: false, plan: "growth"  },
  // Vertical: Healthcare
  { id: "healthcare-patients",  name: "Patients",        description: "Patient records, prescriptions, and medical history",  category: "Healthcare",    icon: "🏥", enabled: false, plan: "enterprise" },
  // Vertical: Manufacturing
  { id: "manufacturing-orders", name: "Production Orders",description: "BOM, work orders, production tracking",               category: "Manufacturing", icon: "🏭", enabled: false, plan: "enterprise" },
  // Vertical: Automotive
  { id: "automotive-vehicles",  name: "Vehicles",        description: "Vehicle registry with owner records",                  category: "Automotive",    icon: "🚗", enabled: false, plan: "growth"  },
  { id: "automotive-work-orders",name: "Work Orders",    description: "Repair work orders with labor and parts tracking",     category: "Automotive",    icon: "🔩", enabled: false, plan: "growth"  },
  // Vertical: Rental
  { id: "rental-assets",        name: "Rental Assets",   description: "Asset inventory, daily rates, availability",           category: "Rental",        icon: "📷", enabled: false, plan: "growth"  },
  { id: "rental-contracts",     name: "Rental Contracts",description: "Rental agreements, returns, and overdue tracking",     category: "Rental",        icon: "📄", enabled: false, plan: "growth"  },
  // Vertical: Entertainment
  { id: "entertainment-tickets",name: "Events & Tickets","description": "Event management, ticket sales, QR check-in",       category: "Entertainment", icon: "🎟️", enabled: false, plan: "growth"  },
  // Vertical: Education
  { id: "education-students",   name: "Students",        description: "Enrollment, programs, and fee management",             category: "Education",     icon: "🎓", enabled: false, plan: "enterprise" },
  // Enterprise
  { id: "team",                 name: "Team & Roles",    description: "Staff accounts, custom RBAC, shift scheduling",        category: "Enterprise",    icon: "👤", enabled: true,  plan: "growth"  },
  { id: "sso",                  name: "SSO / SAML",      description: "Enterprise SSO via SAML 2.0 and OIDC",                category: "Enterprise",    icon: "🔐", enabled: false, plan: "enterprise" },
  { id: "workflows",            name: "Workflows",       description: "Trigger-based automation with webhook actions",        category: "Enterprise",    icon: "⚡", enabled: false, plan: "enterprise" },
  { id: "audit-log",            name: "Audit Log",       description: "Full immutable audit trail for compliance",            category: "Enterprise",    icon: "🔍", enabled: true,  plan: "enterprise" },
];

const PLAN_BADGE: Record<ModuleDef["plan"], "gray" | "blue" | "purple"> = {
  starter:    "gray",
  growth:     "blue",
  enterprise: "purple",
};

const ALL_CATEGORIES = ["All", ...Array.from(new Set(MODULES.map(m => m.category)))];

export default function ModulesMarketplacePage() {
  const [modules, setModules] = useState<ModuleDef[]>(MODULES);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showEnabled, setShowEnabled] = useState(false);

  function toggle(id: string) {
    setModules(prev => prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m));
  }

  const filtered = modules.filter(m => {
    const matchCat = categoryFilter === "All" || m.category === categoryFilter;
    const matchSearch = search === "" || `${m.name} ${m.description} ${m.category}`.toLowerCase().includes(search.toLowerCase());
    const matchEnabled = !showEnabled || m.enabled;
    return matchCat && matchSearch && matchEnabled;
  });

  const enabledCount = modules.filter(m => m.enabled).length;

  const grouped = ALL_CATEGORIES.slice(1).reduce<Record<string, ModuleDef[]>>((acc, cat) => {
    const inCat = filtered.filter(m => m.category === cat);
    if (inCat.length > 0) acc[cat] = inCat;
    return acc;
  }, {});

  return (
    <EnterpriseShell active="setup-modules" title="Module Marketplace" subtitle="Enable and configure business modules for your account">
      <div className="flex flex-col gap-6 p-6">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Enabled</p>
            <p className="mt-1 text-2xl font-bold text-green-600">{enabledCount}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Available</p>
            <p className="mt-1 text-2xl font-bold">{modules.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Categories</p>
            <p className="mt-1 text-2xl font-bold">{ALL_CATEGORIES.length - 1}</p>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input type="text" placeholder="Search modules…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[180px] rounded border border-[#D9D9D9] px-3 py-1.5 text-sm" />
          <label className="flex items-center gap-1.5 text-xs text-[rgba(0,0,0,0.65)] cursor-pointer select-none">
            <input type="checkbox" checked={showEnabled} onChange={e => setShowEnabled(e.target.checked)} className="rounded" />
            Active only
          </label>
        </div>
        <div className="flex flex-wrap gap-1">
          {ALL_CATEGORIES.map(cat => (
            <button key={cat} type="button" onClick={() => setCategoryFilter(cat)}
              className={clsx("rounded-full px-3 py-1 text-xs font-medium transition-colors",
                categoryFilter === cat ? "bg-brand-600 text-white" : "bg-[#F5F5F5] text-[rgba(0,0,0,0.65)] hover:bg-[#EBEBEB]")}>
              {cat}
            </button>
          ))}
        </div>

        {/* Module groups */}
        {Object.entries(grouped).map(([category, mods]) => (
          <div key={category}>
            <h3 className="mb-3 text-sm font-semibold text-[rgba(0,0,0,0.65)] uppercase tracking-wide">{category}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mods.map(mod => (
                <div key={mod.id} className={clsx("rounded-lg border p-4 transition-all",
                  mod.enabled ? "border-brand-300 bg-brand-50/30" : "border-[#E8E8E8] bg-white")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{mod.icon}</span>
                      <div>
                        <p className="font-semibold text-sm text-[rgba(0,0,0,0.88)]">{mod.name}</p>
                        <Badge variant={PLAN_BADGE[mod.plan]} size="sm">{mod.plan}</Badge>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(mod.id)}
                      className={clsx("relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer",
                        mod.enabled ? "bg-brand-600" : "bg-[#D9D9D9]")}>
                      <span className={clsx("pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform",
                        mod.enabled ? "translate-x-4" : "translate-x-0")} />
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-[rgba(0,0,0,0.55)] leading-relaxed">{mod.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No modules match your search.</div>
        )}
      </div>
    </EnterpriseShell>
  );
}
