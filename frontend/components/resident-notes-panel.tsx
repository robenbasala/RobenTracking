"use client"

import { apiDelete, apiGet, apiPatch, apiPost } from "@/services/api"
import { useCallback, useEffect, useState } from "react"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Loader2,
  Pencil,
  Pin,
  StickyNote,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type NoteDto = {
  noteId: number
  noteType: string
  body: string
  createdAt: string
  createdBy: string | null
  isPinned?: boolean
  isHighlighted?: boolean
}

type ResidentNotesPanelProps = {
  companyId: number
  trackingItemId: number | null
  residentLabel?: string | null
  className?: string
}

export function ResidentNotesPanel({
  companyId,
  trackingItemId,
  residentLabel,
  className,
}: ResidentNotesPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState<NoteDto[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  // Edit state
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editBody, setEditBody] = useState("")
  const [editSaving, setEditSaving] = useState(false)

  // Delete state
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [phBusy, setPhBusy] = useState<{
    noteId: number
    kind: "pin" | "hl"
  } | null>(null)

  const loadNotes = useCallback(async () => {
    if (trackingItemId == null) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("companyId", String(companyId))
      const res = await apiGet(
        `/api/pending-tracking/${trackingItemId}/notes?${params}`,
        { cache: "no-store" }
      )
      const data = (await res.json()) as { notes?: NoteDto[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to load notes.")
      setNotes(data.notes ?? [])
    } catch (e) {
      setNotes([])
      setError(e instanceof Error ? e.message : "Failed to load notes.")
    } finally {
      setLoading(false)
    }
  }, [companyId, trackingItemId])

  useEffect(() => {
    setDraft("")
    setEditingNoteId(null)
    setDeleteConfirm(null)
    if (trackingItemId == null) {
      setNotes([])
      setError(null)
      return
    }
    void loadNotes()
  }, [trackingItemId, loadNotes])

  async function addNote() {
    const body = draft.trim()
    if (!body || trackingItemId == null) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiPost(`/api/pending-tracking/${trackingItemId}/notes`, {
        companyId,
        body,
        noteType: "CaseNote",
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "Could not save note.")
      setDraft("")
      await loadNotes()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save note.")
    } finally {
      setSaving(false)
    }
  }

  function startEdit(note: NoteDto) {
    setEditingNoteId(note.noteId)
    setEditBody(note.body)
    setDeleteConfirm(null)
  }

  function cancelEdit() {
    setEditingNoteId(null)
    setEditBody("")
  }

  async function saveEdit(noteId: number) {
    if (!editBody.trim()) return
    setEditSaving(true)
    try {
      const res = await apiPatch(
        `/api/pending-tracking/${trackingItemId}/notes/${noteId}`,
        { companyId, body: editBody.trim() }
      )
      if (!res.ok) throw new Error("Failed to update note.")
      setEditingNoteId(null)
      setEditBody("")
      await loadNotes()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update note.")
    } finally {
      setEditSaving(false)
    }
  }

  async function togglePinned(note: NoteDto) {
    if (trackingItemId == null) return
    setPhBusy({ noteId: note.noteId, kind: "pin" })
    setError(null)
    try {
      const res = await apiPatch(
        `/api/pending-tracking/${trackingItemId}/notes/${note.noteId}`,
        { companyId, isPinned: !note.isPinned }
      )
      if (!res.ok) throw new Error("Could not update pin.")
      await loadNotes()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update pin.")
    } finally {
      setPhBusy(null)
    }
  }

  async function toggleHighlighted(note: NoteDto) {
    if (trackingItemId == null) return
    setPhBusy({ noteId: note.noteId, kind: "hl" })
    setError(null)
    try {
      const res = await apiPatch(
        `/api/pending-tracking/${trackingItemId}/notes/${note.noteId}`,
        { companyId, isHighlighted: !note.isHighlighted }
      )
      if (!res.ok) throw new Error("Could not update highlight.")
      await loadNotes()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update highlight.")
    } finally {
      setPhBusy(null)
    }
  }

  async function deleteNote(noteId: number) {
    setDeletingNoteId(noteId)
    try {
      const res = await apiDelete(
        `/api/pending-tracking/${trackingItemId}/notes/${noteId}?companyId=${companyId}`
      )
      if (!res.ok) throw new Error("Failed to delete note.")
      setDeleteConfirm(null)
      await loadNotes()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete note.")
    } finally {
      setDeletingNoteId(null)
    }
  }

  /* ── Collapsed state ── */
  if (!expanded) {
    return (
      <aside
        className={cn(
          "flex shrink-0 border-slate-200/80 bg-slate-50 transition-[width] duration-200 ease-out",
          "w-full flex-row items-center justify-between gap-2 rounded-2xl border px-3 py-2.5",
          "lg:min-h-[min(70vh,720px)] lg:w-12 lg:flex-col lg:justify-start lg:gap-0 lg:rounded-2xl lg:border lg:px-1 lg:py-3",
          className
        )}
      >
        <div className="flex items-center gap-2 lg:flex-col lg:gap-0">
          <button
            type="button"
            title="Expand notes"
            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-white hover:text-blue-600"
            onClick={() => setExpanded(true)}
          >
            <ChevronLeft className="h-5 w-5 lg:rotate-0" />
          </button>
          <StickyNote
            className="h-5 w-5 text-blue-500 lg:mt-3"
            aria-hidden
          />
          {trackingItemId != null && (
            <span
              className="ml-1 h-2 w-2 rounded-full bg-blue-500 lg:ml-0 lg:mt-2"
              title="Line selected"
            />
          )}
        </div>
        <button
          type="button"
          className="text-sm font-semibold text-slate-500 hover:text-blue-600 lg:hidden"
          onClick={() => setExpanded(true)}
        >
          Notes
        </button>
        <span
          className="hidden max-h-[200px] cursor-pointer select-none text-[10px] font-semibold uppercase tracking-widest text-slate-400 [writing-mode:vertical-rl] lg:mt-4 lg:flex"
          onClick={() => setExpanded(true)}
        >
          Notes
        </span>
      </aside>
    )
  }

  /* ── Expanded state ── */
  return (
    <aside
      className={cn(
        "flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 shadow-sm transition-[width] duration-200 ease-out",
        "lg:min-h-[min(70vh,720px)] lg:w-[min(100%,420px)] lg:max-w-[440px]",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-slate-200/80 bg-white px-4 py-3.5 rounded-t-2xl">
        <div className="flex min-w-0 items-start gap-2.5">
          <StickyNote className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
          <div>
            <h2 className="text-sm font-bold leading-tight text-slate-800">
              Line Notes
            </h2>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {trackingItemId == null
                ? "Select a row, then Notes in Actions."
                : residentLabel
                  ? `${residentLabel} · #${trackingItemId}`
                  : `Tracking #${trackingItemId}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          title="Collapse notes panel"
          className="shrink-0 rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          onClick={() => setExpanded(false)}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        {trackingItemId == null ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No line selected. Use the{" "}
            <span className="font-semibold text-slate-600">Notes</span> button
            in the row Actions.
          </p>
        ) : (
          <>
            {/* Add note */}
            <div className="mb-4 shrink-0 space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Add a note
              </label>
              <textarea
                className="min-h-[72px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm placeholder:text-slate-300 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
                placeholder="Type a detailed case note..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-lg bg-blue-600 px-4 text-xs font-semibold hover:bg-blue-700"
                  disabled={saving || !draft.trim()}
                  onClick={() => void addNote()}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Add note"
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <p className="mb-2 shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600" role="alert">
                {error}
              </p>
            )}

            {/* Notes list */}
            <div className="flex min-h-0 flex-1 flex-col">
              <h3 className="mb-2 shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                History ({notes.length})
              </h3>
              {loading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading notes...
                </div>
              ) : notes.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">
                  No notes yet.
                </p>
              ) : (
                <ul className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                  {notes.map((n) => {
                    const isEditing = editingNoteId === n.noteId
                    const isDeleting = deletingNoteId === n.noteId
                    const isConfirmingDelete = deleteConfirm === n.noteId

                    return (
                      <li
                        key={n.noteId}
                        className={cn(
                          "group rounded-xl border bg-white p-3.5 text-sm shadow-sm transition-colors",
                          isEditing
                            ? "border-blue-200 ring-1 ring-blue-100"
                            : isConfirmingDelete
                              ? "border-red-200 bg-red-50/50"
                              : n.isHighlighted
                                ? "border-amber-200 bg-amber-50/90 ring-1 ring-amber-200/80 hover:border-amber-300"
                                : "border-slate-100 hover:border-slate-200",
                          n.isPinned && !isEditing && !isConfirmingDelete
                            ? "border-l-4 border-l-amber-500 pl-3"
                            : ""
                        )}
                      >
                        {/* Meta row */}
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">
                              {n.noteType}
                            </span>
                            <span>
                              {new Date(n.createdAt).toLocaleString(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                            {n.createdBy && (
                              <span className="text-slate-400">
                                · {n.createdBy}
                              </span>
                            )}
                          </div>

                          {/* Action buttons (visible on hover or when active) */}
                          {!isEditing && !isConfirmingDelete && (
                            <div className="flex items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                              <button
                                type="button"
                                title={
                                  n.isPinned ? "Unpin from top" : "Pin to top"
                                }
                                disabled={phBusy !== null}
                                className={cn(
                                  "rounded-lg p-1.5 transition-colors",
                                  n.isPinned
                                    ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                                    : "text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                                )}
                                onClick={() => void togglePinned(n)}
                              >
                                {phBusy?.noteId === n.noteId &&
                                phBusy.kind === "pin" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Pin
                                    className={cn(
                                      "h-3.5 w-3.5",
                                      n.isPinned && "fill-current"
                                    )}
                                  />
                                )}
                              </button>
                              <button
                                type="button"
                                title={
                                  n.isHighlighted
                                    ? "Remove highlight"
                                    : "Highlight note"
                                }
                                disabled={phBusy !== null}
                                className={cn(
                                  "rounded-lg p-1.5 transition-colors",
                                  n.isHighlighted
                                    ? "bg-amber-200 text-amber-900 hover:bg-amber-300"
                                    : "text-slate-400 hover:bg-amber-50 hover:text-amber-700"
                                )}
                                onClick={() => void toggleHighlighted(n)}
                              >
                                {phBusy?.noteId === n.noteId &&
                                phBusy.kind === "hl" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Highlighter className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                title="Edit note"
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                                onClick={() => startEdit(n)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Delete note"
                                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                                onClick={() => setDeleteConfirm(n.noteId)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Edit mode */}
                        {isEditing ? (
                          <div className="space-y-2">
                            <textarea
                              className="min-h-[60px] w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-200/50"
                              value={editBody}
                              onChange={(e) => setEditBody(e.target.value)}
                              disabled={editSaving}
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50"
                                onClick={cancelEdit}
                                disabled={editSaving}
                              >
                                <X className="h-3 w-3" />
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
                                disabled={editSaving || !editBody.trim()}
                                onClick={() => void saveEdit(n.noteId)}
                              >
                                {editSaving ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Check className="h-3 w-3" />
                                )}
                                Save
                              </button>
                            </div>
                          </div>
                        ) : isConfirmingDelete ? (
                          /* Delete confirmation */
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-red-600">
                              Delete this note? This cannot be undone.
                            </p>
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-50"
                                onClick={() => setDeleteConfirm(null)}
                                disabled={isDeleting}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                                disabled={isDeleting}
                                onClick={() => void deleteNote(n.noteId)}
                              >
                                {isDeleting ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Display mode */
                          <p className="whitespace-pre-wrap text-slate-700">
                            {n.body}
                          </p>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
