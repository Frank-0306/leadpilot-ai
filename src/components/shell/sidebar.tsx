"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import {
  IconBolt,
  IconClose,
  IconDashboard,
  IconLeads,
  IconLogout,
  IconMenu,
  IconPipeline,
  IconSearch,
  IconSettings,
  IconTasks,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./theme-toggle";
import { openCommandPalette } from "./command-palette";

interface NavProps {
  isAdmin: boolean;
  userName: string;
  userColor?: string;
  roleLabel: string;
  overdueTasks: number;
}

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { href: "/leads", label: "Leads", icon: IconLeads },
  { href: "/pipeline", label: "Pipeline", icon: IconPipeline },
  { href: "/tasks", label: "Tasks", icon: IconTasks },
];
const ADMIN_NAV = [
  { href: "/automations", label: "Automations", icon: IconBolt },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

function Mark() {
  // Compass-needle mark: a lead being steered toward "won".
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <rect width="22" height="22" rx="6" fill="var(--ink)" />
      <path d="M11 4.5 14 11l-3 6.5L8 11l3-6.5Z" fill="var(--canvas)" />
      <path d="M11 4.5 14 11H8l3-6.5Z" fill="var(--accent)" />
    </svg>
  );
}

function NavLinks({ isAdmin, overdueTasks, onNavigate }: { isAdmin: boolean; overdueTasks: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const items = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item, i) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <li key={item.href} className={i === NAV.length ? "mt-4" : undefined}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
                active ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <Icon size={17} className={active ? "text-accent" : "text-faint group-hover:text-muted"} />
              <span className="flex-1">{item.label}</span>
              {item.href === "/tasks" && overdueTasks > 0 ? (
                <span className="tabular rounded px-1.5 text-[11.5px] font-semibold text-danger" title={`${overdueTasks} overdue`}>
                  {overdueTasks}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarBody(props: NavProps & { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-5 px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <Mark />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">LeadPilot</span>
        <span className="ml-auto rounded border border-line px-1.5 text-[11px] text-muted" title="Demo workspace">
          Northstar
        </span>
      </div>

      <button
        type="button"
        onClick={() => {
          props.onNavigate?.();
          openCommandPalette();
        }}
        className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2 text-[13px] text-faint hover:border-line-strong hover:text-muted"
      >
        <IconSearch size={15} />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-line px-1 font-sans text-[11px]">Ctrl K</kbd>
      </button>

      <nav aria-label="Main">
        <NavLinks isAdmin={props.isAdmin} overdueTasks={props.overdueTasks} onNavigate={props.onNavigate} />
      </nav>

      <div className="mt-auto flex items-center gap-2 rounded-md px-2 py-1.5">
        <Avatar name={props.userName} color={props.userColor} size={26} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-medium">{props.userName}</p>
          <p className="text-[12px] text-muted">{props.roleLabel}</p>
        </div>
        <ThemeToggle />
        <form action={signOutAction}>
          <button className="grid size-8 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink" aria-label="Sign out" title="Sign out">
            <IconLogout size={17} />
          </button>
        </form>
      </div>
    </div>
  );
}

export function Sidebar(props: NavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 border-r border-line lg:block">
        <SidebarBody {...props} />
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-canvas/90 px-3 backdrop-blur lg:hidden">
        <button className="grid size-9 place-items-center rounded-md text-muted hover:bg-sunken" onClick={() => setOpen(true)} aria-label="Open menu">
          <IconMenu />
        </button>
        <Mark />
        <span className="font-semibold">LeadPilot</span>
        <button className="ml-auto grid size-9 place-items-center rounded-md text-muted hover:bg-sunken" onClick={openCommandPalette} aria-label="Search">
          <IconSearch />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 animate-fade bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[268px] animate-slide-up border-r border-line bg-canvas">
            <button className="absolute top-3 right-3 grid size-8 place-items-center rounded-md text-muted hover:bg-sunken" onClick={() => setOpen(false)} aria-label="Close menu">
              <IconClose size={16} />
            </button>
            <SidebarBody {...props} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
