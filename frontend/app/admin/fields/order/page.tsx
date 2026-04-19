"use client"

import { apiDelete, apiGet, apiPut } from "@/services/api"
import Link from "next/link"
import { useEffect, useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Loader2, ArrowLeft, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"

const DEFAULT_COMPANY_ID = Number(
  process.env.NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID ?? "1"
)

type FieldOrderItem = {
  fieldMetadataId: number
  fieldName: string
  displayName: string
  displayOrder: number
}

function SortableFieldRow({
  item,
  index,
}: {
  item: FieldOrderItem
  index: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.fieldMetadataId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-md hover:bg-gray-50"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600"
      >
        ⠿
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 truncate">
          {item.displayName}
        </div>
        <div className="text-xs text-gray-500">{item.fieldName}</div>
      </div>
      <div className="text-sm font-semibold text-gray-600 flex-shrink-0">
        {index + 1}
      </div>
    </div>
  )
}

export default function FieldOrderPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState<FieldOrderItem[]>([])
  const [viewTypes, setViewTypes] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState("global")

  const sensors = useSensors(
    useSensor(PointerSensor, {
      distance: 8,
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Load view types on mount
  useEffect(() => {
    async function fetchViewTypes() {
      try {
        const res = await apiGet(
          `/api/pending-tracking/view-types?companyId=${DEFAULT_COMPANY_ID}`
        )
        if (!res.ok) throw new Error("Failed to fetch view types")
        const data = (await res.json()) as { tabs?: Array<{ viewType: string; label: string }> }
        const viewTypeList = Array.isArray(data.tabs)
          ? data.tabs.map((tab) => tab.viewType)
          : []
        setViewTypes(viewTypeList)
      } catch (error) {
        console.error("Error loading view types:", error)
        setViewTypes([])
        toast.error("Failed to load view types")
      }
    }
    fetchViewTypes()
  }, [])

  // Load fields whenever tab changes
  useEffect(() => {
    async function fetchFields() {
      setLoading(true)
      try {
        const vt = activeTab === "global" ? "" : activeTab
        const res = await apiGet(
          `/api/admin/field-order?companyId=${DEFAULT_COMPANY_ID}&viewType=${encodeURIComponent(vt)}`
        )
        if (!res.ok) throw new Error("Failed to fetch fields")
        const data = (await res.json()) as { fields: FieldOrderItem[] }
        setFields(data.fields)
      } catch (error) {
        console.error("Error loading fields:", error)
        toast.error("Failed to load field order")
      } finally {
        setLoading(false)
      }
    }
    fetchFields()
  }, [activeTab])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = fields.findIndex((f) => f.fieldMetadataId === active.id)
      const newIndex = fields.findIndex((f) => f.fieldMetadataId === over.id)

      if (oldIndex !== -1 && newIndex !== -1) {
        setFields(arrayMove(fields, oldIndex, newIndex))
      }
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const vt = activeTab === "global" ? null : activeTab
      const payload = {
        companyId: DEFAULT_COMPANY_ID,
        viewType: vt,
        fields: fields.map((f, idx) => ({
          fieldMetadataId: f.fieldMetadataId,
          displayOrder: (idx + 1) * 10, // Simple 10-increment ordering
        })),
      }

      const res = await apiPut("/api/admin/field-order", payload)

      if (!res.ok) throw new Error("Failed to save")

      toast.success(
        activeTab === "global"
          ? "Global field order saved"
          : `${activeTab} field order saved`
      )
    } catch (error) {
      console.error("Error saving:", error)
      toast.error("Failed to save field order")
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (activeTab === "global") {
      toast.error("Cannot reset global order")
      return
    }

    setSaving(true)
    try {
      const res = await apiDelete(
        `/api/admin/field-order?companyId=${DEFAULT_COMPANY_ID}&viewType=${encodeURIComponent(activeTab)}`
      )

      if (!res.ok) throw new Error("Failed to reset")

      toast.success(`${activeTab} field order reset to global`)
      // Reload fields for this tab
      const fetchRes = await apiGet(
        `/api/admin/field-order?companyId=${DEFAULT_COMPANY_ID}&viewType=${encodeURIComponent(activeTab)}`
      )
      const data = (await fetchRes.json()) as { fields: FieldOrderItem[] }
      setFields(data.fields)
    } catch (error) {
      console.error("Error resetting:", error)
      toast.error("Failed to reset field order")
    } finally {
      setSaving(false)
    }
  }

  const allTabs = ["global", ...(Array.isArray(viewTypes) ? viewTypes : [])]

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-6 py-4 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/admin/fields"
            className="text-blue-600 hover:text-blue-800 flex items-center gap-2 text-sm font-medium"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Fields
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Field Order</h1>
          <div className="w-32" />
        </div>
      </div>

      {/* Tabs for Global / ViewTypes */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1">
        <div className="px-6 py-3 bg-white border-b border-gray-200">
          <TabsList className="bg-gray-100">
            {allTabs.map((tab) => (
              <TabsTrigger key={tab} value={tab} className="capitalize">
                {tab === "global" ? "Global (default)" : tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : fields.length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            No active fields found
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={fields.map((f) => f.fieldMetadataId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2 max-w-2xl">
                {fields.map((field, idx) => (
                  <SortableFieldRow
                    key={field.fieldMetadataId}
                    item={field}
                    index={idx}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        </div>

        {/* Footer - Action buttons */}
        <div className="px-6 py-4 bg-white border-t border-gray-200 flex gap-3 justify-end">
          {activeTab !== "global" && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={saving || loading}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Reset to Global
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={saving || loading}
            className="gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving..." : "Save Order"}
          </Button>
        </div>
      </Tabs>
    </div>
  )
}
