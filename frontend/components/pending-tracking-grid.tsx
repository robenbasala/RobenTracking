"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Flame,
  LayoutGrid,
  Loader2,
  Pencil,
  StickyNote,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { apiDelete, apiGet, apiPut } from "@/services/api"
import { cn } from "@/lib/utils"
import type {
  GridColumnMeta,
  PendingTrackingGridResponse,
} from "@/lib/pending-tracking/types"
import {
  formatCellForColumn,
  parseBooleanFromCell,
} from "@/lib/pending-tracking/formatters"
import { getActingUserLabel } from "@/lib/acting-user"
import {
  getRowValueForKey,
  getTrackingItemIdFromRow,
} from "@/lib/pending-tracking/map-row"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { GridColumnSettingsSheet } from "@/components/grid-column-settings-sheet"
import { ResidentDetailModal } from "@/components/resident-detail-modal"
import { ResidentNotesPanel } from "@/components/resident-notes-panel"
import {
  applyGridColumnPrefs,
  loadGridColumnPrefs,
  type GridColumnPrefs,
} from "@/lib/pending-tracking/grid-column-preferences"

/* ─── Date value helper ───────────────────────────────── */
function toDateInputValue(v: unknown): string {
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10)
  if (typeof v === "string") return v.slice(0, 10)
  return ""
}

function formatDateDisplay(v: unknown): string {
  const s = toDateInputValue(v)
  if (!s) return "—"
  const [y, m, d] = s.split("-")
  return `${m}/${d}/${y}`
}

/* ─── Inline edit cell ────────────────────────────────── */
function EditCell({
  col,
  value,
  onChange,
  onCommit,
  onCancel,
  autoFocus = true,
}: {
  col: GridColumnMeta
  value: unknown
  onChange: (v: unknown) => void
  onCommit: () => void
  onCancel: () => void
  autoFocus?: boolean
}) {
  const cls =
    "w-full rounded border border-blue-400 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      onCommit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
  }

  if (col.type === "boolean") {
    return (
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-blue-400 text-blue-600"
        checked={Boolean(value)}
        onChange={(e) => {
          onChange(e.target.checked)
          onCommit()
        }}
        autoFocus={autoFocus}
      />
    )
  }
  if (col.type === "date") {
    return (
      <input
        type="date"
        className={cls}
        value={toDateInputValue(value)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
      />
    )
  }
  if (col.type === "number" || col.type === "currency") {
    return (
      <input
        type="number"
        className={cls}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
      />
    )
  }
  if (col.type === "dropdown") {
    // value may start as label string; find matching optionId, then track numeric optionId
    const numVal = typeof value === "number" ? value
      : col.dropdownOptions?.find(o => o.label === value || o.value === String(value))?.optionId ?? ""
    return (
      <select
        className={cls}
        value={numVal}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
        autoFocus={autoFocus}
      >
        <option value="">— Select —</option>
        {col.dropdownOptions?.map(o => (
          <option key={o.optionId} value={o.optionId}>{o.label || o.value}</option>
        ))}
      </select>
    )
  }
  return (
    <input
      type="text"
      className={cls}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={handleKeyDown}
      autoFocus={autoFocus}
    />
  )
}

/* ─── Props ───────────────────────────────────────────── */
type PendingTrackingGridProps = {
  companyId: number
  viewType: string
  search: string
  facilityIds?: string[]
  state?: string | null
  status?: string | null
  /** When true, load rows with IsActive = 0 as well as active rows. */
  includeInactive?: boolean
}

const GRID_FETCH_TIMEOUT_MS = 60_000

function rowIsInactive(row: Record<string, unknown>): boolean {
  const v = getRowValueForKey(row, "isActive")
  return v === false || v === 0 || v === "0"
}

