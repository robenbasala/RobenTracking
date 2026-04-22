"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowRightLeft,
  Building2,
  Calendar,
  CheckCircle2,
  CheckSquare2,
  Circle,
  DollarSign,
  Edit,
  FileText,
  Flame,
  History,
  LayoutGrid,
  Loader2,
  LogIn,
  Highlighter,
  LogOut,
  Paperclip,
  Pin,
  Plus,
  Printer,
  Send,
  Trash2,
  Upload,
  X,
  FileImage,
  FileArchive,
  FileSpreadsheet,
  FileCode2,
  File,
} from "lucide-react"
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiUrl,
} from "@/services/api"
import {
  fetchCensusByResidentId,
  type CensusBalanceRow,
} from "@/services/census-powerbi"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type {
  ModalSectionMeta,
  PendingTrackingDetailResponse,
  ResidentAttachment,
  ResidentEmail,
  ResidentNote,
  ResidentTask,
  UnifiedDetailFieldRow,
} from "@/lib/pending-tracking/types"

// ─── helpers ────────────────────────────────────────────────────────────────

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

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function attachmentIconFor(fileName: string, contentType?: string | null) {
  const lower = fileName.toLowerCase()
  const mime = (contentType ?? "").toLowerCase()
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lower)) return FileImage
  if (
    mime.includes("pdf") ||
    lower.endsWith(".pdf") ||
    mime.includes("msword") ||
    mime.includes("officedocument.wordprocessingml")
  ) return FileText
  if (
    mime.includes("sheet") ||
    mime.includes("excel") ||
    /\.(xls|xlsx|csv)$/i.test(lower)
  ) return FileSpreadsheet
  if (
    mime.includes("zip") ||
    mime.includes("rar") ||
    mime.includes("7z") ||
    /\.(zip|rar|7z|tar|gz)$/i.test(lower)
  ) return FileArchive
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    /\.(json|js|ts|tsx|jsx|sql|xml|html|css)$/i.test(lower)
  ) return FileCode2
  return File
}

function isImageAttachment(fileName: string, contentType?: string | null) {
  const lower = fileName.toLowerCase()
  const mime = (contentType ?? "").toLowerCase()
  if (mime.startsWith("image/")) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lower)
}

// ─── FieldDisplay ────────────────────────────────────────────────────────────

function FieldDisplay({ f }: { f: UnifiedDetailFieldRow }) {
  const dt = f.dataType.toLowerCase()
  const lbl = "mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400"

  if (dt === "boolean" || dt === "bit") {
    const b =
      f.value === true || f.value === 1 || String(f.value).toLowerCase() === "true"
    const isNull = f.value === null || f.value === undefined
    return (
      <div>
        <span className={lbl}>{f.displayName}</span>
        <span className="flex items-center gap-1.5">
          {isNull ? (
            <span className="text-sm text-slate-400">—</span>
          ) : b ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <Circle className="h-4 w-4 text-slate-300" />
          )}
          {!isNull && (
            <span className="text-sm text-slate-700">{b ? "Yes" : "No"}</span>
          )}
        </span>
      </div>
    )
  }

  if (dt === "date") {
    return (
      <div>
        <span className={lbl}>{f.displayName}</span>
        <span className="text-sm font-medium text-slate-700">{formatDateDisplay(f.value) || "—"}</span>
      </div>
    )
  }

  if (dt === "dropdown") {
    const match = f.dropdownOptions?.find(
      (o) => o.value === String(f.value ?? "")
    )
    const display = (match?.label ?? f.value) || "—"
    return (
      <div>
        <span className={lbl}>{f.displayName}</span>
        <span className="text-sm font-medium text-slate-700">{String(display)}</span>
      </div>
    )
  }

  if (dt === "currency") {
    const n = f.value != null && f.value !== "" ? Number(f.value) : null
    return (
      <div>
        <span className={lbl}>{f.displayName}</span>
        <span className="text-sm font-medium text-slate-700">
          {n != null && Number.isFinite(n)
            ? n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
            : "—"}
        </span>
      </div>
    )
  }

  return (
    <div>
      <span className={lbl}>{f.displayName}</span>
      <span className="text-sm font-medium text-slate-700">
        {f.value != null && f.value !== "" ? String(f.value) : "—"}
      </span>
    </div>
  )
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

