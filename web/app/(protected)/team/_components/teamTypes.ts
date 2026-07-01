// ── Types ─────────────────────────────────────────────────────────────────────

export type RoleId =
  | "owner" | "admin" | "manager" | "sales" | "cashier"
  | "accountant" | "receiver" | "shipper" | "driver" | "warehouse";

export type AccountStatus = "active" | "suspended" | "terminated";
export type EmploymentType = "full_time" | "part_time" | "contractor";
export type ModalTab = "profile" | "timeclock" | "account";

export interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: RoleId;
  department: string | null;
  employment_type: EmploymentType;
  hourly_rate_cents: number | null;
  status: AccountStatus;
  suspend_reason: string | null;
  pin: string | null;
  hire_date: number;
  clocked_in: boolean;
  clocked_in_at: number | null;
  today_minutes: number;
}

export interface TimeEntry {
  id: string;
  clock_in: number;
  clock_out: number | null;
  duration_mins: number | null;
  notes: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const ROLES: RoleId[] = [
  "owner", "admin", "manager", "sales", "cashier",
  "accountant", "receiver", "shipper", "driver", "warehouse",
];

export const ROLE_LABELS: Record<RoleId, string> = {
  owner: "Owner", admin: "Admin", manager: "Manager", sales: "Sales",
  cashier: "Cashier", accountant: "Accountant", receiver: "Receiver",
  shipper: "Shipper", driver: "Driver", warehouse: "Warehouse",
};

export const ROLE_COLORS: Record<RoleId, string> = {
  owner:      "bg-violet-100 text-violet-700",
  admin:      "bg-indigo-100 text-indigo-700",
  manager:    "bg-blue-100 text-blue-700",
  sales:      "bg-emerald-100 text-emerald-700",
  cashier:    "bg-cyan-100 text-cyan-700",
  accountant: "bg-amber-100 text-amber-700",
  receiver:   "bg-orange-100 text-orange-700",
  shipper:    "bg-sky-100 text-sky-700",
  driver:     "bg-teal-100 text-teal-700",
  warehouse:  "bg-slate-100 text-slate-600",
};

export const AVATAR_COLORS: Record<RoleId, string> = {
  owner:      "bg-violet-600 text-white",
  admin:      "bg-indigo-600 text-white",
  manager:    "bg-blue-600 text-white",
  sales:      "bg-emerald-600 text-white",
  cashier:    "bg-cyan-600 text-white",
  accountant: "bg-amber-600 text-white",
  receiver:   "bg-orange-600 text-white",
  shipper:    "bg-sky-600 text-white",
  driver:     "bg-teal-600 text-white",
  warehouse:  "bg-slate-600 text-white",
};

export const DEPT_OPTIONS = [
  "Operations", "Front End", "Back Office", "Finance", "Warehouse",
  "Delivery", "IT", "Sales", "Customer Service", "Management",
];

export const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time", part_time: "Part-time", contractor: "Contractor",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function initials(name: string): string {
  const parts = name.trim().split(" ");
  return parts.length >= 2
    ? (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

export function formatHours(minutes: number): string {
  if (minutes === 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function elapsedMins(since: number): number {
  return Math.floor((Date.now() - since) / 60_000);
}

export function fmtTime(ts: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(ts));
}

export function fmtInputDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
