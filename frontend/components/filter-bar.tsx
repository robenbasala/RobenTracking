"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

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
  /** Selected facility ids (empty before user picks; parent resolves default for API). */
  selectedFacilityIds: string[]
  onFacilitySelectionChange?: (ids: string[]) => void
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
  selectedFacilityIds,
  onFacilitySelectionChange,
}: FilterBarProps) {
  const hasFacilities = facilities && facilities.length > 0 && onFacilitySelectionChange
  const [facilityPopoverOpen, setFacilityPopoverOpen] = useState(false)
  const [facilitySearch, setFacilitySearch] = useState("")

  const filteredFacilities = useMemo(() => {
    if (!facilities?.length) return []
    const q = facilitySearch.trim().toLowerCase()
    if (!q) return facilities
    return facilities.filter(
      (f) =>
        f.facilityName.toLowerCase().includes(q) ||
        String(f.facilityId).toLowerCase().includes(q)
    )
  }, [facilities, facilitySearch])

  function toggleFacility(id: string, checked: boolean) {
    if (!onFacilitySelectionChange) return
    const set = new Set(selectedFacilityIds)
    if (checked) set.add(id)
    else set.delete(id)
    onFacilitySelectionChange([...set])
  }

  function selectAll() {
    if (!onFacilitySelectionChange || !facilities?.length) return
    onFacilitySelectionChange(facilities.map((f) => f.facilityId))
  }

  function clearAll() {
    onFacilitySelectionChange?.([])
  }

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
          No ViewType values found for this facility. Add TrackingItemsTbl rows
          or check CompanyId / FacilityId.
        </span>
      )}

      <div className="ml-auto flex items-center gap-3 border-l border-outline-variant/15 px-4">
        {hasFacilities ? (
          <Popover
            open={facilityPopoverOpen}
            onOpenChange={(open) => {
              setFacilityPopoverOpen(open)
              if (!open) setFacilitySearch("")
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-10 w-full min-w-[260px] max-w-[320px] items-center gap-2 rounded-lg border bg-white px-3 text-left text-sm shadow-sm transition-colors outline-none",
                  facilityPopoverOpen
                    ? "border-blue-500 ring-2 ring-blue-200/80"
                    : "border-slate-200 hover:border-slate-300"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {selectedFacilityIds.length > 0 ? (
                    <>
                      <span
                        className="flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-semibold tabular-nums text-blue-800"
                        aria-hidden
                      >
                        {selectedFacilityIds.length}
                      </span>
                      <span className="truncate font-medium text-slate-700">
                        selected
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          clearAll()
                        }}
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    <span className="truncate font-medium text-slate-600">
                      All
                    </span>
                  )}
                </div>
                {facilityPopoverOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-slate-500" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80 min-w-[260px] max-w-[320px] border border-slate-200 bg-slate-50/95 p-0 shadow-lg"
              align="end"
            >
              <div className="border-b border-slate-200/80 bg-white px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex min-h-9 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 shadow-inner">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      type="search"
                      value={facilitySearch}
                      onChange={(e) => setFacilitySearch(e.target.value)}
                      placeholder="Search Facilities..."
                      className="min-w-0 flex-1 border-none bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-blue-600 hover:underline"
                    onClick={selectAll}
                  >
                    All
                  </button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto overscroll-contain">
                {filteredFacilities.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-slate-400">
                    No match
                  </p>
                ) : (
                  <ul className="py-1">
                    {filteredFacilities.map((f, i) => {
                      const checked = selectedFacilityIds.includes(f.facilityId)
                      return (
                        <li
                          key={f.facilityId}
                          className={cn(
                            "border-b border-slate-100/80 last:border-b-0",
                            i % 2 === 0 ? "bg-white" : "bg-slate-100/40"
                          )}
                        >
                          <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-blue-50/60">
                            <Checkbox
                              className="mt-0.5"
                              checked={checked}
                              onCheckedChange={(v) =>
                                toggleFacility(f.facilityId, v === true)
                              }
                            />
                            <span className="text-sm font-medium leading-snug text-slate-800">
                              {f.facilityName}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

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
