"use client"

import {
  AlertTriangle,
  ClipboardList,
  Clock,
  CreditCard,
  HelpCircle,
  Settings,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const mainNavItems: Array<{
  icon: React.ComponentType<{ className?: string }>
  label: string
  href: string
}> = [
  { icon: Clock, label: "Tracking", href: "/" },
  { icon: ClipboardList, label: "Tasks", href: "/tasks" },
  { icon: AlertTriangle, label: "Hot Cases", href: "/hot-cases" },
]

const bottomNavItems = [
  { icon: Settings, label: "Field admin", href: "/admin/fields" },
  { icon: HelpCircle, label: "Support", href: "#" },
]

type SideNavProps = {
  collapsed: boolean
  onToggleCollapse: () => void
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === ""
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SideNav({ collapsed, onToggleCollapse }: SideNavProps) {
  const pathname = usePathname() ?? "/"

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-full flex-col border-r border-slate-200/15 bg-slate-50 py-6 pt-20 transition-all duration-200 dark:bg-slate-950",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {!collapsed && (
        <div className="mb-8 flex items-center gap-3 px-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-container">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-headline text-sm font-bold leading-tight text-slate-900 dark:text-slate-100">
              Clinical Architect
            </h2>
            <p className="text-xs text-on-surface-variant opacity-70">
              SNF Administration
            </p>
          </div>
        </div>
      )}

      {collapsed && (
        <div className="mb-8 flex justify-center px-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-container">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-1 px-2">
        {mainNavItems.map((item) => {
          const active = isActivePath(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg transition-all",
                collapsed ? "justify-center px-2 py-3" : "px-4 py-3",
                active
                  ? "translate-x-1 border-l-4 border-blue-700 bg-blue-50 font-bold text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
                  : "text-slate-600 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && (
                <span className="text-sm font-medium">{item.label}</span>
              )}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto space-y-1 px-2">
        <button
          type="button"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapse}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-600",
            collapsed ? "justify-center px-2 py-3" : "px-4 py-3"
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-5 w-5 shrink-0" />
          ) : (
            <ChevronsLeft className="h-5 w-5 shrink-0" />
          )}
          {!collapsed && <span className="text-sm font-medium">Collapse</span>}
        </button>

        {bottomNavItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg text-slate-600 transition-all hover:text-blue-600",
              collapsed ? "justify-center px-2 py-3" : "px-4 py-3"
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && (
              <span className="text-sm font-medium">{item.label}</span>
            )}
          </Link>
        ))}
      </div>
    </aside>
  )
}
