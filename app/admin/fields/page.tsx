"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  Loader2,
  Plus,
  Search,
  Bell,
  FileDown,
  Filter,
  ArrowUpDown,
} from "lucide-react"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

const DEFAULT_COMPANY_ID = Number(
  process.env.NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID ?? "1"
)

const PAGE_SIZE = 10

type AdminField = {
  fieldMetadataId: number
  fieldName: string
  displayName: string
  dataType: string
  screenLocation: string
  displayOrder: number
  isActive: boolean
  isRequired: boolean
  isEditable: boolean
  isSystemField: boolean
  sourceType: string
  viewTypes: string[]
  states: string[]
}

type SortKey =
  | "fieldName"
  | "displayName"
  | "screenLocation"
  | "displayOrder"
  | "dataType"
  | "sourceType"
  | "isActive"

function MIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span className={cn("material-symbols-outlined !text-[1.15rem]", className)}>
      {name}
    </span>
  )
}

function typeRowMeta(dataType: string): { icon: string; label: string } {
  const d = dataType.toLowerCase()
  if (d === "date") return { icon: "calendar_today", label: "Date" }
  if (d === "boolean") return { icon: "toggle_on", label: "Boolean" }
  if (d === "dropdown") return { icon: "list", label: "Dropdown" }
  if (d === "number" || d === "currency")
    return { icon: "pin", label: d === "currency" ? "Currency" : "Numeric" }
  if (d === "textarea") return { icon: "notes", label: "Textarea" }
  return { icon: "input", label: "Text" }
}

function screenBadgeLabel(loc: string): string {
  if (loc === "Main") return "Main (Grid)"
  if (loc === "Detail") return "Detail"
  if (loc === "Both") return "Main + Detail"
  return loc
}

function compareValues(a: unknown, b: unknown, asc: boolean): number {
  const dir = asc ? 1 : -1
  if (typeof a === "number" && typeof b === "number")
    return a === b ? 0 : a < b ? -dir : dir
  const sa = String(a ?? "").toLowerCase()
  const sb = String(b ?? "").toLowerCase()
  if (sa === sb) return 0
  return sa < sb ? -dir : dir
}

