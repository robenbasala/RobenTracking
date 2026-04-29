"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { TopNav } from "@/components/top-nav"
import { SideNav } from "@/components/side-nav"

export function MainAppShell({
  children,
  onExport,
  onExportPdf,
}: {
  children: React.ReactNode
  onExport?: () => void
  onExportPdf?: () => void
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("tracking.sidebarCollapsed")
      if (raw === "1") setSidebarCollapsed(true)
      if (raw === "0") setSidebarCollapsed(false)
    } catch {
      // ignore storage errors
    }
  }, [])

  const handleToggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem("tracking.sidebarCollapsed", next ? "1" : "0")
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  return (
    <div className="min-h-screen bg-surface">
      <TopNav onExport={onExport} onExportPdf={onExportPdf} />
      <SideNav
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
      />
      <main
        className={cn(
          sidebarCollapsed ? "ml-16" : "ml-64",
          "min-h-screen p-8 pt-20 transition-all duration-200"
        )}
      >
        {children}
      </main>
    </div>
  )
}
