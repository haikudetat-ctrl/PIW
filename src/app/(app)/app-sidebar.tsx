"use client";

import Link from "next/link";
import { RakeLogo } from "@/components/brand/rake-logo";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icons";
import { formatNotificationBadge } from "@/modules/notifications/badge";
import { CompanySwitcher, type SidebarCompany } from "./company-switcher";

type NavItem = { href: string; label: string; icon: IconName; count?: number; ariaLabel?: string };

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-label={item.ariaLabel}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition ${
        active ? "bg-fill-selected text-tint" : "text-ink hover:bg-fill-hover"
      }`}
    >
      <Icon name={item.icon} className={active ? "text-tint" : "text-ink-muted"} />
      <span className="flex-1">{item.label}</span>
      {item.count ? (
        <span className={`text-xs ${active ? "text-tint" : "text-ink-subtle"}`}>{item.count}</span>
      ) : null}
    </Link>
  );
}

export function AppSidebar({
  displayName,
  roleLabel,
  reviewCount,
  unreadNotifications,
  companies = [],
  showSettings = false,
  footer,
}: {
  displayName: string;
  roleLabel: string;
  reviewCount: number;
  unreadNotifications: number;
  companies?: SidebarCompany[];
  showSettings?: boolean;
  footer: ReactNode;
}) {
  const pathname = usePathname();
  const items: NavItem[] = [
    { href: "/", label: "My day", icon: "home" },
    { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
    { href: "/reports", label: "Reports", icon: "chart" },
    { href: "/review", label: "Review", icon: "review", count: reviewCount },
    { href: "/access-route", label: "Access Route", icon: "route" },
    {
      href: "/notifications",
      label: "Notifications",
      icon: "bell",
      count: unreadNotifications,
      ariaLabel: formatNotificationBadge(unreadNotifications),
    },
  ];
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface-muted px-4 pt-5 pb-4 md:flex">
        <div className="flex items-center gap-2.5 px-1.5 pb-4">
          <div className="min-w-0">
            <RakeLogo className="h-3.5 w-auto text-ink" />
            <CompanySwitcher companies={companies} />
          </div>
        </div>
        <Link
          href="/leads/new"
          className="mb-3 flex items-center justify-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-ink transition hover:bg-fill-hover"
        >
          <Icon name="plus" /> New lead
        </Link>
        <nav aria-label="Primary" className="flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        {showSettings ? (
          <div className="mt-auto pt-3">
            <NavLink item={{ href: "/settings", label: "Settings", icon: "settings" }} pathname={pathname} />
          </div>
        ) : null}
        <div className={`${showSettings ? "" : "mt-auto "}flex items-center gap-2.5 px-1.5 pt-3`}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fill-selected text-[11px] font-medium text-tint">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ink">{displayName}</p>
            <p className="truncate text-xs text-ink-subtle">{roleLabel}</p>
          </div>
          {footer}
        </div>
      </aside>

      {/* Below md the sidebar collapses into a scrollable top bar. */}
      <header className="sticky top-0 z-10 border-b border-border bg-surface-muted/95 backdrop-blur md:hidden">
        <nav aria-label="Primary (compact)" className="flex gap-1 overflow-x-auto px-4 py-2">
          {items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
          <Link
            href="/leads/new"
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-tint"
          >
            <Icon name="plus" /> New lead
          </Link>
        </nav>
      </header>
    </>
  );
}
