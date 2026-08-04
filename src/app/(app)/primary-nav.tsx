"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/access-route", label: "Access Route" },
  { href: "/leads/new", label: "New Lead" },
  { href: "/review", label: "Review" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function PrimaryNav({ notifications }: { notifications: ReactNode }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex items-center gap-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`border-b-2 px-3 py-4 text-sm font-medium transition ${
            isActive(pathname, link.href)
              ? "border-accent text-accent"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {link.label}
        </Link>
      ))}
      <span className="ml-2">{notifications}</span>
    </nav>
  );
}
