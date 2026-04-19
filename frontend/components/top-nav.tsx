"use client"

import { Bell, FileDown, User } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const topLinks = [
  { href: "/", label: "Tracking" },
  { href: "/tasks", label: "Tasks" },
  { href: "/hot-cases", label: "Hot cases" },
] as const

function navLinkActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === ""
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function TopNav({ onExport }: { onExport?: () => void }) {
  const pathname = usePathname() ?? "/"

  return (
    <header className="fixed left-0 top-0 z-50 flex h-16 w-full items-center justify-between border-b border-slate-200/15 bg-white/80 px-6 shadow-[0px_12px_32px_rgba(39,52,62,0.06)] backdrop-blur-md dark:bg-slate-900/80">
      <div className="flex items-center gap-8">
        <Link
          href="/"
          className="bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text text-xl font-bold text-transparent"
        >
          SNF Tracker
        </Link>
        <div className="hidden items-center gap-6 md:flex">
          <nav className="flex gap-1">
            {topLinks.map((item) => {
              const active = navLinkActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex h-16 items-center px-3 text-sm font-medium transition-colors",
                    active
                      ? "border-b-2 border-blue-700 font-bold text-blue-700 dark:text-blue-400"
                      : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/50"
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="group relative">
          <Bell className="h-5 w-5 cursor-pointer text-on-surface-variant transition-colors group-hover:text-primary" />
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-error" />
        </div>
        <button
          type="button"
          className="flex items-center gap-2 rounded-xl bg-surface-container-low px-4 py-2 transition-all hover:bg-surface-container-high"
          onClick={onExport}
        >
          <FileDown className="h-4 w-4" />
          <span className="text-sm font-semibold uppercase tracking-wider">
            Export to Excel
          </span>
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/20 bg-primary">
          <User className="h-4 w-4 text-on-primary" />
        </div>
      </div>
    </header>
  )
}
