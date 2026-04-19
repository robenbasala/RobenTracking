"use client"

import { apiGet, apiUrl } from "@/services/api"
import { MainAppShell } from "@/components/main-app-shell"
import { FilterBar, type ViewTypeTab, type FacilityOption } from "@/components/filter-bar"
import { PendingTrackingGrid } from "@/components/pending-tracking-grid"
import { UserPlus } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

const DEFAULT_COMPANY_ID = Number(
  process.env.NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID ?? "1"
)

const DEFAULT_FACILITY_ID =
  process.env.NEXT_PUBLIC_DEFAULT_FACILITY_ID?.trim() || ""

const DEFAULT_STATE = process.env.NEXT_PUBLIC_DEFAULT_STATE?.trim() || ""

const VIEW_TYPES_FETCH_TIMEOUT_MS = 20_000

export default function TrackingPage() {
  const [viewTypeTabs, setViewTypeTabs] = useState<ViewTypeTab[]>([])
  const [tabsLoading, setTabsLoading] = useState(true)
  const [tabsError, setTabsError] = useState<string | null>(null)
  const [activeViewType, setActiveViewType] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [facilities, setFacilities] = useState<FacilityOption[]>([])
  const [facilityFilter, setFacilityFilter] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const companyId = Number.isFinite(DEFAULT_COMPANY_ID)
    ? DEFAULT_COMPANY_ID
    : 1

  const loadViewTypes = useCallback(async () => {
    setTabsLoading(true)
    setTabsError(null)
    const ac = new AbortController()
    const timeoutId = window.setTimeout(
      () => ac.abort(),
      VIEW_TYPES_FETCH_TIMEOUT_MS
    )
    try {
      const params = new URLSearchParams()
      params.set("companyId", String(companyId))
      if (DEFAULT_FACILITY_ID) params.set("facilityId", DEFAULT_FACILITY_ID)

      const res = await apiGet(`/api/pending-tracking/view-types?${params}`, {
        cache: "no-store",
        signal: ac.signal,
      })
      const data = (await res.json()) as {
        tabs?: { viewType: string; label: string }[]
        error?: string
      }
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load payer tabs.")
      }
      const raw = data.tabs ?? []
      const tabs: ViewTypeTab[] = raw.map((t) => ({
        viewType: t.viewType,
        label: t.label,
      }))
      setViewTypeTabs(tabs)
      setActiveViewType((prev) => {
        if (prev && tabs.some((x) => x.viewType === prev)) return prev
        return tabs[0]?.viewType ?? ""
      })
    } catch (e) {
      setViewTypeTabs([])
      setActiveViewType("")
      const aborted =
        typeof e === "object" &&
        e !== null &&
        "name" in e &&
        (e as { name: string }).name === "AbortError"
      setTabsError(
        aborted
          ? `Request timed out after ${VIEW_TYPES_FETCH_TIMEOUT_MS / 1000}s. Ensure the API server is running and NEXT_PUBLIC_API_BASE_URL points to it; check backend logs and TRACKING_DB_CONNECTION_STRING on the server.`
          : e instanceof Error
            ? e.message
            : "Could not load payer tabs."
      )
    } finally {
      clearTimeout(timeoutId)
      setTabsLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void loadViewTypes()
  }, [loadViewTypes])

  useEffect(() => {
    async function loadFacilities() {
      try {
        const params = new URLSearchParams()
        params.set("companyId", String(companyId))
        const res = await apiGet(`/api/pending-tracking/facilities?${params}`, {
          cache: "no-store",
        })
        const data = (await res.json()) as { facilities?: FacilityOption[] }
        setFacilities(data.facilities ?? [])
      } catch {
        // silent — dropdown just won't show
      }
    }
    void loadFacilities()
  }, [companyId])

  const handleExport = useCallback(() => {
    if (!activeViewType) return
    const params = new URLSearchParams()
    params.set("companyId", String(companyId))
    params.set("viewType", activeViewType)
    if (DEFAULT_STATE) params.set("state", DEFAULT_STATE)
    if (facilityFilter || DEFAULT_FACILITY_ID)
      params.set("facilityId", facilityFilter || DEFAULT_FACILITY_ID)
    if (debouncedSearch) params.set("search", debouncedSearch)
    window.open(apiUrl(`/api/pending-tracking/export?${params}`), "_blank")
  }, [companyId, activeViewType, facilityFilter, debouncedSearch])

  return (
    <MainAppShell onExport={handleExport}>
      <div className="mb-10 flex flex-col items-end justify-between gap-6 md:flex-row">
        <div className="max-w-2xl">
          <span className="mb-2 block text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
            Peak Healthcare
          </span>
          <h1 className="font-headline mb-2 text-4xl font-extrabold tracking-tight text-on-surface">
            Medicaid Pending List Report
          </h1>
          <p className="text-lg text-on-surface-variant">
            Detailed administrative view for case management and financial
            tracking of pending applications.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-on-primary shadow-lg transition-all hover:scale-[1.02] hover:shadow-primary/20 active:scale-[0.98]"
            onClick={() =>
              window.alert("Add Resident — connect create flow when ready.")
            }
          >
            <UserPlus className="h-5 w-5" />
            <span className="font-bold tracking-tight">Add Resident</span>
          </button>
        </div>
      </div>

      <FilterBar
        tabs={viewTypeTabs}
        tabsLoading={tabsLoading}
        activeViewType={activeViewType}
        onViewTypeChange={setActiveViewType}
        search={searchInput}
        onSearchChange={setSearchInput}
        facilities={facilities}
        facilityFilter={facilityFilter}
        onFacilityChange={setFacilityFilter}
      />

      {tabsError && (
        <div
          className="mb-6 rounded-2xl border border-error/30 bg-error-container/20 px-5 py-4 text-sm text-on-error-container"
          role="alert"
        >
          <p className="font-semibold">Could not load payer programs</p>
          <p className="mt-1 text-on-surface-variant">{tabsError}</p>
        </div>
      )}

      {!tabsLoading && activeViewType ? (
        <PendingTrackingGrid
          key={`${companyId}-${facilityFilter || DEFAULT_FACILITY_ID}-${activeViewType}-${debouncedSearch}`}
          companyId={companyId}
          facilityId={facilityFilter || DEFAULT_FACILITY_ID || undefined}
          state={DEFAULT_STATE || undefined}
          viewType={activeViewType}
          search={debouncedSearch}
        />
      ) : null}
    </MainAppShell>
  )
}