export default function AdminFieldsPage() {
  const pathname = usePathname()
  const [fields, setFields] = useState<AdminField[]>([])
  const [companyViewTypes, setCompanyViewTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminField | null>(null)
  const [creating, setCreating] = useState(false)
  const [selectedViewTypes, setSelectedViewTypes] = useState<Set<string>>(
    () => new Set()
  )
  const [dropdownOptions, setDropdownOptions] = useState<Array<{ fieldOptionId: number; optionValue: string; optionLabel: string | null; displayOrder: number; isActive: boolean }>>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [newOptionValue, setNewOptionValue] = useState("")
  const [newOptionLabel, setNewOptionLabel] = useState("")
  const [newOptionOrder, setNewOptionOrder] = useState(0)

  const [searchQuery, setSearchQuery] = useState("")
  const [screenFilter, setScreenFilter] = useState<
    "all" | "Main" | "Detail" | "Both"
  >("all")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">(
    "all"
  )
  const [sortKey, setSortKey] = useState<SortKey>("displayOrder")
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin/field-metadata?companyId=${DEFAULT_COMPANY_ID}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as {
        fields?: AdminField[]
        companyViewTypes?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to load")
      setFields(data.fields ?? [])
      setCompanyViewTypes(data.companyViewTypes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error")
      setFields([])
      setCompanyViewTypes([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const viewTypeOptions = useMemo(() => {
    const set = new Set(companyViewTypes)
    if (editing) {
      for (const v of editing.viewTypes) {
        set.add(v)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [companyViewTypes, editing])

  useEffect(() => {
    if (!editing) {
      setSelectedViewTypes(new Set())
      setDropdownOptions([])
      return
    }
    setSelectedViewTypes(new Set(editing.viewTypes))
    if (editing.dataType.toLowerCase() === "dropdown") {
      setLoadingOptions(true)
      fetch(`/api/admin/field-metadata/${editing.fieldMetadataId}/options`)
        .then(r => r.json())
        .then(data => setDropdownOptions(data.options ?? []))
        .catch(() => setDropdownOptions([]))
        .finally(() => setLoadingOptions(false))
    } else {
      setDropdownOptions([])
    }
  }, [editing])

  async function addDropdownOption() {
    if (!editing || !newOptionValue.trim()) return
    try {
      const res = await fetch(
        `/api/admin/field-metadata/${editing.fieldMetadataId}/options`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            optionValue: newOptionValue.trim(),
            optionLabel: newOptionLabel.trim() || null,
            displayOrder: newOptionOrder,
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setNewOptionValue("")
      setNewOptionLabel("")
      setNewOptionOrder(0)
      // Reload options
      const res2 = await fetch(`/api/admin/field-metadata/${editing.fieldMetadataId}/options`)
      const data2 = await res2.json()
      setDropdownOptions(data2.options ?? [])
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to add option")
    }
  }

  async function deleteDropdownOption(optionId: number) {
    if (!editing) return
    if (!confirm("Delete this option?")) return
    try {
      const res = await fetch(
        `/api/admin/field-metadata/${editing.fieldMetadataId}/options/${optionId}`,
        { method: "DELETE" }
      )
      if (!res.ok) throw new Error("Delete failed")
      setDropdownOptions(opts => opts.filter(o => o.fieldOptionId !== optionId))
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete option")
    }
  }

  async function toggleOptionActive(optionId: number, isActive: boolean) {
    if (!editing) return
    try {
      const res = await fetch(
        `/api/admin/field-metadata/${editing.fieldMetadataId}/options/${optionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !isActive }),
        }
      )
      if (!res.ok) throw new Error("Update failed")
      setDropdownOptions(opts =>
        opts.map(o => o.fieldOptionId === optionId ? { ...o, isActive: !isActive } : o)
      )
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update option")
    }
  }

  const filteredSorted = useMemo(() => {
    let list = fields.filter((f) => {
      if (screenFilter !== "all" && f.screenLocation !== screenFilter)
        return false
      if (typeFilter !== "all" && f.dataType.toLowerCase() !== typeFilter)
        return false
      if (statusFilter === "active" && !f.isActive) return false
      if (statusFilter === "inactive" && f.isActive) return false
      const q = searchQuery.trim().toLowerCase()
      if (q) {
        const hay = `${f.fieldName} ${f.displayName} ${f.sourceType} ${f.viewTypes.join(" ")}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "displayOrder":
          return compareValues(a.displayOrder, b.displayOrder, sortAsc)
        case "fieldName":
          return compareValues(a.fieldName, b.fieldName, sortAsc)
        case "displayName":
          return compareValues(a.displayName, b.displayName, sortAsc)
        case "screenLocation":
          return compareValues(a.screenLocation, b.screenLocation, sortAsc)
        case "dataType":
          return compareValues(a.dataType, b.dataType, sortAsc)
        case "sourceType":
          return compareValues(a.sourceType, b.sourceType, sortAsc)
        case "isActive":
          return compareValues(
            a.isActive ? 1 : 0,
            b.isActive ? 1 : 0,
            sortAsc
          )
        default:
          return 0
      }
    })

    return list
  }, [
    fields,
    searchQuery,
    screenFilter,
    typeFilter,
    statusFilter,
    sortKey,
    sortAsc,
  ])

  useEffect(() => {
    setPage(1)
  }, [searchQuery, screenFilter, typeFilter, statusFilter])

  const totalFiltered = filteredSorted.length
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE))

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages))
  }, [totalPages])
  const pageClamped = Math.min(page, totalPages)
  const pageSlice = useMemo(() => {
    const p = Math.min(page, totalPages)
    const start = (p - 1) * PAGE_SIZE
    return filteredSorted.slice(start, start + PAGE_SIZE)
  }, [filteredSorted, page, totalPages])

  const activeCount = useMemo(
    () => fields.filter((f) => f.isActive).length,
    [fields]
  )

  function headerSort(key: SortKey) {
    if (sortKey === key) setSortAsc((s) => !s)
    else {
      setSortKey(key)
      setSortAsc(true)
    }
  }

  async function savePatch(
    partial: Partial<AdminField> & { viewTypes?: string[] }
  ) {
    if (!editing) return
    const res = await fetch(
      `/api/admin/field-metadata/${editing.fieldMetadataId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: DEFAULT_COMPANY_ID,
          displayName: partial.displayName,
          displayOrder: partial.displayOrder,
          screenLocation: partial.screenLocation,
          isActive: partial.isActive,
          isRequired: partial.isRequired,
          isEditable: partial.isEditable,
          viewTypes: partial.viewTypes,
          states: partial.states,
        }),
      }
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? "Save failed")
    setEditing(null)
    await load()
  }

  function toggleViewType(vt: string) {
    setSelectedViewTypes((prev) => {
      const next = new Set(prev)
      if (next.has(vt)) next.delete(vt)
      else next.add(vt)
      return next
    })
  }

  async function copyFieldName(name: string) {
    try {
      await navigator.clipboard.writeText(name)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="bg-background text-on-background min-h-screen overflow-x-hidden">
      <header className="fixed top-0 left-0 z-50 flex h-16 w-full items-center justify-between border-b border-slate-200/15 bg-white/80 px-6 shadow-[0px_12px_32px_rgba(39,52,62,0.06)] backdrop-blur-md dark:bg-slate-900/80">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="font-headline text-xl font-bold tracking-tight text-transparent bg-gradient-to-r from-blue-700 to-blue-900 bg-clip-text"
          >
            SNF Tracker
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            <Link
              href="/admin/fields"
              className={cn(
                "flex h-16 items-center border-b-2 px-1 transition-colors",
                pathname?.startsWith("/admin")
                  ? "border-blue-700 font-bold text-blue-700 dark:text-blue-400"
                  : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400"
              )}
            >
              Configuration
            </Link>
            <span className="flex h-16 cursor-not-allowed items-center border-b-2 border-transparent px-1 text-slate-400">
              Analytics
            </span>
            <span className="flex h-16 cursor-not-allowed items-center border-b-2 border-transparent px-1 text-slate-400">
              Compliance
            </span>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden sm:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="Search fields…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="focus:ring-primary w-64 rounded-xl border-none bg-[var(--surface-container)] py-2 pl-10 pr-4 text-sm transition-all focus:ring-2"
            />
          </div>
          <button
            type="button"
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            aria-label="Export"
          >
            <FileDown className="h-5 w-5" />
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-primary text-on-primary">
            <span className="text-xs font-bold">U</span>
          </div>
        </div>
      </header>

      <aside className="fixed left-0 top-0 z-40 flex h-full w-64 flex-col border-r border-slate-200/15 bg-slate-50 py-6 pt-20 dark:bg-slate-950">
        <div className="mb-8 px-6">
          <div className="flex items-center gap-3">
            <div className="bg-primary-container text-primary flex h-10 w-10 items-center justify-center rounded-xl">
              <MIcon name="medical_services" />
            </div>
            <div>
              <h2 className="font-headline text-sm font-bold leading-tight text-slate-900 dark:text-slate-100">
                Clinical Architect
              </h2>
              <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                SNF Administration
              </p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-blue-300"
          >
            <MIcon name="pending_actions" /> Pending
          </Link>
          <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400">
            <MIcon name="medical_services" /> Medicare
          </span>
          <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400">
            <MIcon name="account_balance_wallet" /> Managed Care
          </span>
          <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400">
            <MIcon name="history_edu" /> Recertifications
          </span>
          <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400">
            <MIcon name="assignment" /> Tasks
          </span>
          <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400">
            <MIcon name="priority_high" /> Hot Cases
          </span>
        </nav>
        <div className="mt-6 border-t border-slate-200/50 px-3 pt-6 dark:border-slate-800/50">
          <Link
            href="/admin/fields"
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
              pathname === "/admin/fields"
                ? "bg-blue-50 font-bold text-blue-700 dark:bg-blue-900/20 dark:text-blue-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
            )}
          >
            <MIcon name="tune" /> Field configuration
          </Link>
          <span className="mt-1 flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400">
            <MIcon name="help_outline" /> Support
          </span>
        </div>
      </aside>

      <main className="ml-64 min-h-screen px-8 pb-12 pt-24">
        <div className="mb-6">
          <Link
            href="/"
            className="text-on-surface-variant hover:text-primary inline-flex items-center gap-2 text-sm font-semibold transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Link>
        </div>
        <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <nav className="text-on-surface-variant mb-2 flex text-[10px] font-bold uppercase tracking-[0.1em]">
              <span className="opacity-60">Admin</span>
              <span className="mx-2 opacity-40">/</span>
              <span>System Configuration</span>
            </nav>
            <h1 className="font-headline text-on-surface text-3xl font-extrabold tracking-tight">
              Administrative Field Configuration
            </h1>
            <p className="text-on-surface-variant mt-1 max-w-2xl text-sm">
              Manage data entry fields, validation, and UI placement for Company{" "}
              {DEFAULT_COMPANY_ID}. Use <strong>Main</strong> for grid,{" "}
              <strong>Detail</strong> for drawer, or <strong>Both</strong> for
              both surfaces.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/admin/fields/order">
              <Button
                type="button"
                className="bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl px-6 py-3 font-bold transition-all"
              >
                <ArrowUpDown className="mr-2 h-5 w-5" />
                Reorder Fields
              </Button>
            </Link>
            <Button
              type="button"
              className="bg-primary hover:bg-primary-dim shadow-primary/10 active:scale-95 rounded-xl px-6 py-3 font-bold text-on-primary shadow-xl transition-all"
              onClick={() => setCreating(true)}
            >
              <Plus className="mr-2 h-5 w-5" />
              Add New Field
            </Button>
          </div>
        </div>

        <div className="bg-surface-container-low mb-6 flex flex-wrap items-center gap-4 rounded-xl p-4">
          <div className="flex min-w-0 flex-1 flex-wrap gap-3">
            <div className="relative">
              <select
                value={screenFilter}
                onChange={(e) =>
                  setScreenFilter(e.target.value as typeof screenFilter)
                }
                className="text-on-secondary-container focus:ring-primary cursor-pointer appearance-none rounded-lg border-none bg-[var(--surface-container-highest)] py-2 pl-4 pr-10 text-xs font-semibold focus:ring-1"
              >
                <option value="all">Screen: All</option>
                <option value="Main">Screen: Main (Grid)</option>
                <option value="Detail">Screen: Detail</option>
                <option value="Both">Screen: Main + Detail</option>
              </select>
              <MIcon
                name="expand_more"
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>
            <div className="relative">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="text-on-secondary-container focus:ring-primary cursor-pointer appearance-none rounded-lg border-none bg-[var(--surface-container-highest)] py-2 pl-4 pr-10 text-xs font-semibold focus:ring-1"
              >
                <option value="all">Type: All</option>
                <option value="text">Text</option>
                <option value="textarea">Textarea</option>
                <option value="number">Number</option>
                <option value="currency">Currency</option>
                <option value="date">Date</option>
                <option value="boolean">Boolean</option>
                <option value="dropdown">Dropdown</option>
              </select>
              <MIcon
                name="expand_more"
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as typeof statusFilter)
                }
                className="text-on-secondary-container focus:ring-primary cursor-pointer appearance-none rounded-lg border-none bg-[var(--surface-container-highest)] py-2 pl-4 pr-10 text-xs font-semibold focus:ring-1"
              >
                <option value="all">Status: All</option>
                <option value="active">Status: Active</option>
                <option value="inactive">Status: Inactive</option>
              </select>
              <MIcon
                name="expand_more"
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-on-surface-variant hover:bg-surface-container-highest rounded-lg p-2 transition-colors"
              title="Filters apply above"
            >
              <Filter className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="text-on-surface-variant hover:bg-surface-container-highest rounded-lg p-2 transition-colors"
              onClick={() => setSortAsc((s) => !s)}
              title="Toggle sort direction"
            >
              <ArrowUpDown className="h-5 w-5" />
            </button>
            <div className="bg-outline-variant/30 mx-1 h-6 w-px" />
            <span className="text-on-surface-variant px-2 text-xs font-bold">
              {totalFiltered} of {fields.length} fields
            </span>
          </div>
        </div>

        {loading && (
          <div className="text-on-surface-variant flex items-center gap-2 py-12">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        )}
        {error && (
          <p className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-4 text-sm">
            {error}
          </p>
        )}

        {!loading && !error && (
          <>
            <div className="bg-surface-container-lowest overflow-hidden rounded-xl shadow-md">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-secondary-container">
                    <tr>
                      {(
                        [
                          ["fieldName", "Field Name"],
                          ["displayName", "Label"],
                          ["screenLocation", "Screen"],
                          ["displayOrder", "Order"],
                          ["dataType", "Type"],
                          ["sourceType", "Source"],
                          ["isActive", "Status"],
                        ] as const
                      ).map(([key, label]) => (
                        <th
                          key={key}
                          className="text-on-secondary-container cursor-pointer px-6 py-4 text-[10px] font-bold uppercase tracking-widest hover:bg-secondary-container/80"
                          onClick={() => headerSort(key)}
                        >
                          {label}
                          {sortKey === key ? (sortAsc ? " ↑" : " ↓") : ""}
                        </th>
                      ))}
                      <th className="text-on-secondary-container px-6 py-4 text-right text-[10px] font-bold uppercase tracking-widest">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-outline-variant/15 divide-y">
                    {pageSlice.map((f) => {
                      const tm = typeRowMeta(f.dataType)
                      const inactive = !f.isActive
                      return (
                        <tr
                          key={f.fieldMetadataId}
                          className="group hover:bg-surface-container-low transition-colors"
                        >
                          <td
                            className={cn(
                              "px-6 py-4",
                              inactive && "opacity-60"
                            )}
                          >
                            <span className="text-on-surface block text-sm font-bold">
                              {f.fieldName}
                            </span>
                            <span className="text-on-surface-variant font-mono text-[10px]">
                              ID: FLD-{String(f.fieldMetadataId).padStart(5, "0")}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "text-on-surface px-6 py-4 text-sm font-medium",
                              inactive && "opacity-60"
                            )}
                          >
                            {f.displayName}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={cn(
                                "text-on-secondary-container bg-surface-container-high rounded-lg px-2 py-1 text-xs font-semibold",
                                inactive && "opacity-60"
                              )}
                            >
                              {screenBadgeLabel(f.screenLocation)}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={cn(
                                "text-primary text-sm font-bold",
                                inactive && "text-slate-400"
                              )}
                            >
                              {String(f.displayOrder).padStart(2, "0")}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div
                              className={cn(
                                "flex items-center gap-2",
                                inactive && "opacity-60"
                              )}
                            >
                              <MIcon
                                name={tm.icon}
                                className="text-slate-400 !text-sm"
                              />
                              <span className="text-xs font-medium">
                                {tm.label}
                              </span>
                            </div>
                          </td>
                          <td
                            className={cn(
                              "text-on-surface-variant px-6 py-4 text-xs font-medium",
                              inactive && "opacity-60"
                            )}
                          >
                            {f.isSystemField ? "Base table" : "Custom"}
                          </td>
                          <td className="px-6 py-4">
                            {f.isActive ? (
                              <div className="text-tertiary flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-current" />
                                <span className="text-[10px] font-bold uppercase">
                                  Active
                                </span>
                              </div>
                            ) : (
                              <div className="text-slate-400 flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full border border-current" />
                                <span className="text-[10px] font-bold uppercase">
                                  Inactive
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                className="text-primary hover:bg-surface-container-highest rounded-lg p-1.5 transition-colors"
                                title="Edit"
                                onClick={() => setEditing({ ...f })}
                              >
                                <MIcon name="edit" />
                              </button>
                              <button
                                type="button"
                                className="text-slate-500 hover:bg-surface-container-highest rounded-lg p-1.5 transition-colors"
                                title="Copy field name"
                                onClick={() => void copyFieldName(f.fieldName)}
                              >
                                <MIcon name="content_copy" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {pageSlice.length === 0 && (
                <p className="text-on-surface-variant px-6 py-12 text-center text-sm">
                  No fields match your filters.
                </p>
              )}
              <div className="bg-surface-container-low flex items-center justify-between px-6 py-4">
                <span className="text-on-surface-variant text-xs font-medium">
                  {totalFiltered === 0
                    ? "Showing 0"
                    : `Showing ${(pageClamped - 1) * PAGE_SIZE + 1}–${Math.min(pageClamped * PAGE_SIZE, totalFiltered)} of ${totalFiltered}`}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={pageClamped <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="border-outline-variant/30 bg-surface-container-lowest text-on-surface hover:bg-white rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-on-surface-variant px-1 text-xs font-medium">
                    Page {pageClamped} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={pageClamped >= totalPages}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages, p + 1))
                    }
                    className="border-outline-variant/30 bg-surface-container-lowest text-on-surface hover:bg-white rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
              <div className="border-tertiary bg-surface-container-low rounded-xl border-l-4 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest">
                    Field coverage
                  </span>
                  <MIcon name="sync" className="text-tertiary" />
                </div>
                <div className="font-headline text-on-surface text-2xl font-extrabold">
                  {fields.length}
                </div>
                <p className="text-on-surface-variant mt-1 text-xs">
                  Total metadata fields for this company.
                </p>
              </div>
              <div className="bg-surface-container-low rounded-xl p-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest">
                    Active fields
                  </span>
                  <MIcon name="rule" className="text-primary" />
                </div>
                <div className="font-headline text-on-surface text-2xl font-extrabold">
                  {activeCount}
                </div>
                <p className="text-on-surface-variant mt-1 text-xs">
                  Currently visible in the app when filters match.
                </p>
              </div>
              <div className="bg-surface-container-low rounded-xl p-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest">
                    Required fields
                  </span>
                  <MIcon name="history" className="text-secondary" />
                </div>
                <div className="font-headline text-on-surface text-2xl font-extrabold">
                  {fields.filter((x) => x.isRequired).length}
                </div>
                <p className="text-on-surface-variant mt-1 text-xs">
                  Marked required in metadata configuration.
                </p>
              </div>
            </div>
          </>
        )}
      </main>

      <div className="pointer-events-none fixed -bottom-24 -right-24 -z-10 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
      <div className="pointer-events-none fixed left-[-3rem] top-1/4 -z-10 h-48 w-48 rounded-full bg-tertiary/5 blur-3xl" />

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-surface-container-lowest max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border p-6 shadow-lg">
            <h2 className="mb-4 text-lg font-semibold">Edit field</h2>
            <div className="space-y-3">
              <label className="text-muted-foreground block text-xs font-medium">
                Display name
                <input
                  className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  defaultValue={editing.displayName}
                  id="adm-dn"
                />
              </label>
              <label className="text-muted-foreground block text-xs font-medium">
                Display order
                <input
                  type="number"
                  className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  defaultValue={editing.displayOrder}
                  id="adm-do"
                />
              </label>
              <label className="text-muted-foreground block text-xs font-medium">
                Screen location
                <select
                  className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  defaultValue={editing.screenLocation}
                  id="adm-sl"
                >
                  <option value="Main">Main</option>
                  <option value="Detail">Detail</option>
                  <option value="Both">Both</option>
                </select>
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    defaultChecked={editing.isActive}
                    id="adm-a"
                  />
                  Active
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    defaultChecked={editing.isRequired}
                    id="adm-r"
                  />
                  Required
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    defaultChecked={editing.isEditable}
                    id="adm-e"
                  />
                  Editable
                </label>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium">
                  View type (PendingTrackingItem.ViewType)
                </p>
                <p className="text-muted-foreground/90 mb-2 text-[11px]">
                  Leave none checked to show for every view type.
                </p>
                {viewTypeOptions.length === 0 ? (
                  <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
                    No view types in PendingTrackingItem for this company.
                  </p>
                ) : (
                  <div className="border-input bg-muted/20 flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                    {viewTypeOptions.map((vt) => (
                      <label
                        key={vt}
                        className="flex cursor-pointer items-center gap-2 text-sm leading-none"
                      >
                        <Checkbox
                          checked={selectedViewTypes.has(vt)}
                          onCheckedChange={() => toggleViewType(vt)}
                        />
                        <span>{vt}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <label className="text-muted-foreground block text-xs font-medium">
                States (comma-separated 2-letter; empty = all)
                <input
                  className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  defaultValue={editing.states.join(", ")}
                  id="adm-st"
                  placeholder="TX, FL"
                />
              </label>
              {editing.dataType.toLowerCase() === "dropdown" && (
                <div>
                  <p className="text-muted-foreground text-xs font-medium mb-2">
                    Dropdown Options
                  </p>
                  {loadingOptions ? (
                    <p className="text-muted-foreground text-xs">Loading...</p>
                  ) : (
                    <div className="space-y-2">
                      {dropdownOptions.length > 0 && (
                        <div className="border-input bg-muted/10 rounded-md border p-2 space-y-1 mb-3 max-h-40 overflow-y-auto">
                          {dropdownOptions.map((opt) => (
                            <div key={opt.fieldOptionId} className="flex items-center justify-between gap-2 text-xs">
                              <span className="flex-1 min-w-0">
                                <span className="font-medium">{opt.optionValue}</span>
                                {opt.optionLabel && <span className="text-muted-foreground"> / {opt.optionLabel}</span>}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleOptionActive(opt.fieldOptionId, opt.isActive)}
                                className={`px-2 py-1 rounded text-[10px] font-medium ${
                                  opt.isActive
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {opt.isActive ? "Active" : "Inactive"}
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteDropdownOption(opt.fieldOptionId)}
                                className="text-destructive hover:bg-destructive/10 px-2 py-1 rounded"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="border-input bg-muted/20 rounded-md border p-2 space-y-2">
                        <input
                          type="text"
                          className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
                          placeholder="Option value"
                          value={newOptionValue}
                          onChange={(e) => setNewOptionValue(e.target.value)}
                        />
                        <input
                          type="text"
                          className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
                          placeholder="Label (optional)"
                          value={newOptionLabel}
                          onChange={(e) => setNewOptionLabel(e.target.value)}
                        />
                        <input
                          type="number"
                          className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
                          placeholder="Order"
                          value={newOptionOrder}
                          onChange={(e) => setNewOptionOrder(Number(e.target.value))}
                        />
                        <button
                          type="button"
                          onClick={() => void addDropdownOption()}
                          className="bg-primary text-on-primary w-full rounded-md py-1 text-xs font-medium hover:bg-primary/90"
                        >
                          Add Option
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const dn = (
                    document.getElementById("adm-dn") as HTMLInputElement
                  ).value
                  const do_ = Number(
                    (document.getElementById("adm-do") as HTMLInputElement)
                      .value
                  )
                  const sl = (
                    document.getElementById("adm-sl") as HTMLSelectElement
                  ).value as "Main" | "Detail" | "Both"
                  const ia = (
                    document.getElementById("adm-a") as HTMLInputElement
                  ).checked
                  const ir = (
                    document.getElementById("adm-r") as HTMLInputElement
                  ).checked
                  const ie = (
                    document.getElementById("adm-e") as HTMLInputElement
                  ).checked
                  const stRaw = (
                    document.getElementById("adm-st") as HTMLInputElement
                  ).value
                  const states = stRaw
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter((s) => s.length === 2)
                  void savePatch({
                    displayName: dn,
                    displayOrder: Number.isFinite(do_) ? do_ : editing.displayOrder,
                    screenLocation: sl,
                    isActive: ia,
                    isRequired: ir,
                    isEditable: ie,
                    viewTypes: Array.from(selectedViewTypes),
                    states,
                  })
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <CreateFieldModal
          companyId={DEFAULT_COMPANY_ID}
          viewTypeOptions={companyViewTypes}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function CreateFieldModal({
  companyId,
  viewTypeOptions,
  onClose,
  onCreated,
}: {
  companyId: number
  viewTypeOptions: string[]
  onClose: () => void
  onCreated: () => void
}) {
  const [fieldName, setFieldName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [dataType, setDataType] = useState("text")
  const [screenLocation, setScreenLocation] = useState<
    "Main" | "Detail" | "Both"
  >(
    "Main"
  )
  const [displayOrder, setDisplayOrder] = useState(0)
  const [createViewTypes, setCreateViewTypes] = useState<Set<string>>(
    () => new Set()
  )
  const [statesCsv, setStatesCsv] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [isRequired, setIsRequired] = useState(false)
  const [isEditable, setIsEditable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [createOptions, setCreateOptions] = useState<Array<{ value: string; label: string; order: number }>>([])
  const [newCreateOptValue, setNewCreateOptValue] = useState("")
  const [newCreateOptLabel, setNewCreateOptLabel] = useState("")
  const [newCreateOptOrder, setNewCreateOptOrder] = useState(0)

  function toggleCreateViewType(vt: string) {
    setCreateViewTypes((prev) => {
      const next = new Set(prev)
      if (next.has(vt)) next.delete(vt)
      else next.add(vt)
      return next
    })
  }

  function addCreateOption() {
    if (!newCreateOptValue.trim()) return
    setCreateOptions(prev => [...prev, {
      value: newCreateOptValue.trim(),
      label: newCreateOptLabel.trim() || newCreateOptValue.trim(),
      order: newCreateOptOrder,
    }])
    setNewCreateOptValue("")
    setNewCreateOptLabel("")
    setNewCreateOptOrder(createOptions.length)
  }

  function deleteCreateOption(idx: number) {
    setCreateOptions(prev => prev.filter((_, i) => i !== idx))
  }

  async function submit() {
    setErr(null)
    const fn = fieldName.trim()
    const dn = displayName.trim()
    if (!fn || !dn) {
      setErr("Field name and display name are required.")
      return
    }
    const states = statesCsv
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length === 2)
    const viewTypes = Array.from(createViewTypes)
    const doNum = Number(displayOrder)
    setSaving(true)
    try {
      const res = await fetch("/api/admin/field-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          fieldName: fn,
          displayName: dn,
          dataType,
          screenLocation,
          displayOrder: Number.isFinite(doNum) ? doNum : 0,
          isActive,
          isRequired,
          isEditable,
          viewTypes,
          states,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Create failed")
      const fieldMetadataId = data.fieldMetadataId

      // Create dropdown options if any
      if (dataType === "dropdown" && createOptions.length > 0 && fieldMetadataId) {
        for (const opt of createOptions) {
          await fetch(
            `/api/admin/field-metadata/${fieldMetadataId}/options`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                optionValue: opt.value,
                optionLabel: opt.label !== opt.value ? opt.label : null,
                displayOrder: opt.order,
              }),
            }
          )
        }
      }
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-surface-container-lowest max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">Add new field</h2>
        {err && <p className="text-destructive mb-2 text-sm">{err}</p>}
        <div className="space-y-3">
          <label className="text-muted-foreground block text-xs font-medium">
            Field name (code)
            <input
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="e.g. FollowUpDate"
            />
          </label>
          <label className="text-muted-foreground block text-xs font-medium">
            Display name
            <input
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="text-muted-foreground block text-xs font-medium">
            Data type
            <select
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={dataType}
              onChange={(e) => setDataType(e.target.value)}
            >
              <option value="text">text</option>
              <option value="textarea">textarea</option>
              <option value="number">number</option>
              <option value="currency">currency</option>
              <option value="date">date</option>
              <option value="boolean">boolean</option>
              <option value="dropdown">dropdown</option>
            </select>
          </label>
          <label className="text-muted-foreground block text-xs font-medium">
            Screen
            <select
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={screenLocation}
              onChange={(e) =>
                setScreenLocation(e.target.value as "Main" | "Detail" | "Both")
              }
            >
              <option value="Main">Main (grid)</option>
              <option value="Detail">Detail</option>
              <option value="Both">Both (grid + detail)</option>
            </select>
          </label>
          <label className="text-muted-foreground block text-xs font-medium">
            Display order
            <input
              type="number"
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(Number(e.target.value))}
            />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isRequired}
                onChange={(e) => setIsRequired(e.target.checked)}
              />
              Required
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isEditable}
                onChange={(e) => setIsEditable(e.target.checked)}
              />
              Editable
            </label>
          </div>
          <div>
            <p className="text-muted-foreground text-xs font-medium">
              View type (PendingTrackingItem.ViewType)
            </p>
            <p className="text-muted-foreground/90 mb-2 text-[11px]">
              Leave none checked to show for every view type.
            </p>
            {viewTypeOptions.length === 0 ? (
              <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
                No view types in PendingTrackingItem for this company.
              </p>
            ) : (
              <div className="border-input bg-muted/20 flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                {viewTypeOptions.map((vt) => (
                  <label
                    key={vt}
                    className="flex cursor-pointer items-center gap-2 text-sm leading-none"
                  >
                    <Checkbox
                      checked={createViewTypes.has(vt)}
                      onCheckedChange={() => toggleCreateViewType(vt)}
                    />
                    <span>{vt}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="text-muted-foreground block text-xs font-medium">
            States (comma-separated 2-letter; empty = all)
            <input
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={statesCsv}
              onChange={(e) => setStatesCsv(e.target.value)}
              placeholder="TX, FL"
            />
          </label>
          {dataType === "dropdown" && (
            <div>
              <p className="text-muted-foreground text-xs font-medium mb-2">
                Dropdown Options
              </p>
              <div className="space-y-2">
                {createOptions.length > 0 && (
                  <div className="border-input bg-muted/10 rounded-md border p-2 space-y-1 mb-3 max-h-40 overflow-y-auto">
                    {createOptions.map((opt, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex-1 min-w-0">
                          <span className="font-medium">{opt.value}</span>
                          {opt.label !== opt.value && <span className="text-muted-foreground"> / {opt.label}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteCreateOption(idx)}
                          className="text-destructive hover:bg-destructive/10 px-2 py-1 rounded"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="border-input bg-muted/20 rounded-md border p-2 space-y-2">
                  <input
                    type="text"
                    className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
                    placeholder="Option value"
                    value={newCreateOptValue}
                    onChange={(e) => setNewCreateOptValue(e.target.value)}
                  />
                  <input
                    type="text"
                    className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
                    placeholder="Label (optional)"
                    value={newCreateOptLabel}
                    onChange={(e) => setNewCreateOptLabel(e.target.value)}
                  />
                  <input
                    type="number"
                    className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
                    placeholder="Order"
                    value={newCreateOptOrder}
                    onChange={(e) => setNewCreateOptOrder(Number(e.target.value))}
                  />
                  <button
                    type="button"
                    onClick={() => addCreateOption()}
                    className="bg-primary text-on-primary w-full rounded-md py-1 text-xs font-medium hover:bg-primary/90"
                  >
                    Add Option
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  )
}
