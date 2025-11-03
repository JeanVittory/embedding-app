"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/ask-question", label: "Ask question" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/60 bg-slate-950/75 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-lg font-semibold text-slate-100 transition hover:text-indigo-300"
        >
          vector
          <span className="text-indigo-400">App</span>
        </Link>
        <nav className="flex items-center gap-2 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-3 py-2 transition-colors",
                  isActive
                    ? "bg-slate-900/80 text-slate-100 shadow-inner shadow-indigo-500/20"
                    : "text-slate-400 hover:bg-slate-900/60 hover:text-slate-100",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