function SectionCard({
  section,
  isEditing,
  editValues,
  onEditChange,
}: {
  section: ModalSectionMeta
  isEditing?: boolean
  editValues?: Record<string, unknown>
  onEditChange?: (fieldName: string, value: unknown) => void
}) {
  const isLOC = section.sectionType === "LOCTracking"
  const inEdit = Boolean(isEditing && editValues && onEditChange)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-5 text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {section.sectionName}
      </h3>
      {section.fields.length === 0 ? (
        <p className="text-sm text-slate-400">No fields in this section.</p>
      ) : isLOC ? (
        /* LOC sections: pair up consecutive date fields */
        <div className="space-y-3">
          {section.fields.map((f) => (
            <div key={f.fieldMetadataId} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <span className="flex-1 text-[11px] font-semibold text-slate-600">{f.displayName}</span>
              {inEdit && f.isEditable ? (
                <div className="min-w-[10rem] flex-1">
                  <EditFieldView
                    f={f}
                    showLabel={false}
                    value={
                      editValues![f.fieldName] ??
                      (f.dataType.toLowerCase() === "dropdown" ? f.dropdownOptionId : f.value)
                    }
                    onChange={(v) => onEditChange!(f.fieldName, v)}
                  />
                </div>
              ) : (
                <span className="text-sm font-medium text-slate-800">
                  {f.dataType.toLowerCase() === "date"
                    ? formatDateDisplay(f.value) || "—"
                    : f.value != null && f.value !== "" ? String(f.value) : "—"}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : inEdit ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3">
          {section.fields.map((f) => (
            <div key={f.fieldMetadataId}>
              {f.isEditable ? (
                <EditFieldView
                  f={f}
                  value={
                    editValues![f.fieldName] ??
                    (f.dataType.toLowerCase() === "dropdown" ? f.dropdownOptionId : f.value)
                  }
                  onChange={(v) => onEditChange!(f.fieldName, v)}
                />
              ) : (
                <FieldDisplay f={f} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3">
          {section.fields.map((f) => (
            <FieldDisplay key={f.fieldMetadataId} f={f} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── EditFieldView ────────────────────────────────────────────────────────

function EditFieldView({
  f,
  value,
  onChange,
  showLabel = true,
}: {
  f: UnifiedDetailFieldRow
  value: unknown
  onChange: (v: unknown) => void
  showLabel?: boolean
}) {
  const dt = f.dataType.toLowerCase()
  const lbl = "mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400"

  if (dt === "boolean" || dt === "bit") {
    const b = value === true || value === 1 || String(value).toLowerCase() === "true"
    return (
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={b}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-blue-600"
        />
        {showLabel ? <span className="text-sm text-slate-700">{f.displayName}</span> : null}
      </label>
    )
  }

  if (dt === "date") {
    const s = toDateInputValue(value)
    return (
      <div>
        {showLabel ? <span className={lbl}>{f.displayName}</span> : null}
        <input
          type="date"
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
          value={s}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  }

  if (dt === "dropdown") {
    return (
      <div>
        {showLabel ? <span className={lbl}>{f.displayName}</span> : null}
        <select
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">— Select —</option>
          {f.dropdownOptions?.map(o => (
            <option key={o.optionId} value={o.optionId}>{o.label || o.value}</option>
          ))}
        </select>
      </div>
    )
  }

  if (dt === "currency" || dt === "number") {
    return (
      <div>
        {showLabel ? <span className={lbl}>{f.displayName}</span> : null}
        <input
          type="number"
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
          value={value == null || value === "" ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          step={dt === "currency" ? "0.01" : "1"}
        />
      </div>
    )
  }

  if (dt === "textarea") {
    return (
      <div>
        {showLabel ? <span className={lbl}>{f.displayName}</span> : null}
        <textarea
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      </div>
    )
  }

  // text, text area
  return (
    <div>
      {showLabel ? <span className={lbl}>{f.displayName}</span> : null}
      <input
        type="text"
        className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

// ─── OverviewTab ──────────────────────────────────────────────────────────────

function OverviewTab({ detail, isEditing, editValues, onEditChange }: { detail: PendingTrackingDetailResponse; isEditing?: boolean; editValues?: Record<string, unknown>; onEditChange?: (fieldName: string, value: unknown) => void }) {
  const sections = detail.sections ?? []
  const sectionsToRender: ModalSectionMeta[] =
    sections.length === 0 && detail.fields.length > 0
      ? [
          {
            modalSectionId: null,
            sectionName: "General",
            sectionType: "Standard",
            displayOrder: 0,
            fields: detail.fields,
          },
        ]
      : sections

  if (sectionsToRender.length === 0 && detail.fields.length === 0) {
    return (
      <p className="mt-8 text-center text-sm text-slate-400">
        No detail fields configured. Add Detail or Both fields in Field Admin.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {sectionsToRender.map((section, i) => (
        <SectionCard
          key={section.modalSectionId ?? `gen-${i}`}
          section={section}
          isEditing={isEditing}
          editValues={editValues}
          onEditChange={onEditChange}
        />
      ))}
    </div>
  )
}

// ─── TasksTab ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  Open: "bg-blue-100 text-blue-700",
  InProgress: "bg-amber-100 text-amber-700",
  Completed: "bg-emerald-100 text-emerald-700",
  Cancelled: "bg-slate-100 text-slate-500",
}

const STATUSES = ["Open", "InProgress", "Completed", "Cancelled"] as const

function TasksTab({
  trackingItemId,
  companyId,
}: {
  trackingItemId: number
  companyId: number
}) {
  const [tasks, setTasks] = useState<ResidentTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newDue, setNewDue] = useState("")
  const [newStatus, setNewStatus] = useState("Open")
  const [newAssignee, setNewAssignee] = useState("")
  const [newNotes, setNewNotes] = useState("")
  const [saving, setSaving] = useState(false)

  /* Edit state */
  const [editingTask, setEditingTask] = useState<ResidentTask | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editDue, setEditDue] = useState("")
  const [editStatus, setEditStatus] = useState("")
  const [editAssignee, setEditAssignee] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  /* Delete confirmation */
  const [deleteTarget, setDeleteTarget] = useState<ResidentTask | null>(null)
  const [deleteDeleting, setDeleteDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet(
        `/api/pending-tracking/${trackingItemId}/tasks?companyId=${companyId}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as { tasks?: ResidentTask[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed")
      setTasks(data.tasks ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks.")
    } finally {
      setLoading(false)
    }
  }, [trackingItemId, companyId])

  useEffect(() => { void load() }, [load])

  function resetForm() {
    setNewTitle("")
    setNewDue("")
    setNewStatus("Open")
    setNewAssignee("")
    setNewNotes("")
    setAdding(false)
  }

  async function addTask() {
    const title = newTitle.trim()
    if (!title) return
    setSaving(true)
    try {
      const res = await apiPost(`/api/pending-tracking/${trackingItemId}/tasks`, {
        companyId,
        title,
        dueDate: newDue || null,
        status: newStatus,
        assignee: newAssignee.trim() || null,
        notes: newNotes.trim() || null,
      })
      if (!res.ok) throw new Error("Failed to create task")
      resetForm()
      await load()
    } catch {
      // silently ignore for now
    } finally {
      setSaving(false)
    }
  }

  async function patchStatus(taskId: number, status: string) {
    await apiPatch(`/api/pending-tracking/${trackingItemId}/tasks/${taskId}`, {
      companyId,
      status,
    })
    await load()
  }

  /* ── Open task for editing ── */
  function openEditTask(task: ResidentTask) {
    setEditingTask(task)
    setEditTitle(task.title)
    setEditDue(task.dueDate ? toDateInputValue(task.dueDate) : "")
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
      const res = await apiPatch(
        `/api/pending-tracking/${trackingItemId}/tasks/${editingTask.taskId}`,
        {
          companyId,
          title: editTitle.trim(),
          dueDate: editDue || null,
          status: editStatus,
          assignee: editAssignee.trim() || null,
          notes: editNotes.trim() || null,
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

  /* ── Delete task ── */
  async function confirmDeleteTask() {
    if (!deleteTarget) return
    setDeleteDeleting(true)
    try {
      const res = await apiDelete(
        `/api/pending-tracking/${trackingItemId}/tasks/${deleteTarget.taskId}?companyId=${companyId}`
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

  if (loading) return <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-slate-400" />
  if (error) return <p className="mt-8 text-center text-sm text-red-500">{error}</p>

  /* ── Edit panel (shown instead of card grid when a task is selected) ── */
  if (editingTask) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={closeEditTask}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Edit Task</h3>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Title *</label>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Task title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Due Date</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  value={editDue}
                  onChange={(e) => setEditDue(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</label>
                <select
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Assignee</label>
                <input
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Assignee name"
                  value={editAssignee}
                  onChange={(e) => setEditAssignee(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Notes</label>
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
                <Button size="sm" variant="ghost" onClick={closeEditTask}>Cancel</Button>
                <Button
                  size="sm"
                  className="bg-blue-600 text-white hover:bg-blue-700"
                  disabled={editSaving || !editTitle.trim()}
                  onClick={saveEditTask}
                >
                  {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Changes"}
                </Button>
              </div>
            </div>

            <div className="text-[11px] text-slate-400">
              Created {new Date(editingTask.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
              {editingTask.createdBy ? ` by ${editingTask.createdBy}` : ""}
            </div>
          </div>
        </div>

        {/* Delete confirmation for edit view */}
        {deleteTarget && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
              <h4 className="text-lg font-semibold text-slate-900">Delete Task</h4>
              <p className="mt-2 text-sm text-slate-500">
                Are you sure you want to delete <strong>{deleteTarget.title}</strong>? This action cannot be undone.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button size="sm" variant="outline" disabled={deleteDeleting} onClick={() => setDeleteTarget(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-red-600 text-white hover:bg-red-700"
                  disabled={deleteDeleting}
                  onClick={confirmDeleteTask}
                >
                  {deleteDeleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Tasks</h3>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setAdding(!adding)}>
          <Plus className="h-3.5 w-3.5" /> Add Task
        </Button>
      </div>

      {adding && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50/60 p-5">
          <input
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder="Task title *"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTask()}
          />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Due Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</label>
              <select
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Assignee</label>
              <input
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Assignee name"
                value={newAssignee}
                onChange={(e) => setNewAssignee(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Notes</label>
            <textarea
              className="w-full resize-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              rows={3}
              placeholder="Additional notes..."
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="bg-blue-600 text-white hover:bg-blue-700" onClick={addTask} disabled={saving || !newTitle.trim()}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <p className="text-sm text-slate-400">No tasks yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tasks.map((t) => (
            <div
              key={t.taskId}
              className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md hover:border-blue-200"
              onClick={() => openEditTask(t)}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <button
                    type="button"
                    title="Toggle complete"
                    onClick={(e) => {
                      e.stopPropagation()
                      patchStatus(t.taskId, t.status === "Completed" ? "Open" : "Completed")
                    }}
                    className="mt-0.5 shrink-0"
                  >
                    {t.status === "Completed" ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-slate-300 hover:text-slate-400" />
                    )}
                  </button>
                  <p className={cn("text-sm font-semibold text-slate-800", t.status === "Completed" && "line-through text-slate-400")}>
                    {t.title}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold leading-none", STATUS_COLORS[t.status] ?? "bg-slate-100 text-slate-500")}>
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

              <div className="space-y-1.5 text-[11px] text-slate-500">
                {t.dueDate && <p>Due: {formatDateDisplay(t.dueDate)}</p>}
                {t.assignee && <p>Assignee: {t.assignee}</p>}
                {t.notes && <p className="line-clamp-2 text-slate-400">{t.notes}</p>}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                <select
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
                  value={t.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation()
                    patchStatus(t.taskId, e.target.value)
                  }}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <span className="text-[10px] text-slate-400">Click to edit</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && !editingTask && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h4 className="text-lg font-semibold text-slate-900">Delete Task</h4>
            <p className="mt-2 text-sm text-slate-500">
              Are you sure you want to delete <strong>{deleteTarget.title}</strong>? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button size="sm" variant="outline" disabled={deleteDeleting} onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={deleteDeleting}
                onClick={confirmDeleteTask}
              >
                {deleteDeleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── NotesTab ─────────────────────────────────────────────────────────────────

function NotesTab({
  trackingItemId,
  companyId,
}: {
  trackingItemId: number
  companyId: number
}) {
  const [notes, setNotes] = useState<ResidentNote[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState("")
  const [noteType, setNoteType] = useState("CaseNote")
  const [saving, setSaving] = useState(false)
  const [phBusy, setPhBusy] = useState<{
    noteId: number
    kind: "pin" | "hl"
  } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet(
        `/api/pending-tracking/${trackingItemId}/notes?companyId=${companyId}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as { notes?: ResidentNote[] }
      setNotes(data.notes ?? [])
    } finally {
      setLoading(false)
    }
  }, [trackingItemId, companyId])

  useEffect(() => { void load() }, [load])

  async function addNote() {
    const text = body.trim()
    if (!text) return
    setSaving(true)
    try {
      await apiPost(`/api/pending-tracking/${trackingItemId}/notes`, {
        companyId,
        body: text,
        noteType,
      })
      setBody("")
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function deleteNote(noteId: number) {
    await apiDelete(
      `/api/pending-tracking/${trackingItemId}/notes/${noteId}?companyId=${companyId}`
    )
    await load()
  }

  async function togglePin(n: ResidentNote) {
    setPhBusy({ noteId: n.noteId, kind: "pin" })
    try {
      await apiPatch(
        `/api/pending-tracking/${trackingItemId}/notes/${n.noteId}`,
        { companyId, isPinned: !n.isPinned }
      )
      await load()
    } finally {
      setPhBusy(null)
    }
  }

  async function toggleHl(n: ResidentNote) {
    setPhBusy({ noteId: n.noteId, kind: "hl" })
    try {
      await apiPatch(
        `/api/pending-tracking/${trackingItemId}/notes/${n.noteId}`,
        { companyId, isHighlighted: !n.isHighlighted }
      )
      await load()
    } finally {
      setPhBusy(null)
    }
  }

  const NOTE_TYPE_COLOR: Record<string, string> = {
    CaseNote: "bg-blue-100 text-blue-700",
    Internal: "bg-violet-100 text-violet-700",
    External: "bg-teal-100 text-teal-700",
  }

  if (loading) return <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-slate-400" />

  return (
    <div className="flex flex-col gap-4">
      {/* compose */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">New Note</h3>
        <div className="mb-3 flex gap-2">
          {(["CaseNote", "Internal", "External"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setNoteType(t)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-bold transition",
                noteType === t
                  ? NOTE_TYPE_COLOR[t]
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <textarea
          className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
          rows={4}
          placeholder="Type a case note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="mt-3 flex justify-end">
          <Button
            className="gap-1.5 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700"
            disabled={saving || !body.trim()}
            onClick={addNote}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Submit Note
          </Button>
        </div>
      </div>

      {/* list */}
      {notes.length === 0 ? (
        <p className="text-center text-sm text-slate-400">No notes yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((n) => (
            <div
              key={n.noteId}
              className={cn(
                "rounded-xl border bg-white p-4 shadow-sm",
                n.isHighlighted
                  ? "border-amber-200 bg-amber-50/90 ring-1 ring-amber-200/80"
                  : "border-slate-200",
                n.isPinned && "border-l-4 border-l-amber-500 pl-3"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-bold", NOTE_TYPE_COLOR[n.noteType] ?? "bg-slate-100 text-slate-500")}>
                  {n.noteType}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title={n.isPinned ? "Unpin" : "Pin to top"}
                    disabled={phBusy !== null}
                    onClick={() => void togglePin(n)}
                    className={cn(
                      "rounded p-1.5 transition-colors",
                      n.isPinned
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                        : "text-slate-300 hover:bg-amber-50 hover:text-amber-600"
                    )}
                  >
                    {phBusy?.noteId === n.noteId && phBusy.kind === "pin" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pin className={cn("h-3.5 w-3.5", n.isPinned && "fill-current")} />
                    )}
                  </button>
                  <button
                    type="button"
                    title={n.isHighlighted ? "Remove highlight" : "Highlight"}
                    disabled={phBusy !== null}
                    onClick={() => void toggleHl(n)}
                    className={cn(
                      "rounded p-1.5 transition-colors",
                      n.isHighlighted
                        ? "bg-amber-200 text-amber-900 hover:bg-amber-300"
                        : "text-slate-300 hover:bg-amber-50 hover:text-amber-700"
                    )}
                  >
                    {phBusy?.noteId === n.noteId && phBusy.kind === "hl" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Highlighter className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <span className="mx-1 text-[11px] text-slate-400">
                    {new Date(n.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                    {n.createdBy ? ` · ${n.createdBy}` : ""}
                  </span>
                  <button
                    type="button"
                    title="Delete note"
                    onClick={() => deleteNote(n.noteId)}
                    className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── EmailsTab ────────────────────────────────────────────────────────────────

function EmailsTab({
  trackingItemId,
  companyId,
}: {
  trackingItemId: number
  companyId: number
}) {
  const [emails, setEmails] = useState<ResidentEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [toEmail, setToEmail] = useState("")
  const [toName, setToName] = useState("")
  const [ccEmails, setCcEmails] = useState("")
  const [subject, setSubject] = useState("")
  const [emailBody, setEmailBody] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet(
        `/api/pending-tracking/${trackingItemId}/emails?companyId=${companyId}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as { emails?: ResidentEmail[] }
      setEmails(data.emails ?? [])
    } finally {
      setLoading(false)
    }
  }, [trackingItemId, companyId])

  useEffect(() => { void load() }, [load])

  function openCompose() {
    setComposing(true)
    setSendError(null)
  }

  function cancelCompose() {
    setComposing(false)
    setToEmail("")
    setToName("")
    setCcEmails("")
    setSubject("")
    setEmailBody("")
    setSendError(null)
  }

  async function handleSend() {
    const to = toEmail.trim()
    const subj = subject.trim()
    const body = emailBody.trim()
    if (!to || !subj || !body) return
    setSending(true)
    setSendError(null)
    try {
      // ── TODO: Call your external email-send API here ──────────────────────
      // Example:
      //   const sendResult = await fetch("https://your-email-api/send", {
      //     method: "POST",
      //     headers: { "Content-Type": "application/json" },
      //     body: JSON.stringify({
      //       to,
      //       toName: toName.trim() || undefined,
      //       cc: ccEmails.trim() || undefined,
      //       subject: subj,
      //       body,
      //     }),
      //   })
      //   const { messageId } = await sendResult.json()
      // ─────────────────────────────────────────────────────────────────────

      // Log to our DB (status Queued until your API confirms Sent)
      const res = await apiPost(`/api/pending-tracking/${trackingItemId}/emails`, {
        companyId,
        subject: subj,
        body,
        recipientEmail: to,
        recipientName: toName.trim() || null,
        ccEmails: ccEmails.trim() || null,
        status: "Queued",
      })
      if (!res.ok) throw new Error("Failed to log email")
      cancelCompose()
      await load()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Failed to send email.")
    } finally {
      setSending(false)
    }
  }

  const STATUS_EMAIL_COLOR: Record<string, string> = {
    Sent: "bg-emerald-100 text-emerald-700",
    Failed: "bg-red-100 text-red-600",
    Queued: "bg-amber-100 text-amber-700",
  }

  if (loading) return <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-slate-400" />

  return (
    <div className="flex flex-col gap-4">
      {/* ── Compose form ── */}
      {composing ? (
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">New Email</h3>
            <button type="button" onClick={cancelCompose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">To *</label>
                <input
                  type="email"
                  placeholder="recipient@example.com"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Recipient Name</label>
                <input
                  type="text"
                  placeholder="Jane Smith"
                  value={toName}
                  onChange={(e) => setToName(e.target.value)}
                  className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">CC</label>
              <input
                type="text"
                placeholder="cc@example.com, another@example.com"
                value={ccEmails}
                onChange={(e) => setCcEmails(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Subject *</label>
              <input
                type="text"
                placeholder="Email subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Message *</label>
              <textarea
                rows={6}
                placeholder="Type your message…"
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
              />
            </div>

            {sendError && <p className="text-sm text-red-500">{sendError}</p>}

            <div className="flex items-center justify-between">
              <p className="text-[11px] text-amber-600">
                Connect your send API in EmailsTab.handleSend() to deliver this email.
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={cancelCompose}>Cancel</Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700"
                  disabled={sending || !toEmail.trim() || !subject.trim() || !emailBody.trim()}
                  onClick={handleSend}
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {sending ? "Queuing…" : "Queue Email"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={openCompose}>
            <Send className="h-3.5 w-3.5" /> Compose Email
          </Button>
        </div>
      )}

      {/* ── Email log ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">Email Log</h3>
        {emails.length === 0 ? (
          <p className="text-sm text-slate-400">No emails logged yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {emails.map((e) => (
              <div key={e.emailId} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{e.subject}</p>
                    <p className="text-[12px] text-slate-500">
                      To: {e.recipientName ? `${e.recipientName} <${e.recipientEmail}>` : e.recipientEmail}
                      {e.ccEmails ? ` · CC: ${e.ccEmails}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", STATUS_EMAIL_COLOR[e.status] ?? "bg-slate-100 text-slate-500")}>
                      {e.status}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(e.sentAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── AttachmentsTab ───────────────────────────────────────────────────────────

function AttachmentsTab({
  trackingItemId,
  companyId,
  uniqueId,
  residentId,
}: {
  trackingItemId: number
  companyId: number
  uniqueId?: string | null
  residentId?: string | null
}) {
  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
  const [attachments, setAttachments] = useState<ResidentAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [description, setDescription] = useState("")
  const [uploading, setUploading] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [previewAttachmentId, setPreviewAttachmentId] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiGet(
        `/api/pending-tracking/${trackingItemId}/attachments?companyId=${companyId}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as { attachments?: ResidentAttachment[] }
      setAttachments(data.attachments ?? [])
    } finally {
      setLoading(false)
    }
  }, [trackingItemId, companyId])

  useEffect(() => { void load() }, [load])

  async function deleteAttachment(attachmentId: number) {
    setDeletingAttachmentId(attachmentId)
    try {
      await apiDelete(
        `/api/pending-tracking/${trackingItemId}/attachments/${attachmentId}?companyId=${companyId}`
      )
      await load()
      setDeleteConfirmId(null)
    } finally {
      setDeletingAttachmentId(null)
    }
  }

  function cancelUpload() {
    setShowUpload(false)
    setSelectedFile(null)
    setDescription("")
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleUpload() {
    if (!selectedFile) return
    if (selectedFile.size > MAX_ATTACHMENT_BYTES) {
      setUploadError("File is too large. Maximum allowed size is 25MB.")
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      formData.append("companyId", String(companyId))
      if (uniqueId?.trim()) formData.append("uniqueId", uniqueId.trim())
      if (residentId?.trim()) formData.append("residentId", residentId.trim())
      if (description.trim()) formData.append("description", description.trim())
      if (process.env.NEXT_PUBLIC_ACTING_USER?.trim()) {
        formData.append("uploadedBy", process.env.NEXT_PUBLIC_ACTING_USER.trim())
      }
      const uploadRes = await fetch(
        apiUrl(`/api/pending-tracking/${trackingItemId}/attachments/upload`),
        { method: "POST", body: formData }
      )
      if (!uploadRes.ok) {
        const errText = await uploadRes.text()
        if (uploadRes.status === 413 || /file too large|limit file size/i.test(errText)) {
          throw new Error("File is too large. Maximum allowed size is 25MB.")
        }
        throw new Error(errText || "Upload failed.")
      }
      await load()
      cancelUpload()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.")
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-slate-400" />

  return (
    <div className="flex flex-col gap-4">
      {/* ── Upload form ── */}
      {showUpload ? (
        <div className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Upload File</h3>
            <button type="button" onClick={cancelUpload} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {/* File picker */}
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-8 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-7 w-7 text-slate-400" />
              {selectedFile ? (
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-700">{selectedFile.name}</p>
                  <p className="text-[11px] text-slate-400">{formatFileSize(selectedFile.size)}</p>
                </div>
              ) : (
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-600">Click to select a file</p>
                  <p className="text-[11px] text-slate-400">Any file type accepted</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  if (f && f.size > MAX_ATTACHMENT_BYTES) {
                    setSelectedFile(null)
                    setUploadError("File is too large. Maximum allowed size is 25MB.")
                    if (fileInputRef.current) fileInputRef.current.value = ""
                    return
                  }
                  setSelectedFile(f)
                  setUploadError(null)
                }}
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-400">Description (optional)</label>
              <input
                type="text"
                placeholder="e.g. Authorization form, LOC letter…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
              />
            </div>

            {uploadError && <p className="text-sm text-red-500">{uploadError}</p>}

            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-500">Max upload size: 25MB</p>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={cancelUpload}>Cancel</Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700"
                  disabled={uploading || !selectedFile}
                  onClick={handleUpload}
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowUpload(true)}>
            <Paperclip className="h-3.5 w-3.5" /> Upload File
          </Button>
        </div>
      )}

      {/* ── Attachments list ── */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-widest text-slate-500">Attachments</h3>
        {attachments.length === 0 ? (
          <p className="text-sm text-slate-400">No attachments yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {attachments.map((a) => (
              <div key={a.attachmentId} className="py-3">
                <div className="flex items-center gap-3">
                {(() => {
                  const Icon = attachmentIconFor(a.fileName, a.contentType)
                  return <Icon className="h-5 w-5 shrink-0 text-slate-400" />
                })()}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{a.fileName}</p>
                  <p className="text-[11px] text-slate-400">
                    {a.contentType}
                    {a.fileSizeBytes != null ? ` · ${formatFileSize(a.fileSizeBytes)}` : ""}
                    {a.uploadedBy ? ` · ${a.uploadedBy}` : ""}
                    {" · "}
                    {new Date(a.uploadedAt).toLocaleDateString("en-US")}
                  </p>
                  {a.description && <p className="text-[11px] text-slate-500">{a.description}</p>}
                </div>
                <a
                  href={apiUrl(
                    `/api/pending-tracking/${trackingItemId}/attachments/${a.attachmentId}/download?companyId=${companyId}`
                  )}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:bg-blue-50"
                >
                  Download
                </a>
                <button
                  type="button"
                  className="shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
                  onClick={() =>
                    setPreviewAttachmentId((prev) =>
                      prev === a.attachmentId ? null : a.attachmentId
                    )
                  }
                >
                  {previewAttachmentId === a.attachmentId ? "Hide" : "Preview"}
                </button>
                <button
                  type="button"
                  title="Delete attachment"
                  disabled={deletingAttachmentId === a.attachmentId}
                  onClick={() => setDeleteConfirmId(a.attachmentId)}
                  className="shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-400"
                >
                  {deletingAttachmentId === a.attachmentId ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
                {previewAttachmentId === a.attachmentId && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {isImageAttachment(a.fileName, a.contentType) ? (
                      <img
                        src={apiUrl(
                          `/api/pending-tracking/${trackingItemId}/attachments/${a.attachmentId}/download?companyId=${companyId}`
                        )}
                        alt={a.fileName}
                        className="max-h-[480px] w-full object-contain bg-white"
                        loading="lazy"
                      />
                    ) : (
                      <div>
                        <iframe
                          src={apiUrl(
                            `/api/pending-tracking/${trackingItemId}/attachments/${a.attachmentId}/download?companyId=${companyId}`
                          )}
                          title={`Preview ${a.fileName}`}
                          className="h-[520px] w-full bg-white"
                        />
                        <div className="flex items-center justify-between border-t border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                          <span>
                            If this file type is not embeddable in your browser, use Open/Download.
                          </span>
                          <a
                            href={apiUrl(
                              `/api/pending-tracking/${trackingItemId}/attachments/${a.attachmentId}/download?companyId=${companyId}`
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded px-2 py-1 font-semibold text-blue-600 hover:bg-blue-50"
                          >
                            Open in new tab
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {deleteConfirmId === a.attachmentId && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50/60 p-3">
                    <p className="text-sm font-medium text-red-700">
                      Delete this attachment? This cannot be undone.
                    </p>
                   
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deletingAttachmentId === a.attachmentId}
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="bg-red-600 text-white hover:bg-red-700"
                        disabled={deletingAttachmentId === a.attachmentId}
                        onClick={() => void deleteAttachment(a.attachmentId)}
                      >
                        {deletingAttachmentId === a.attachmentId ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── CensusTab ───────────────────────────────────────────────────────────────

const DUMMY_CENSUS = [
  { date: "2025-01-15", event: "Admission", type: "admission" as const, payer: "Medicare A", facility: "Peak Healthcare", details: "Initial admission from Community General Hospital" },
  { date: "2025-01-28", event: "Payer Change", type: "payer-change" as const, payer: "Medicare A → Medicaid Pending", facility: "Peak Healthcare", details: "Medicare benefit exhausted, Medicaid application submitted" },
  { date: "2025-02-10", event: "Room Transfer", type: "transfer" as const, payer: "Medicaid Pending", facility: "Peak Healthcare", details: "Transferred from Room 204A to Room 112B (semi-private)" },
  { date: "2025-03-01", event: "Payer Change", type: "payer-change" as const, payer: "Medicaid Pending → Medicaid Approved", facility: "Peak Healthcare", details: "Medicaid eligibility confirmed effective 02/01/2025" },
  { date: "2025-03-15", event: "Discharge", type: "discharge" as const, payer: "Medicaid Approved", facility: "Peak Healthcare", details: "Discharged to home with outpatient therapy plan" },
  { date: "2025-04-02", event: "Re-Admission", type: "admission" as const, payer: "Medicare A", facility: "Peak Healthcare", details: "Re-admitted following fall at home, new Medicare spell" },
]

const CENSUS_EVENT_STYLES: Record<string, { icon: React.ElementType; bg: string; text: string; border: string }> = {
  admission: { icon: LogIn, bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  discharge: { icon: LogOut, bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  "payer-change": { icon: ArrowRightLeft, bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  transfer: { icon: Building2, bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
}

function CensusTab() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Census data is currently using placeholder data. Live census integration coming soon.
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-widest text-slate-500">Resident Census History</h3>
        <div className="relative">
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-slate-200" />
          <div className="flex flex-col gap-4">
            {DUMMY_CENSUS.map((entry, i) => {
              const style = CENSUS_EVENT_STYLES[entry.type] ?? CENSUS_EVENT_STYLES.admission
              const Icon = style.icon
              return (
                <div key={i} className="relative flex gap-4 pl-0">
                  <div className={cn("z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border", style.bg, style.border)}>
                    <Icon className={cn("h-4 w-4", style.text)} />
                  </div>
                  <div className={cn("flex-1 rounded-lg border p-4", style.border, style.bg)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("text-sm font-bold", style.text)}>{entry.event}</span>
                      <span className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Calendar className="h-3 w-3" />
                        {formatDateDisplay(entry.date)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-slate-600">{entry.details}</p>
                    <div className="mt-2 flex gap-4 text-[11px] text-slate-500">
                      <span>Payer: <strong className="text-slate-700">{entry.payer}</strong></span>
                      <span>Facility: <strong className="text-slate-700">{entry.facility}</strong></span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── FinancialTab ────────────────────────────────────────────────────────────

function formatPivotMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function sortPivotRows(rows: CensusBalanceRow[]): CensusBalanceRow[] {
  return [...rows].sort((a, b) => {
    const ya = a.yearMonth ?? 0
    const yb = b.yearMonth ?? 0
    if (ya !== yb) return yb - ya
    const da = a.month ?? ""
    const db = b.month ?? ""
    return db.localeCompare(da)
  })
}

function FinancialTab({ residentId }: { residentId: string | null }) {
  const [pivotRows, setPivotRows] = useState<CensusBalanceRow[]>([])
  const [pivotLoading, setPivotLoading] = useState(false)
  const [pivotError, setPivotError] = useState<string | null>(null)

  const loadPivot = useCallback(async () => {
    if (!residentId?.trim()) {
      setPivotRows([])
      setPivotError(null)
      setPivotLoading(false)
      return
    }
    setPivotLoading(true)
    setPivotError(null)
    try {
      const result = await fetchCensusByResidentId(residentId)
      if (result.error) {
        setPivotRows([])
        setPivotError(result.error)
        return
      }
      setPivotRows(sortPivotRows(result.rows))
    } catch (e) {
      setPivotRows([])
      setPivotError(e instanceof Error ? e.message : "Failed to load Power BI data.")
    } finally {
      setPivotLoading(false)
    }
  }, [residentId])

  useEffect(() => {
    void loadPivot()
  }, [loadPivot])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-500">
            <DollarSign className="h-4 w-4" />
            Balance by month (Power BI)
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => void loadPivot()}
            disabled={pivotLoading || !residentId?.trim()}
          >
            {pivotLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Refresh
          </Button>
        </div>
        {!residentId?.trim() ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No resident identifier on this row (expected ResidentID, PatientID, resstayID, or CID). Power BI cannot be queried.
          </div>
        ) : pivotError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{pivotError}</div>
        ) : pivotLoading ? (
          <div className="flex items-center gap-2 py-8 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading financial pivot…
          </div>
        ) : pivotRows.length === 0 ? (
          <p className="py-6 text-sm text-slate-400">No balance rows returned for this resident.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="pb-2 pr-3">Month</th>
                  <th className="pb-2 pr-3">YearMonth</th>
                  <th className="pb-2 pr-3">Payer</th>
                  <th className="pb-2 pr-3">Payer type</th>
                  <th className="pb-2 pr-3 text-right">Balance</th>
                  <th className="pb-2">Fac / Patient</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pivotRows.map((r, i) => (
                  <tr key={`${r.yearMonth ?? i}-${r.month ?? i}-${i}`} className="text-slate-700">
                    <td className="py-2 pr-3 font-medium">{r.month ? formatDateDisplay(r.month) : "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.yearMonth ?? "—"}</td>
                    <td className="py-2 pr-3">{r.payerName ?? "—"}</td>
                    <td className="py-2 pr-3">{r.payerType ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-semibold">{formatPivotMoney(r.balance)}</td>
                    <td className="py-2 text-[11px] text-slate-500">
                      {r.facId ? <span className="mr-2">Fac: {r.facId}</span> : null}
                      {r.patientId ? <span>Pat: {r.patientId}</span> : null}
                      {!r.facId && !r.patientId ? "—" : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {residentId?.trim() ? (
          <p className="mt-3 text-xs text-slate-500">
            ResidentId: <span className="font-mono font-semibold text-slate-700">{residentId}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

// ─── ResidentDetailModal ──────────────────────────────────────────────────────

type Tab = "Overview" | "Census" | "Financial" | "Tasks" | "Notes" | "Attachments"
const TABS: Tab[] = ["Overview", "Census", "Financial", "Tasks", "Notes", "Attachments"]
const TAB_ICONS: Record<Tab, React.ElementType> = {
  Overview: LayoutGrid,
  Census: History,
  Financial: DollarSign,
  Tasks: CheckSquare2,
  Notes: FileText,
  Attachments: Paperclip,
}

type Props = {
  trackingItemId: number | null
  companyId: number
  state?: string | null
  open: boolean
  onHotCaseChanged?: (trackingItemId: number, isHotCase: boolean) => void
  onClose: () => void
}

export function ResidentDetailModal({
  trackingItemId,
  companyId,
  state,
  open,
  onHotCaseChanged,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<PendingTrackingDetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>("Overview")
  const [togglingHotCase, setTogglingHotCase] = useState(false)
  const [isEditingFields, setIsEditingFields] = useState(false)
  const [fieldEditValues, setFieldEditValues] = useState<Record<string, unknown>>({})
  const [savingFields, setSavingFields] = useState(false)
  const prevIdRef = useRef<number | null>(null)

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    setDetail(null)
    setDetailError(null)
    try {
      const qs = state?.trim() ? `?state=${state.trim().slice(0, 2).toUpperCase()}` : ""
      const res = await apiGet(`/api/pending-tracking/${id}${qs}`, { cache: "no-store" })
      const data = (await res.json()) as PendingTrackingDetailResponse & { error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to load detail.")
      setDetail(data)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load resident details.")
    } finally {
      setDetailLoading(false)
    }
  }, [state])

  useEffect(() => {
    if (!open || trackingItemId == null) return
    if (prevIdRef.current !== trackingItemId) {
      prevIdRef.current = trackingItemId
      setActiveTab("Overview")
      setIsEditingFields(false)
      setFieldEditValues({})
      void loadDetail(trackingItemId)
    }
  }, [open, trackingItemId, loadDetail])

  useEffect(() => {
    if (activeTab !== "Overview") {
      setIsEditingFields(false)
      setFieldEditValues({})
    }
  }, [activeTab])

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      prevIdRef.current = null
      onClose()
    }
  }

  async function toggleHotCase() {
    if (!detail || togglingHotCase) return
    const nextVal = !detail.header?.isHotCase
    setTogglingHotCase(true)
    try {
      const res = await apiPatch(`/api/pending-tracking/${detail.trackingItemId}/hot-case`, {
        companyId: detail.companyId,
        isHotCase: nextVal,
      })
      if (!res.ok) throw new Error("Failed to update hot case status")
      setDetail((prev) =>
        prev
          ? { ...prev, header: { ...prev.header, isHotCase: nextVal } }
          : prev
      )
      onHotCaseChanged?.(detail.trackingItemId, nextVal)
    } catch {
      // silently ignore
    } finally {
      setTogglingHotCase(false)
    }
  }

  function startEditingFields() {
    if (!detail) return
    const values: Record<string, unknown> = {}
    for (const section of detail.sections) {
      for (const field of section.fields) {
        if (field.isEditable) {
          values[field.fieldName] = field.dataType.toLowerCase() === "dropdown" ? field.dropdownOptionId : field.value
        }
      }
    }
    for (const field of detail.fields) {
      if (field.isEditable) {
        values[field.fieldName] = field.dataType.toLowerCase() === "dropdown" ? field.dropdownOptionId : field.value
      }
    }
    setFieldEditValues(values)
    setIsEditingFields(true)
  }

  function cancelEditingFields() {
    setIsEditingFields(false)
    setFieldEditValues({})
  }

  async function saveFields() {
    if (!detail) return
    setSavingFields(true)
    try {
      const res = await apiPut(`/api/pending-tracking/${detail.trackingItemId}/values`, {
        values: fieldEditValues,
      })
      if (!res.ok) throw new Error("Failed to save")
      setIsEditingFields(false)
      await loadDetail(detail.trackingItemId)
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to save changes")
    } finally {
      setSavingFields(false)
    }
  }

  function firstFieldValue(name: string): string | null {
    if (!detail) return null
    const target = name.toLowerCase()
    for (const section of detail.sections) {
      for (const f of section.fields) {
        if (f.fieldName.toLowerCase() === target) {
          const v = f.value
          return v == null ? null : String(v)
        }
      }
    }
    for (const f of detail.fields) {
      if (f.fieldName.toLowerCase() === target) {
        const v = f.value
        return v == null ? null : String(v)
      }
    }
    return null
  }

  const attachmentUniqueId = firstFieldValue("uniqueid")
  const attachmentResidentId =
    firstFieldValue("residentid") ??
    firstFieldValue("resstayID") ??
    firstFieldValue("cid")

  /** Power BI / financial pivot: prefer API header from TrackingItemsTbl; fallback to visible detail fields. */
  const censusResidentId =
    detail?.header?.residentId?.trim() ||
    attachmentResidentId?.trim() ||
    null

  const initials = (detail?.header?.residentName ?? "?")
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?"

  function detailHasAnyEditableField(d: PendingTrackingDetailResponse): boolean {
    for (const section of d.sections ?? []) {
      for (const f of section.fields) {
        if (f.isEditable) return true
      }
    }
    for (const f of d.fields) {
      if (f.isEditable) return true
    }
    return false
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[96vh] w-[98vw] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-2xl [&>button]:right-5 [&>button]:top-5 [&>button]:z-50">
        <DialogHeader className="sr-only">
          <DialogTitle>Resident detail</DialogTitle>
          <DialogDescription>Case fields for this resident.</DialogDescription>
        </DialogHeader>

        {/* ── Loading ── */}
        {detailLoading && (
          <div className="flex flex-1 items-center justify-center gap-3 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Loading resident…</span>
          </div>
        )}

        {/* ── Error ── */}
        {!detailLoading && detailError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8">
            <p className="text-base font-semibold text-red-500">Could not load this resident</p>
            <p className="text-sm text-slate-400">{detailError}</p>
          </div>
        )}

        {/* ── Content ── */}
        {!detailLoading && detail && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">

            {/* ══ HEADER ══ */}
            <div className="shrink-0 border-b border-slate-200 bg-white px-8 py-5">
              <div className="flex items-center gap-5">
                {/* Avatar */}
                <div className="flex h-[70px] w-[70px] shrink-0 items-center justify-center rounded-full bg-slate-200 text-xl font-extrabold text-slate-500 shadow-sm">
                  {initials}
                </div>

                {/* Name + demographics */}
                <div className="flex-1 min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2.5">
                    <h2 className="text-[22px] font-extrabold leading-tight text-slate-900">
                      {detail.header?.residentName ?? "Resident"}
                    </h2>
                    <span className="rounded-md border border-amber-200 bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest text-amber-700">
                      {detail.header?.payerLabel ?? detail.viewType}
                    </span>
                    {detail.header?.isHotCase && (
                      <span className="flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                        <Flame className="h-3.5 w-3.5" /> Hot Case
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-8 gap-y-0.5">
                    {[
                      {
                        label: "Date of Birth",
                        value: `${detail.header?.dateOfBirthDisplay ?? "—"}${detail.header?.ageYears != null ? ` (${detail.header.ageYears} yrs)` : ""}`,
                      },
                      { label: "SSN", value: detail.header?.ssnDisplay ?? "—" },
                      { label: "Admit Date", value: detail.header?.admitDateDisplay ?? "—" },
                      { label: "Discharge Date", value: detail.header?.dischargeDateDisplay ?? "—" },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                        <div className="text-[13px] font-semibold text-slate-700">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "gap-1.5 rounded-lg px-4 text-sm font-semibold",
                      detail.header?.isHotCase
                        ? "border-red-300 text-red-600 hover:bg-red-50"
                        : "border-slate-300 text-slate-700 hover:bg-slate-50"
                    )}
                    onClick={toggleHotCase}
                    disabled={togglingHotCase}
                  >
                    <Flame className="h-3.5 w-3.5" />
                    {detail.header?.isHotCase ? "Remove Hot Case" : "Mark Hot Case"}
                  </Button>
                  {activeTab === "Overview" && detailHasAnyEditableField(detail) ? (
                    !isEditingFields ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 rounded-lg px-4 text-sm font-semibold border-slate-300 text-slate-700 hover:bg-slate-50"
                        onClick={startEditingFields}
                      >
                        <Edit className="h-3.5 w-3.5" />
                        Edit fields
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-lg px-4 text-sm font-semibold"
                          onClick={cancelEditingFields}
                          disabled={savingFields}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="gap-1.5 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                          onClick={() => void saveFields()}
                          disabled={savingFields}
                        >
                          {savingFields ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Save
                        </Button>
                      </>
                    )
                  ) : null}
                </div>
              </div>
            </div>

            {/* ══ TABS BAR ══ */}
            <div className="shrink-0 flex border-b border-slate-200 bg-white px-8">
              {TABS.map((tab) => {
                const Icon = TAB_ICONS[tab]
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 border-b-2 py-3.5 text-sm font-semibold transition-colors",
                      activeTab === tab
                        ? "border-blue-600 text-blue-600"
                        : "border-transparent text-slate-500 hover:text-slate-800"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab}
                  </button>
                )
              })}
            </div>

            {/* ══ TAB BODY ══ */}
            <div className="flex-1 overflow-y-auto bg-slate-50/60 p-6">
              {activeTab === "Overview" && (
                <OverviewTab
                  detail={detail}
                  isEditing={isEditingFields}
                  editValues={fieldEditValues}
                  onEditChange={(fieldName, value) => setFieldEditValues(prev => ({ ...prev, [fieldName]: value }))}
                />
              )}
              {activeTab === "Census" && <CensusTab />}
              {activeTab === "Financial" && <FinancialTab residentId={censusResidentId} />}
              {activeTab === "Tasks" && (
                <TasksTab trackingItemId={detail.trackingItemId} companyId={detail.companyId} />
              )}
              {activeTab === "Notes" && (
                <NotesTab trackingItemId={detail.trackingItemId} companyId={detail.companyId} />
              )}
              {activeTab === "Attachments" && (
                <AttachmentsTab
                  trackingItemId={detail.trackingItemId}
                  companyId={detail.companyId}
                  uniqueId={attachmentUniqueId}
                  residentId={censusResidentId}
                />
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