/* ─── Component ───────────────────────────────────────── */
export function PendingTrackingGrid({
  companyId,
  viewType,
  search,
  facilityIds = [],
  state,
  status,
  includeInactive = false,
}: PendingTrackingGridProps) {
  /* Grid state */
  const [columns, setColumns] = useState<GridColumnMeta[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(25)
  const [sortBy, setSortBy] = useState("trackingItemId")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* Inline edit state */
  const [editingCell, setEditingCell] = useState<{ rowId: number; colKey: string } | null>(null)
  const [editValue, setEditValue] = useState<unknown>(undefined)
  const editValueRef = useRef<unknown>(undefined)
  const [savingCell, setSavingCell] = useState<{ rowId: number; colKey: string } | null>(null)

  /* Modal state */
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedTrackingItemId, setSelectedTrackingItemId] = useState<number | null>(null)

  /** Line notes: which row is selected for the notes panel below the grid */
  const [notesFor, setNotesFor] = useState<{
    id: number
    label: string | null
  } | null>(null)

  /* Delete confirmation state */
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number
    label: string | null
  } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [columnPrefs, setColumnPrefs] = useState<GridColumnPrefs | null>(null)
  const [colSettingsOpen, setColSettingsOpen] = useState(false)

  const skipLoadAfterSortSyncRef = useRef(false)

  useEffect(() => {
    setColumnPrefs(loadGridColumnPrefs(companyId, viewType))
  }, [companyId, viewType, columns])

  /* ── Load grid ── */
  const loadGrid = useCallback(async () => {
    setLoading(true)
    setError(null)
    const ac = new AbortController()
    const timeoutId = window.setTimeout(() => ac.abort(), GRID_FETCH_TIMEOUT_MS)
    try {
      const params = new URLSearchParams()
      params.set("companyId", String(companyId))
      params.set("viewType", viewType)
      if (search.trim()) params.set("search", search.trim())
      if (facilityIds.length > 0)
        params.set("facilityIds", facilityIds.join(","))
      if (state?.trim()) params.set("state", state.trim().slice(0, 2).toUpperCase())
      if (status) params.set("status", status)
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
      params.set("sortBy", sortBy)
      params.set("sortDirection", sortDirection)
      if (includeInactive) params.set("includeInactive", "1")

      const res = await apiGet(`/api/pending-tracking/grid?${params}`, {
        cache: "no-store",
        signal: ac.signal,
      })
      const data = (await res.json()) as PendingTrackingGridResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to load grid.")
      if (data.error && !(data.columns && data.columns.length > 0)) {
        setError(data.error)
        setColumns([])
        setRows([])
        setTotalCount(0)
        return
      }
      const cols = (data.columns ?? []) as GridColumnMeta[]
      setColumns(cols)
      setRows((data.rows ?? []) as Record<string, unknown>[])
      setTotalCount(Number(data.totalCount ?? 0))
      const nextSort =
        cols.length > 0 && cols.some((c) => c.key === sortBy)
          ? sortBy
          : (data.defaultSortKey ?? "trackingItemId")
      if (nextSort !== sortBy) {
        skipLoadAfterSortSyncRef.current = true
        setSortBy(nextSort)
      }
    } catch (e) {
      setColumns([])
      setRows([])
      setTotalCount(0)
      const aborted =
        typeof e === "object" && e !== null && "name" in e &&
        (e as { name: string }).name === "AbortError"
      setError(
        aborted
          ? `Grid request timed out after ${GRID_FETCH_TIMEOUT_MS / 1000}s.`
          : e instanceof Error ? e.message : "Error"
      )
    } finally {
      clearTimeout(timeoutId)
      setLoading(false)
    }
  }, [
    companyId,
    viewType,
    search,
    facilityIds,
    state,
    status,
    includeInactive,
    page,
    pageSize,
    sortBy,
    sortDirection,
  ])

  useEffect(() => {
    if (skipLoadAfterSortSyncRef.current) {
      skipLoadAfterSortSyncRef.current = false
      return
    }
    void loadGrid()
  }, [loadGrid])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const displayColumns = useMemo(
    () => applyGridColumnPrefs(columns, columnPrefs),
    [columns, columnPrefs]
  )

  const detailLinkColumnKey = useMemo(() => {
    const marked = displayColumns.find((c) => c.opensResidentDetail)
    return marked?.key ?? displayColumns[0]?.key ?? null
  }, [displayColumns])

  /* ── Sort ── */
  function handleSort(columnKey: string) {
    if (editingCell != null) return
    if (sortBy === columnKey) setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortBy(columnKey); setSortDirection("asc") }
  }

  /* ── Open modal ── */
  function openModal(id: number) {
    if (!Number.isFinite(id)) return
    setSelectedTrackingItemId(id)
    setModalOpen(true)
  }

  /* ── Inline edit ── */
  function enterCellEdit(row: Record<string, unknown>, rowId: number, col: GridColumnMeta) {
    const raw = getRowValueForKey(row, col.key)
    setEditValue(raw)
    editValueRef.current = raw
    setEditingCell({ rowId, colKey: col.key })
  }

  function cancelCellEdit() {
    setEditingCell(null)
    setEditValue(undefined)
    editValueRef.current = undefined
  }

  async function saveCellEdit(rowId: number, col: GridColumnMeta) {
    const value = editValueRef.current
    setEditingCell(null)
    setEditValue(undefined)
    setSavingCell({ rowId, colKey: col.key })
    try {
      const res = await apiPut(`/api/pending-tracking/${rowId}/values`, {
        values: { [col.fieldName]: value },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? "Save failed")
      }
      // Optimistic row update
      setRows((prev) =>
        prev.map((r) => {
          if (getTrackingItemIdFromRow(r) !== rowId) return r
          return { ...r, [col.key]: value }
        })
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed")
      // Re-open the cell so user can retry
      setEditingCell({ rowId, colKey: col.key })
      setEditValue(value)
      editValueRef.current = value
    } finally {
      setSavingCell(null)
    }
  }

  /* ── Soft-delete item ── */
  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const stoppedBy = encodeURIComponent(getActingUserLabel())
      const res = await apiDelete(
        `/api/pending-tracking/${deleteTarget.id}?companyId=${companyId}&stoppedBy=${stoppedBy}`
      )
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? "Delete failed")
      }
      setDeleteTarget(null)
      await loadGrid()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleting(false)
    }
  }

  /* ── Cell render ── */
  function renderDisplayCell(col: GridColumnMeta, row: Record<string, unknown>) {
    const raw = getRowValueForKey(row, col.key)
    if (col.type === "boolean") {
      const b = parseBooleanFromCell(raw)
      return (
        <span className="flex justify-center">
          {b === true ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : b === false ? (
            <Circle className="h-5 w-5 text-slate-300" />
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </span>
      )
    }
    if (col.type === "date") {
      return <span className="text-sm text-slate-700">{formatDateDisplay(raw)}</span>
    }
    return <span className="text-sm text-slate-700">{formatCellForColumn(raw, col.type)}</span>
  }

  /* ═══════════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
      {/* ── Main grid (fills space next to notes sidebar) ── */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2 dark:bg-slate-900/30">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            disabled={columns.length === 0}
            onClick={() => setColSettingsOpen(true)}
          >
            <LayoutGrid className="mr-2 h-4 w-4" />
            Columns
          </Button>
        </div>
        <div className="overflow-x-auto" style={{ minWidth: 0 }}>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {displayColumns.map((col) => (
                  <th
                    key={col.key}
                    className="cursor-pointer select-none px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-blue-600"
                    onClick={() => handleSort(col.key)}
                  >
                    {col.title}
                    {sortBy === col.key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
                  </th>
                ))}
                <th className="sticky right-0 z-10 bg-slate-50 px-4 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td className="px-6 py-12 text-slate-400" colSpan={displayColumns.length + 1}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading…
                    </span>
                  </td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td className="px-6 py-8 text-red-500" colSpan={displayColumns.length + 1}>{error}</td>
                </tr>
              )}
              {!loading && !error && rows.map((row, rowIndex) => {
                const id = getTrackingItemIdFromRow(row)
                const rowKey = id != null ? `ti-${id}` : `row-${rowIndex}`
                const isHotCase = Boolean(
                  getRowValueForKey(row, "IsHotCase") ||
                  getRowValueForKey(row, "isHotCase")
                )
                const isStoppedRow = includeInactive && rowIsInactive(row)

                return (
                  <tr
                    key={rowKey}
                    className={cn(
                      "transition-colors",
                      isStoppedRow
                        ? "border-l-4 border-l-rose-800 bg-rose-100/95 text-rose-950 hover:bg-rose-100 dark:border-l-rose-500 dark:bg-rose-950/40 dark:text-rose-50 dark:hover:bg-rose-950/55"
                        : isHotCase
                          ? "border-l-4 border-l-orange-400 bg-orange-50/30 hover:bg-orange-50/60"
                          : "hover:bg-slate-50/70"
                    )}
                  >
                    {displayColumns.map((col, colIdx) => {
                      const isCellEditing = editingCell?.rowId === id && editingCell?.colKey === col.key
                      const isCellSaving = savingCell?.rowId === id && savingCell?.colKey === col.key
                      const isDetailLink = detailLinkColumnKey != null && col.key === detailLinkColumnKey

                      return (
                        <td key={col.key} className="px-4 py-2.5 align-middle">
                          {isCellSaving ? (
                            <span className="inline-flex items-center gap-1.5">
                              {renderDisplayCell(col, row)}
                              <Loader2 className="h-3 w-3 animate-spin text-blue-400" />
                            </span>
                          ) : isCellEditing ? (
                            <EditCell
                              col={col}
                              value={editValue}
                              onChange={(v) => {
                                setEditValue(v)
                                editValueRef.current = v
                              }}
                              onCommit={() => id != null && saveCellEdit(id, col)}
                              onCancel={cancelCellEdit}
                              autoFocus
                            />
                          ) : isDetailLink ? (
                            <button
                              type="button"
                              className="text-left text-sm font-bold text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={id == null}
                              onClick={() => id != null && openModal(id)}
                            >
                              {isHotCase && colIdx === 0 && (
                                <Flame className="mr-1 inline h-3.5 w-3.5 text-orange-500" />
                              )}
                              {formatCellForColumn(getRowValueForKey(row, col.key), col.type)}
                            </button>
                          ) : col.isEditable ? (
                            <div
                              role="button"
                              tabIndex={0}
                              className="group/cell relative -mx-1 -my-0.5 cursor-pointer rounded px-1 py-0.5
                                         hover:bg-blue-50 hover:ring-1 hover:ring-inset hover:ring-blue-200
                                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              onClick={() => id != null && enterCellEdit(row, id, col)}
                              onKeyDown={(e) => {
                                if ((e.key === "Enter" || e.key === " ") && id != null) {
                                  e.preventDefault()
                                  enterCellEdit(row, id, col)
                                }
                              }}
                            >
                              {isHotCase && colIdx === 0 && (
                                <Flame className="mr-1 inline h-3.5 w-3.5 text-orange-500" />
                              )}
                              {renderDisplayCell(col, row)}
                              <Pencil className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3
                                              text-blue-300 opacity-0 group-hover/cell:opacity-100 transition-opacity" />
                            </div>
                          ) : (
                            <span>
                              {isHotCase && colIdx === 0 && !detailLinkColumnKey && (
                                <Flame className="mr-1 inline h-3.5 w-3.5 text-orange-500" />
                              )}
                              {renderDisplayCell(col, row)}
                            </span>
                          )}
                        </td>
                      )
                    })}

                    {/* Actions */}
                    <td
                      className={cn(
                        "sticky right-0 z-10 px-4 py-2.5 text-right",
                        isStoppedRow
                          ? "bg-rose-100/95 dark:bg-rose-950/40"
                          : "bg-white"
                      )}
                    >
                      <div className="flex justify-end gap-1 flex-shrink-0">
                        <button
                          type="button"
                          title="Notes for this line"
                          disabled={id == null}
                          className={cn(
                            "rounded-lg p-2 disabled:opacity-40",
                            notesFor?.id === id
                              ? "bg-blue-100 text-blue-700"
                              : "text-slate-400 hover:bg-amber-50 hover:text-amber-700"
                          )}
                          onClick={() => {
                            if (id == null) return
                            const label =
                              detailLinkColumnKey != null
                                ? String(
                                    getRowValueForKey(row, detailLinkColumnKey) ??
                                      ""
                                  ).trim() || null
                                : null
                            setNotesFor({ id, label })
                          }}
                        >
                          <StickyNote className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="View / Edit details"
                          disabled={id == null}
                          className="rounded-lg p-2 text-slate-400 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-40"
                          onClick={() => id != null && openModal(id)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          disabled={id == null}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                          onClick={() => {
                            if (id == null) return
                            const label =
                              detailLinkColumnKey != null
                                ? String(
                                    getRowValueForKey(row, detailLinkColumnKey) ?? ""
                                  ).trim() || null
                                : null
                            setDeleteTarget({ id, label })
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td className="px-6 py-12 text-slate-400" colSpan={displayColumns.length + 1}>
                    No records match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-6 py-3">
          <p className="text-xs text-slate-500">
            {totalCount === 0
              ? "No records"
              : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalCount)} of ${totalCount.toLocaleString()}`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-slate-500">Page {page} / {totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <GridColumnSettingsSheet
        open={colSettingsOpen}
        onOpenChange={setColSettingsOpen}
        companyId={companyId}
        viewType={viewType}
        columns={columns}
        onApplied={() =>
          setColumnPrefs(loadGridColumnPrefs(companyId, viewType))
        }
      />

      <ResidentNotesPanel
        companyId={companyId}
        trackingItemId={notesFor?.id ?? null}
        residentLabel={notesFor?.label}
      />

      <ResidentDetailModal
        trackingItemId={selectedTrackingItemId}
        companyId={companyId}
        state={state}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setSelectedTrackingItemId(null)
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Tracking</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to stop tracking{" "}
              {deleteTarget?.label ? (
                <strong>{deleteTarget.label}</strong>
              ) : (
                "this record"
              )}
              ? This will deactivate the record and hide it from the grid.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
