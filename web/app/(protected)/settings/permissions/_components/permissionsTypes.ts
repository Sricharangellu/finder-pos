// Types and constants for the permissions page

export type BuiltInRoleId =
  | "owner" | "admin" | "manager" | "sales" | "cashier"
  | "accountant" | "receiver" | "shipper" | "driver" | "warehouse";

export interface CustomRole {
  id: string;
  name: string;
  description: string;
  color: string;
}

export interface RoleEntry {
  id: string;
  name: string;
  description: string;
  color: string;
  immutable?: boolean;
  custom?: boolean;
}

export const BUILT_IN: Record<BuiltInRoleId, Omit<RoleEntry, "id">> = {
  owner:      { name: "Owner",       description: "Business owner — full unrestricted access", color: "bg-violet-600", immutable: true },
  admin:      { name: "Admin",       description: "System administrator — full access",         color: "bg-[#5D5FEF]",  immutable: true },
  manager:    { name: "Manager",     description: "Operations and team management",             color: "bg-blue-500"   },
  sales:      { name: "Sales",       description: "Customer sales and quote management",        color: "bg-emerald-500" },
  cashier:    { name: "Cashier",     description: "POS checkout and payment processing",        color: "bg-cyan-500"   },
  accountant: { name: "Accountant",  description: "Finance, billing, and compliance",           color: "bg-amber-500"  },
  receiver:   { name: "Receiver",    description: "Inbound goods and purchase order receiving", color: "bg-orange-500" },
  shipper:    { name: "Shipper",     description: "Outbound order fulfilment and shipping",     color: "bg-sky-500"    },
  driver:     { name: "Driver",      description: "Delivery route and manifest access",         color: "bg-teal-500"   },
  warehouse:  { name: "Warehouse",   description: "General warehouse and stock management",     color: "bg-slate-500"  },
};

export const BUILT_IN_ORDER: BuiltInRoleId[] = [
  "owner", "admin", "manager", "sales", "cashier",
  "accountant", "receiver", "shipper", "driver", "warehouse",
];

export const COLOR_OPTIONS = [
  "bg-rose-500", "bg-pink-500", "bg-fuchsia-500", "bg-purple-600",
  "bg-blue-600", "bg-cyan-600", "bg-teal-600", "bg-green-600",
  "bg-lime-600", "bg-amber-600", "bg-orange-500", "bg-slate-600",
];
