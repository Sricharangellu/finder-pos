"use client";

import Link from "next/link";

function QuickActionCard({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-[64px] items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">
        {icon}
      </span>
      <span className="min-w-0 text-sm font-semibold text-slate-800">{label}</span>
    </Link>
  );
}

function IconRegister() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h8M8 15h2M14 15h2" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </svg>
  );
}

function IconQuote() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

export function DashboardQuickActions() {
  return (
    <section aria-label="Quick actions">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
        Quick Actions
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <QuickActionCard href="/terminal" label="New Sale" icon={<IconRegister />} />
        <QuickActionCard href="/catalog?new=product" label="Add Product" icon={<IconPlus />} />
        <QuickActionCard href="/quotes" label="New Quote" icon={<IconQuote />} />
        <QuickActionCard href="/reports" label="View Reports" icon={<IconChart />} />
        <QuickActionCard href="/inventory" label="Manage Inventory" icon={<IconBox />} />
      </div>
    </section>
  );
}
