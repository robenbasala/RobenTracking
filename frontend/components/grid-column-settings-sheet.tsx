"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { GridColumnMeta } from "@/lib/pending-tracking/types"
import {
  clearGridColumnPrefs,
  loadGridColumnPrefs,
  saveGridColumnPrefs,
} from "@/lib/pending-tracking/grid-column-preferences"
import { cn } from "@/lib/utils"

type DraftRow = {
  id: string
  title: string
  visible: boolean
}

function buildDraft(
  columns: GridColumnMeta[],
  companyId: number,
  viewType: string
): DraftRow[] {
  const base = [...columns].sort((a, b) => a.order - b.order)
  const prefs = loadGridColumnPrefs(companyId, viewType)
  if (!prefs?.orderedVisibleKeys?.length) {
    return base.map((c) => ({
      id: c.key,
      title: c.title,
      visible: true,
    }))
  }
  const vis = new Set(prefs.orderedVisibleKeys.map((k) => k.toLowerCase()))
  const top: DraftRow[] = []
  for (const k of prefs.orderedVisibleKeys) {
    const c = base.find((x) => x.key.toLowerCase() === k.trim().toLowerCase())
    if (c) top.push({ id: c.key, title: c.title, visible: true })
  }
  const rest: DraftRow[] = []
  for (const c of base) {
    if (!vis.has(c.key.toLowerCase())) {
      rest.push({ id: c.key, title: c.title, visible: false })
    }
  }
  return [...top, ...rest]
}

function SortableColumnRow({
  row,
  onVisibleChange,
}: {
  row: DraftRow
  onVisibleChange: (id: string, visible: boolean) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/40",
        isDragging && "z-10 opacity-80 shadow-md"
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing dark:hover:bg-slate-800"
        aria-label="Reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Checkbox
        id={`col-vis-${row.id}`}
        checked={row.visible}
        onCheckedChange={(v) => onVisibleChange(row.id, v === true)}
        className="shrink-0"
      />
      <label
        htmlFor={`col-vis-${row.id}`}
        className="min-w-0 flex-1 cursor-pointer text-sm font-medium text-slate-800 dark:text-slate-100"
      >
        <span className="block truncate">{row.title}</span>
        <span className="block truncate text-xs font-normal text-slate-500">
          {row.id}
        </span>
      </label>
    </div>
  )
}

export function GridColumnSettingsSheet({
  open,
  onOpenChange,
  companyId,
  viewType,
  columns,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: number
  viewType: string
  columns: GridColumnMeta[]
  onApplied?: () => void
}) {
  const [draft, setDraft] = useState<DraftRow[]>([])

  useEffect(() => {
    if (!open || columns.length === 0) return
    setDraft(buildDraft(columns, companyId, viewType))
  }, [open, columns, companyId, viewType])

  const sensors = useSensors(
    useSensor(PointerSensor, { distance: 6 }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const ids = useMemo(() => draft.map((d) => d.id), [draft])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraft((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id)
      const newIndex = prev.findIndex((r) => r.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }, [])

  const setVisible = useCallback((id: string, visible: boolean) => {
    setDraft((prev) =>
      prev.map((r) => (r.id === id ? { ...r, visible } : r))
    )
  }, [])

  const handleSave = useCallback(() => {
    const visibleKeys = draft.filter((d) => d.visible).map((d) => d.id)
    if (visibleKeys.length === 0) {
      toast.error("Keep at least one column visible.")
      return
    }
    saveGridColumnPrefs(companyId, viewType, visibleKeys)
    toast.success("Column layout saved for this tab.")
    onOpenChange(false)
    onApplied?.()
  }, [draft, companyId, viewType, onOpenChange, onApplied])

  const handleReset = useCallback(() => {
    clearGridColumnPrefs(companyId, viewType)
    setDraft(
      [...columns]
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ id: c.key, title: c.title, visible: true }))
    )
    toast.success("Reset to default columns.")
    onApplied?.()
  }, [columns, companyId, viewType, onApplied])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden sm:max-w-md">
        <SheetHeader className="text-left">
          <SheetTitle>Grid columns</SheetTitle>
          <SheetDescription>
            Choose visible columns and drag to reorder. Saved per program tab
            on this browser.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {draft.length === 0 ? (
            <p className="text-sm text-slate-500">No columns to configure.</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2 pr-1">
                  {draft.map((row) => (
                    <SortableColumnRow
                      key={row.id}
                      row={row}
                      onVisibleChange={setVisible}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
        <SheetFooter className="flex-col gap-2 border-t border-slate-200 pt-4 sm:flex-col">
          <div className="flex w-full gap-2">
            <Button type="button" className="flex-1" onClick={handleSave}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-slate-600"
            onClick={handleReset}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset to default
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
