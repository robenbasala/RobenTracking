"use client"

import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

export type ViewTypeTab = {
  viewType: string
  label: string
}

export type FacilityOption = {
  facilityId: string
  facilityName: string
}

type FilterBarProps = {
  tabs: ViewTypeTab[]
  tabsLoading?: boolean
  activeViewType: string
  onViewTypeChange: (viewType: string) => void
  search: string
  onSearchChange: (value: string) => void
  facilities?: FacilityOption[]
  facilityFilter?: string
  onFacilityChange?: (value: string) => void
}

/** @deprecated tabs are loaded from API */
export const VIEW_TYPE_TABS: ViewTypeTab[] = []

export function FilterBar({
  tabs,
  tabsLoading,
  activeViewType,
  onViewTypeChange,
  search,
  onSearchChange,
  facilities,
  facilityFilter,
  onFacilityChange,
}: FilterBarProps) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-2 rounded-2xl bg-surface-container-low p-1">
      {tabsLoading && (
        <span className="px-3 py-2 text-sm text-on-surface-variant">
          Loading view types…
        </span>
      )}
      {!tabsLoading &&
        tabs.map((tab) => (
          <button
            key={tab.viewType}
            type="button"
            onClick={() => onViewTypeChange(tab.viewType)}
            className={cn(
              "rounded-xl px-5 py-2 text-sm transition-all",
              activeViewType === tab.viewType
                ? "bg-surface-container-lowest font-bold text-primary shadow-sm"
                : "font-medium text-on-surface-variant hover:bg-surface-container-high"
            )}
          >
            {tab.label}
          </button>
        ))}
      {!tabsLoading && tabs.length === 0 && (
        <span className="px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          No ViewType values found for this facility. Add PendingTrackingItem rows
          or check CompanyId / FacilityId.
        </span>
      )}

      <div className="ml-auto flex items-center gap-3 border-l border-outline-variant/15 px-4">
        {facilities && facilities.length > 0 && onFacilityChange && (
          <select
            value={facilityFilter ?? ""}
            onChange={(e) => onFacilityChange(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
          >
            <option value="">All Facilities</option>
            {facilities.map((f) => (
              <option key={f.facilityId} value={f.facilityId}>
                {f.facilityName}
              </option>
            ))}
          </select>
        )}

        <Search className="h-4 w-4 text-on-surface-variant" />
        <input
          className="w-48 border-none bg-transparent text-sm focus:outline-none focus:ring-0"
          placeholder="Filter by resident name..."
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  )
}
