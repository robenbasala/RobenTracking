"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ResidentDetailModal } from "@/components/resident-detail-modal"
import type { GlobalTask } from "@/lib/pending-tracking/types"

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-blue-100 text-blue-700",
  InProgress: "bg-amber-100 text-amber-700",
  Completed: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-500",
}

const SORT_OPTIONS: { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "dueDate", label: "Due Date" },
  { key: "status", label: "Status" },
  { key: "assignee", label: "Assignee" },
  { key: "residentName", label: "Resident" },
  { key: "facilityName", label: "Facility" },
  { key: "createdAt", label: "Created" },
]

function formatDateDisplay(v: string | null): string {
  if (!v) return "—"
  const s = v.slice(0, 10)
  const [y, m, d] = s.split("-")
  return `${m}/${d}/${y}`
}

type TasksScreenProps = {
  companyId: number
  state?: string | null
}

export function TasksScreen({ companyId, state }: TasksScreenProps) {
  const [tasks, setTasks] = useState<GlobalTask[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)

  const [statusFilter, setStatusFilter] = useState("")
  const [facilityFilter, setFacilityFilter] = useState("")
  const [facilities, setFacilities] = useState<string[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  const [sortBy, setSortBy] = useState("createdAt")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedTrackingItemId, setSelectedTrackingItemId] = useState<
    number | null
  >(null)

  // Edit task state
  const [editingTask, setEditingTask] = useState<GlobalTask | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editDue, setEditDue] = useState("")
  const [editStatus, setEditStatus] = useState("")
  const [editAssignee, setEditAssignee] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<GlobalTask | null>(null)
  const [deleteDeleting, setDeleteDeleting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("companyId", String(companyId))
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
      if (statusFilter) params.set("status", statusFilter)
      if (facilityFilter) params.set("facilityName", facilityFilter)
      if (debouncedSearch) params.set("search", debouncedSearch)
      params.set("sortBy", sortBy)
      params.set("sortDirection", sortDirection)

      const res = await fetch(`/api/tasks?${params}`, { cache: "no-store" })
      const data = (await res.json()) as {
        tasks?: GlobalTask[]
        totalCount?: number
        facilities?: string[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? "Failed to load tasks")
      setTasks(data.tasks ?? [])
      setTotalCount(data.totalCount ?? 0)
      if (data.facilities) setFacilities(data.facilities)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks")
    } finally {
      setLoading(false)
    }
  }, [
    companyId,
    page,
    pageSize,
    statusFilter,
    facilityFilter,
    debouncedSearch,
    sortBy,
    sortDirection,
  ])

  useEffect(() => {
    void load()
  }, [load])

  function toggleSort(key: string) {
    if (sortBy === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(key)
      setSortDirection("asc")
    }
    setPage(1)
  }

  async function patchStatus(task: GlobalTask, newStatus: string) {
    await fetch(
      `/api/pending-tracking/${task.trackingItemId}/tasks/${task.taskId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, status: newStatus }),
      }
    )
    await load()
  }

  function openEditTask(task: GlobalTask) {
    setEditingTask(task)
    setEditTitle(task.title)
    setEditDue(task.dueDate ? task.dueDate.slice(0, 10) : "")
    setEditStatus(task.status)
    setEditAssignee(task.assignee ?? "")
    setEditNotes(task.notes ?? "")
  }

  function closeEditTask() {
    setEditingTask(null)
    setEditTitle("")
    setEditDue("")
    setEditStatus("")
    setEditAssignee("")
    setEditNotes("")
  }

  async function saveEditTask() {
    if (!editingTask || !editTitle.trim()) return
    setEditSaving(true)
    try {
      const res = await fetch(
        `/api/pending-tracking/${editingTask.trackingItemId}/tasks/${editingTask.taskId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            title: editTitle.trim(),
            dueDate: editDue || null,
            status: editStatus,
            assignee: editAssignee.trim() || null,
            notes: editNotes.trim() || null,
          }),
        }
      )
      if (!res.ok) throw new Error("Failed to update task")
      closeEditTask()
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to update task")
    } finally {
      setEditSaving(false)
    }
  }

  async function confirmDeleteTask() {
    if (!deleteTarget) return
    setDeleteDeleting(true)
    try {
      const res = await fetch(
        `/api/pending-tracking/${deleteTarget.trackingItemId}/tasks/${deleteTarget.taskId}?companyId=${companyId}`,
        { method: "DELETE" }
      )
      if (!res.ok) throw new Error("Failed to delete task")
      setDeleteTarget(null)
      if (editingTask?.taskId === deleteTarget.taskId) closeEditTask()
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to delete task")
    } finally {
      setDeleteDeleting(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  // Edit panel view
  if (editingTask) {
    return (
      <>
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={closeEditTask}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Edit Task
          </h3>
          {editingTask.residentName && (
            <span className="text-xs text-slate-400">
              — {editingTask.residentName}
              {editingTask.facilityName ? ` · ${editingTask.facilityName}` : ""}
            </span>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Title *
              </label>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Task title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Due Date
                </label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  value={editDue}
                  onChange={(e) => setEditDue(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Status
                </label>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  {["Open", "InProgress", "Completed", "Cancelled"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Assignee
                </label>
                <input
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Assignee name"
                  value={editAssignee}
                  onChange={(e) => setEditAssignee(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Notes
              </label>
              <textarea
                className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                rows={4}
                placeholder="Additional notes..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50"
                onClick={() => setDeleteTarget(editingTask)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete Task
              </button>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={closeEditTask}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={editSaving || !editTitle.trim()}
                  onClick={saveEditTask}
                >
                  {editSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </div>

            <div className="text-[11px] text-slate-400">
              Created{" "}
              {new Date(editingTask.createdAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
              {editingTask.createdBy ? ` by ${editingTask.createdBy}` : ""}
            </div>
          </div>
        </div>

        {/* Delete confirmation */}
        {deleteTarget && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
              <h4 className="text-lg font-semibold text-slate-900">
                Delete Task
              </h4>
              <p className="mt-2 text-sm text-slate-500">
                Are you sure you want to delete{" "}
                <strong>{deleteTarget.title}</strong>? This action cannot be
                undone.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleteDeleting}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-red-600 text-white hover:bg-red-700"
                  disabled={deleteDeleting}
                  onClick={confirmDeleteTask}
                >
                  {deleteDeleting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value)
              setPage(1)
            }}
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
        >
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="InProgress">In Progress</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select
          value={facilityFilter}
          onChange={(e) => {
            setFacilityFilter(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
        >
          <option value="">All Facilities</option>
          {facilities.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {totalCount} task{totalCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Sort Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Sort by:
        </span>
        {SORT_OPTIONS.map((opt) => {
          const active = sortBy === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => toggleSort(opt.key)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
              )}
            >
              {opt.label}
              {active ? (
                sortDirection === "asc" ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )
              ) : (
                <ArrowUpDown className="h-3 w-3 opacity-40" />
              )}
            </button>
          )
        })}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading tasks...
        </div>
      )}
      {!loading && error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Task Cards */}
      {!loading && !error && tasks.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
          No tasks found.
        </div>
      )}

      {!loading && !error && tasks.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((t) => (
              <div
                key={t.taskId}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md hover:border-blue-200"
                onClick={() => openEditTask(t)}
              >
                {/* Header */}
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <button
                      type="button"
                      title="Toggle complete"
                      onClick={(e) => {
                        e.stopPropagation()
                        patchStatus(
                          t,
                          t.status === "Completed" ? "Open" : "Completed"
                        )
                      }}
                      className="mt-0.5 shrink-0"
                    >
                      {t.status === "Completed" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <Circle className="h-5 w-5 text-slate-300 hover:text-slate-400" />
                      )}
                    </button>
                    <p
                      className={cn(
                        "text-sm font-semibold text-slate-800",
                        t.status === "Completed" &&
                          "text-slate-400 line-through"
                      )}
                    >
                      {t.title}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold leading-none",
                        STATUS_COLORS[t.status] ?? "bg-slate-100 text-slate-500"
                      )}
                    >
                      {t.status}
                    </span>
                    <button
                      type="button"
                      title="Delete task"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteTarget(t)
                      }}
                      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Resident link */}
                {t.residentName && (
                  <button
                    type="button"
                    className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-blue-600 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedTrackingItemId(t.trackingItemId)
                      setModalOpen(true)
                    }}
                  >
                    <User className="h-3 w-3" />
                    {t.residentName}
                    {t.facilityName && (
                      <span className="font-normal text-slate-400">
                        {" "}
                        - {t.facilityName}
                      </span>
                    )}
                  </button>
                )}

                {/* Details */}
                <div className="space-y-1 text-[11px] text-slate-500">
                  {t.dueDate && <p>Due: {formatDateDisplay(t.dueDate)}</p>}
                  {t.assignee && <p>Assignee: {t.assignee}</p>}
                  {t.notes && (
                    <p className="line-clamp-2 text-slate-400">{t.notes}</p>
                  )}
                </div>

                {/* Status control */}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
                    value={t.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation()
                      patchStatus(t, e.target.value)
                    }}
                  >
                    {["Open", "InProgress", "Completed", "Cancelled"].map(
                      (s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      )
                    )}
                  </select>
                  <span className="text-[10px] text-slate-400">
                    Click to edit
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Showing {(page - 1) * pageSize + 1}–
              {Math.min(page * pageSize, totalCount)} of{" "}
              {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-slate-500">
                Page {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h4 className="text-lg font-semibold text-slate-900">
              Delete Task
            </h4>
            <p className="mt-2 text-sm text-slate-500">
              Are you sure you want to delete{" "}
              <strong>{deleteTarget.title}</strong>? This action cannot be
              undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={deleteDeleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={deleteDeleting}
                onClick={confirmDeleteTask}
              >
                {deleteDeleting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Resident Detail Modal */}
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
    </>
  )
}
