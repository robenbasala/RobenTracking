"use client"

import { Bell, FileSpreadsheet, FileText, User } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const topLinks = [
  { href: "/", label: "Tracking" },
  { href: "/tasks", label: "Tasks" },
  { href: "/hot-cases", label: "Hot cases" },
] as const

function navLinkActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === ""
  return pathname === href || pathname.startsWith(`${href}/`)
}

const exportBtn =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-surface-container-low px-3 text-xs font-bold tracking-wide text-slate-700 transition-colors hover:bg-surface-container-high hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-blue-300"

export function TopNav({
  onExport,
  onExportPdf,
}: {
  onExport?: () => void
  onExportPdf?: () => void
}) {
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
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="group relative">
          <Bell className="h-5 w-5 cursor-pointer text-on-surface-variant transition-colors group-hover:text-primary" />
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-error" />
        </div>
        <TooltipProvider delayDuration={400}>
          {onExport ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={exportBtn}
                  aria-label="Export to Excel"
                  onClick={onExport}
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
                  <span>Excel</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Download as Excel</TooltipContent>
            </Tooltip>
          ) : null}
          {onExportPdf ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={exportBtn}
                  aria-label="Export to PDF"
                  onClick={onExportPdf}
                >
                  <FileText className="h-4 w-4 shrink-0" aria-hidden />
                  <span>PDF</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Download as PDF</TooltipContent>
            </Tooltip>
          ) : null}
        </TooltipProvider>
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-outline-variant/20 bg-primary">
          <User className="h-4 w-4 text-on-primary" />
        </div>
      </div>
    </header>
  )
}
