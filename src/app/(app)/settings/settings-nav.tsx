"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";

type Item = { href: string; label: string; icon: IconName };

export function SettingsNav({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const groups: { label: string; items: Item[] }[] = [
    {
      label: "Company",
      items: [
        { href: "/settings/team", label: "Team & roles", icon: "users" },
        { href: "/settings/booking", label: "Video booking", icon: "video" },
      ],
    },
  ];
  if (isPlatformAdmin) {
    groups.push({
      label: "Platform",
      items: [
        { href: "/settings/companies", label: "Companies", icon: "building" },
        { href: "/settings/platform", label: "Platform health", icon: "pulse" },
      ],
    });
  }

  return (
    <nav aria-label="Settings" className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-2.5 text-xs text-ink-subtle">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${
                    active ? "bg-fill-selected text-tint" : "text-ink hover:bg-fill-hover"
                  }`}
                >
                  <Icon name={item.icon} className={active ? "text-tint" : "text-ink-muted"} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
