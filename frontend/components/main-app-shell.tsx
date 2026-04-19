"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { TopNav } from "@/components/top-nav"
import { SideNav } from "@/components/side-nav"

export function MainAppShell({ children, onExport }: { children: React.ReactNode; onExport?: () => void }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-surface">
      <TopNav onExport={onExport} />
      <SideNav
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
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
