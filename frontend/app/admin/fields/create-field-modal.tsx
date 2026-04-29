"use client"

import { apiGet, apiPost } from "@/services/api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type {
  CalculationType,
  ComparisonOperator,
  FieldDataType,
  FieldKind,
  FormulaDefinition,
  FormulaOperand,
} from "@/types/field-formula"
import { X } from "lucide-react"
import { useEffect, useState } from "react"

export type ExistingFieldRef = { fieldName: string; dataType: string }

type TrackingColumnRow = {
  columnName: string
  sqlDataType: string
  suggestedDataType: string
  hasFieldMetadata: boolean
}

const COMPARISON_OPTIONS: { value: ComparisonOperator; label: string }[] = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not equals" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
  { value: "greater_than_or_equal", label: "≥" },
  { value: "less_than_or_equal", label: "≤" },
  { value: "contains", label: "Contains" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
]

function OperandRow({
  label,
  op,
  onChange,
  fields,
  numericConstants,
}: {
  label: string
  op: { sourceType: "field" | "constant"; fieldCode: string; constant: string }
  onChange: (next: typeof op) => void
  fields: ExistingFieldRef[]
  numericConstants?: boolean
}) {
  return (
    <div className="border-input bg-muted/15 space-y-2 rounded-md border p-2">
      <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-wide">
        {label}
      </p>
      <select
        className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
        value={op.sourceType}
        onChange={(e) =>
          onChange({
            ...op,
            sourceType: e.target.value as "field" | "constant",
          })
        }
      >
        <option value="field">Source field</option>
        <option value="constant">Constant</option>
      </select>
      {op.sourceType === "field" ? (
        <select
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
          value={op.fieldCode}
          onChange={(e) => onChange({ ...op, fieldCode: e.target.value })}
        >
          <option value="">Select field…</option>
          {fields.map((f) => (
            <option key={f.fieldName} value={f.fieldName}>
              {f.fieldName} ({f.dataType})
            </option>
          ))}
        </select>
      ) : (
        <input
          type={numericConstants ? "number" : "text"}
          className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-xs"
          value={op.constant}
          onChange={(e) => onChange({ ...op, constant: e.target.value })}
          placeholder={numericConstants ? "Number" : "Value"}
        />
      )}
    </div>
  )
}

function toFormulaOperand(
  op: { sourceType: "field" | "constant"; fieldCode: string; constant: string },
  numeric?: boolean
): FormulaOperand {
  if (op.sourceType === "field") {
    return {
      sourceType: "field",
      fieldCode: op.fieldCode.trim() || undefined,
    }
  }
  const s = op.constant.trim()
  if (numeric) {
    const n = Number(s)
    return {
      sourceType: "constant",
      constantValue: s === "" ? null : Number.isFinite(n) ? n : null,
    }
  }
  if (s === "true") return { sourceType: "constant", constantValue: true }
  if (s === "false") return { sourceType: "constant", constantValue: false }
  return { sourceType: "constant", constantValue: s || null }
}

export function CreateFieldModal({
  companyId,
  datasetId,
  viewTypeOptions,
  existingFields,
  onClose,
  onCreated,
}: {
  companyId: number
  datasetId: string
  viewTypeOptions: string[]
  existingFields: ExistingFieldRef[]
  onClose: () => void
  onCreated: () => void
}) {
  const [fieldName, setFieldName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [dataType, setDataType] = useState("text")
  const [screenLocation, setScreenLocation] = useState<
    "Main" | "Detail" | "Both"
  >("Main")
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
  const [createOptions, setCreateOptions] = useState<
    Array<{ value: string; label: string; order: number }>
  >([])
  const [newCreateOptValue, setNewCreateOptValue] = useState("")
  const [newCreateOptLabel, setNewCreateOptLabel] = useState("")
  const [newCreateOptOrder, setNewCreateOptOrder] = useState(0)

  const [fieldKind, setFieldKind] = useState<FieldKind>("regular")
  const [storageMode, setStorageMode] = useState<"custom" | "baseTable">(
    "custom"
  )
  const [trackingColumns, setTrackingColumns] = useState<TrackingColumnRow[]>(
    []
  )
  const [columnsLoading, setColumnsLoading] = useState(false)
  const [columnsErr, setColumnsErr] = useState<string | null>(null)
  const [selectedBaseColumn, setSelectedBaseColumn] = useState("")
  const [isSystemField, setIsSystemField] = useState(false)
  const [perViewOrder, setPerViewOrder] = useState<Record<string, number>>({})
  const [calcType, setCalcType] = useState<CalculationType>("date_arithmetic")
  const [dateSource, setDateSource] = useState("")
  const [dateOp, setDateOp] = useState<"add_days" | "subtract_days">("add_days")
  const [days, setDays] = useState(0)
  const [numLeft, setNumLeft] = useState({
    sourceType: "field" as const,
    fieldCode: "",
    constant: "",
  })
  const [numOp, setNumOp] = useState<
    "add" | "subtract" | "multiply" | "divide"
  >("add")
  const [numRight, setNumRight] = useState({
    sourceType: "field" as const,
    fieldCode: "",
    constant: "",
  })
  const [condLeft, setCondLeft] = useState({
    sourceType: "field" as const,
    fieldCode: "",
    constant: "",
  })
  const [condComp, setCondComp] = useState<ComparisonOperator>("equals")
  const [condRight, setCondRight] = useState({
    sourceType: "field" as const,
    fieldCode: "",
    constant: "",
  })
  const [condTrue, setCondTrue] = useState({
    sourceType: "constant" as const,
    fieldCode: "",
    constant: "",
  })
  const [condFalse, setCondFalse] = useState({
    sourceType: "constant" as const,
    fieldCode: "",
    constant: "",
  })
  const [resultDataType, setResultDataType] = useState<FieldDataType>("text")

  const dateFieldOptions = existingFields.filter((f) => f.dataType === "date")
  const numericFieldOptions = existingFields.filter((f) =>
    ["number", "currency", "float", "int", "decimal"].includes(f.dataType)
  )

  function toggleCreateViewType(vt: string) {
    setCreateViewTypes((prev) => {
      const next = new Set(prev)
      if (next.has(vt)) {
        next.delete(vt)
        setPerViewOrder((po) => {
          const { [vt]: _removed, ...rest } = po
          return rest
        })
      } else {
        next.add(vt)
        setPerViewOrder((po) => ({
          ...po,
          [vt]: po[vt] ?? displayOrder,
        }))
      }
      return next
    })
  }

  useEffect(() => {
    if (fieldKind !== "regular" || storageMode !== "baseTable") return
    let cancelled = false
    setColumnsLoading(true)
    setColumnsErr(null)
    void (async () => {
      try {
        const res = await apiGet(
          `/api/admin/field-metadata/tracking-columns?companyId=${companyId}&datasetId=${encodeURIComponent(datasetId)}`
        )
        const data = (await res.json()) as {
          columns?: TrackingColumnRow[]
          error?: string
        }
        if (!res.ok) throw new Error(data.error ?? "Failed to load columns")
        if (!cancelled) {
          setTrackingColumns(data.columns ?? [])
        }
      } catch (e) {
        if (!cancelled) {
          setColumnsErr(e instanceof Error ? e.message : "Load error")
          setTrackingColumns([])
        }
      } finally {
        if (!cancelled) setColumnsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId, datasetId, fieldKind, storageMode])

  function onSelectBaseColumn(columnName: string) {
    setSelectedBaseColumn(columnName)
    const row = trackingColumns.find((c) => c.columnName === columnName)
    if (row) {
      setFieldName(row.columnName)
      setDataType(row.suggestedDataType)
    }
  }

  function addCreateOption() {
    if (!newCreateOptValue.trim()) return
    setCreateOptions((prev) => [
      ...prev,
      {
        value: newCreateOptValue.trim(),
        label: newCreateOptLabel.trim() || newCreateOptValue.trim(),
        order: newCreateOptOrder,
      },
    ])
    setNewCreateOptValue("")
    setNewCreateOptLabel("")
    setNewCreateOptOrder(createOptions.length)
  }

  function deleteCreateOption(idx: number) {
    setCreateOptions((prev) => prev.filter((_, i) => i !== idx))
  }

  function buildFormula(): FormulaDefinition | null {
    if (fieldKind !== "calculated") return null
    if (calcType === "date_arithmetic") {
      if (!dateSource.trim()) return null
      return {
        calculationType: "date_arithmetic",
        sourceFieldCode: dateSource.trim(),
        operator: dateOp,
        days: Math.trunc(Number(days)) || 0,
      }
    }
    if (calcType === "number_arithmetic") {
      return {
        calculationType: "number_arithmetic",
        leftOperand: toFormulaOperand(numLeft, true),
        operator: numOp,
        rightOperand: toFormulaOperand(numRight, true),
      }
    }
    const needRight = !["is_empty", "is_not_empty"].includes(condComp)
    const numCoerce = resultDataType === "numeric"
    const base = {
      calculationType: "conditional" as const,
      leftOperand: toFormulaOperand(condLeft),
      comparisonOperator: condComp,
      trueResult: toFormulaOperand(condTrue, numCoerce),
      falseResult: toFormulaOperand(condFalse, numCoerce),
      resultDataType,
    }
    if (needRight) {
      return {
        ...base,
        rightOperand: toFormulaOperand(condRight),
      }
    }
    return base
  }

  function validateCalculated(): string | null {
    const f = buildFormula()
    if (!f) return "Complete the calculation configuration."
    if (f.calculationType === "date_arithmetic") {
      if (!f.sourceFieldCode) return "Select a source date field."
    }
    if (f.calculationType === "number_arithmetic") {
      const L = f.leftOperand
      const R = f.rightOperand
      const lOk =
        L.sourceType === "field"
          ? L.fieldCode?.trim()
          : L.constantValue !== null && L.constantValue !== undefined && L.constantValue !== ""
      const rOk =
        R.sourceType === "field"
          ? R.fieldCode?.trim()
          : R.constantValue !== null && R.constantValue !== undefined && R.constantValue !== ""
      if (!lOk || !rOk) return "Number arithmetic needs both operands filled."
    }
    if (f.calculationType === "conditional") {
      const leftOk =
        f.leftOperand.sourceType === "field"
          ? f.leftOperand.fieldCode?.trim()
          : f.leftOperand.constantValue !== null &&
            f.leftOperand.constantValue !== undefined &&
            f.leftOperand.constantValue !== ""
      if (!leftOk) return "Conditional: complete the left side."
      if (!["is_empty", "is_not_empty"].includes(f.comparisonOperator)) {
        if (!f.rightOperand) return "Conditional: add a right operand."
        const rOk =
          f.rightOperand.sourceType === "field"
            ? f.rightOperand.fieldCode?.trim()
            : f.rightOperand.constantValue !== null &&
              f.rightOperand.constantValue !== undefined &&
              f.rightOperand.constantValue !== ""
        if (!rOk) return "Conditional: complete the right side."
      }
    }
    return null
  }

  async function submit() {
    setErr(null)
    const fn = fieldName.trim()
    const dn = displayName.trim()
    if (fieldKind === "regular" && storageMode === "baseTable") {
      if (!selectedBaseColumn.trim()) {
        setErr("Select a TrackingItemsTbl column.")
        return
      }
      const sel = trackingColumns.find(
        (c) => c.columnName === selectedBaseColumn
      )
      if (sel?.hasFieldMetadata) {
        setErr("This column already has field metadata for this company.")
        return
      }
    }
    if (!fn || !dn) {
      setErr("Field name and display name are required.")
      return
    }
    if (fieldKind === "calculated") {
      const v = validateCalculated()
      if (v) {
        setErr(v)
        return
      }
    }
    const states = statesCsv
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s) => s.length === 2)
    const viewTypes = Array.from(createViewTypes)
    const viewOrders = viewTypes.map((vt) => ({
      viewType: vt,
      displayOrder: perViewOrder[vt] ?? displayOrder,
    }))
    const doNum = Number(displayOrder)
    const formulaDefinition = buildFormula()
    const effectiveRequired = fieldKind === "calculated" ? false : isRequired
    const effectiveEditable = fieldKind === "calculated" ? false : isEditable
    let effectiveDataType = dataType
    if (fieldKind === "calculated" && formulaDefinition) {
      if (formulaDefinition.calculationType === "date_arithmetic")
        effectiveDataType = "date"
      else if (formulaDefinition.calculationType === "number_arithmetic")
        effectiveDataType = "number"
      else {
        const m: Record<FieldDataType, string> = {
          text: "text",
          numeric: "number",
          date: "date",
          boolean: "boolean",
        }
        effectiveDataType = m[formulaDefinition.resultDataType] ?? "text"
      }
    }
    setSaving(true)
    try {
      const res = await apiPost("/api/admin/field-metadata", {
        companyId,
        datasetId,
        fieldName: fn,
        displayName: dn,
        dataType: effectiveDataType,
        screenLocation,
        displayOrder: Number.isFinite(doNum) ? doNum : 0,
        isActive,
        isRequired: effectiveRequired,
        isEditable: effectiveEditable,
        viewTypes,
        states,
        viewOrders,
        ...(fieldKind === "regular" && storageMode === "baseTable"
          ? {
              sourceType: "BaseTable" as const,
              sourceColumnName: selectedBaseColumn.trim(),
              isSystemField,
            }
          : fieldKind === "regular"
            ? { sourceType: "Custom" as const }
            : {}),
        fieldKind,
        ...(fieldKind === "calculated" && formulaDefinition
          ? { formulaDefinition }
          : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Create failed")
      const fieldMetadataId = data.fieldMetadataId

      if (
        fieldKind === "regular" &&
        dataType === "dropdown" &&
        createOptions.length > 0 &&
        fieldMetadataId
      ) {
        for (const opt of createOptions) {
          await apiPost(`/api/admin/field-metadata/${fieldMetadataId}/options`, {
            datasetId,
            optionValue: opt.value,
            optionLabel: opt.label !== opt.value ? opt.label : null,
            displayOrder: opt.order,
          })
        }
      }
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error")
    } finally {
      setSaving(false)
    }
  }

  const isCalculated = fieldKind === "calculated"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="bg-surface-container-lowest flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border shadow-lg"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">Add new field</h2>
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg p-2 transition-colors"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {err && <p className="text-destructive mb-2 text-sm">{err}</p>}
        <div className="space-y-3">
          <label className="text-muted-foreground block text-xs font-medium">
            Field kind
            <select
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
              value={fieldKind}
              onChange={(e) => {
                const v = e.target.value as FieldKind
                setFieldKind(v)
                if (v === "calculated") {
                  setStorageMode("custom")
                  setSelectedBaseColumn("")
                }
              }}
            >
              <option value="regular">Regular</option>
              <option value="calculated">Calculated</option>
            </select>
          </label>
          {!isCalculated && (
            <label className="text-muted-foreground block text-xs font-medium">
              Backing storage
              <select
                className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                value={storageMode}
                onChange={(e) => {
                  const m = e.target.value as "custom" | "baseTable"
                  setStorageMode(m)
                  if (m === "custom") {
                    setSelectedBaseColumn("")
                  }
                }}
              >
                <option value="custom">Custom (virtual column)</option>
                <option value="baseTable">TrackingItemsTbl column</option>
              </select>
            </label>
          )}
          {!isCalculated && storageMode === "baseTable" && (
            <div className="border-input bg-muted/15 space-y-2 rounded-lg border p-3">
              {columnsLoading && (
                <p className="text-muted-foreground text-xs">
                  Loading table columns…
                </p>
              )}
              {columnsErr && (
                <p className="text-destructive text-xs">{columnsErr}</p>
              )}
              <label className="text-muted-foreground block text-xs font-medium">
                Physical column
                <select
                  className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={selectedBaseColumn}
                  onChange={(e) => onSelectBaseColumn(e.target.value)}
                >
                  <option value="">Select column…</option>
                  {trackingColumns.map((c) => (
                    <option
                      key={c.columnName}
                      value={c.columnName}
                      disabled={c.hasFieldMetadata}
                    >
                      {c.columnName} ({c.sqlDataType})
                      {c.hasFieldMetadata ? " — already mapped" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isSystemField}
                  onChange={(e) => setIsSystemField(e.target.checked)}
                />
                System field
              </label>
              <p className="text-muted-foreground text-[11px] leading-snug">
                Field name is taken from the column name. Add display metadata,
                views, and states below.
              </p>
            </div>
          )}
          <label className="text-muted-foreground block text-xs font-medium">
            Field name (code)
            <input
              className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm disabled:opacity-60"
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              disabled={!isCalculated && storageMode === "baseTable"}
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
          <label
            className={`text-muted-foreground block text-xs font-medium ${isCalculated ? "opacity-70" : ""}`}
          >
            Data type
            {isCalculated ? (
              <p className="border-input bg-muted/30 mt-1 rounded-md border px-3 py-2 text-sm">
                Derived from calculation (
                {calcType === "date_arithmetic"
                  ? "date"
                  : calcType === "number_arithmetic"
                    ? "number"
                    : resultDataType}
                )
              </p>
            ) : (
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
            )}
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
            <label
              className={`flex items-center gap-2 text-sm ${isCalculated ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                checked={isRequired}
                disabled={isCalculated}
                onChange={(e) => setIsRequired(e.target.checked)}
              />
              Required
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${isCalculated ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <input
                type="checkbox"
                checked={isEditable}
                disabled={isCalculated}
                onChange={(e) => setIsEditable(e.target.checked)}
              />
              Editable
            </label>
          </div>
          {isCalculated && (
            <div className="border-input bg-muted/20 space-y-3 rounded-lg border p-3">
              <p className="text-sm font-semibold">Calculation configuration</p>
              <label className="text-muted-foreground block text-xs font-medium">
                Calculation type
                <select
                  className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={calcType}
                  onChange={(e) =>
                    setCalcType(e.target.value as CalculationType)
                  }
                >
                  <option value="date_arithmetic">Date arithmetic</option>
                  <option value="number_arithmetic">Number arithmetic</option>
                  <option value="conditional">Conditional (IF)</option>
                </select>
              </label>
              {calcType === "date_arithmetic" && (
                <div className="space-y-2">
                  <label className="text-muted-foreground block text-xs font-medium">
                    Source date field
                    <select
                      className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                      value={dateSource}
                      onChange={(e) => setDateSource(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {dateFieldOptions.map((f) => (
                        <option key={f.fieldName} value={f.fieldName}>
                          {f.fieldName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-muted-foreground block text-xs font-medium">
                    Operation
                    <select
                      className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                      value={dateOp}
                      onChange={(e) =>
                        setDateOp(e.target.value as "add_days" | "subtract_days")
                      }
                    >
                      <option value="add_days">Add days</option>
                      <option value="subtract_days">Subtract days</option>
                    </select>
                  </label>
                  <label className="text-muted-foreground block text-xs font-medium">
                    Days
                    <input
                      type="number"
                      className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </label>
                </div>
              )}
              {calcType === "number_arithmetic" && (
                <div className="space-y-2">
                  <OperandRow
                    label="Left operand"
                    op={numLeft}
                    onChange={setNumLeft}
                    fields={numericFieldOptions.length > 0 ? numericFieldOptions : existingFields}
                    numericConstants
                  />
                  <label className="text-muted-foreground block text-xs font-medium">
                    Operator
                    <select
                      className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                      value={numOp}
                      onChange={(e) =>
                        setNumOp(
                          e.target.value as
                            | "add"
                            | "subtract"
                            | "multiply"
                            | "divide"
                        )
                      }
                    >
                      <option value="add">Add</option>
                      <option value="subtract">Subtract</option>
                      <option value="multiply">Multiply</option>
                      <option value="divide">Divide</option>
                    </select>
                  </label>
                  <OperandRow
                    label="Right operand"
                    op={numRight}
                    onChange={setNumRight}
                    fields={numericFieldOptions.length > 0 ? numericFieldOptions : existingFields}
                    numericConstants
                  />
                </div>
              )}
              {calcType === "conditional" && (
                <div className="space-y-2">
                  <OperandRow
                    label="Condition — left"
                    op={condLeft}
                    onChange={setCondLeft}
                    fields={existingFields}
                  />
                  <label className="text-muted-foreground block text-xs font-medium">
                    Comparison
                    <select
                      className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                      value={condComp}
                      onChange={(e) =>
                        setCondComp(e.target.value as ComparisonOperator)
                      }
                    >
                      {COMPARISON_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!["is_empty", "is_not_empty"].includes(condComp) && (
                    <OperandRow
                      label="Condition — right"
                      op={condRight}
                      onChange={setCondRight}
                      fields={existingFields}
                    />
                  )}
                  <label className="text-muted-foreground block text-xs font-medium">
                    Result value type
                    <select
                      className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
                      value={resultDataType}
                      onChange={(e) =>
                        setResultDataType(e.target.value as FieldDataType)
                      }
                    >
                      <option value="text">Text</option>
                      <option value="numeric">Numeric</option>
                      <option value="date">Date</option>
                      <option value="boolean">Boolean</option>
                    </select>
                  </label>
                  <OperandRow
                    label="When true"
                    op={condTrue}
                    onChange={setCondTrue}
                    fields={existingFields}
                    numericConstants={resultDataType === "numeric"}
                  />
                  <OperandRow
                    label="When false"
                    op={condFalse}
                    onChange={setCondFalse}
                    fields={existingFields}
                    numericConstants={resultDataType === "numeric"}
                  />
                </div>
              )}
            </div>
          )}
          <div>
            <p className="text-muted-foreground text-xs font-medium">
              View type (TrackingItemsTbl.ViewType)
            </p>
            <p className="text-muted-foreground/90 mb-2 text-[11px]">
              Leave none checked to show for every view type.
            </p>
            {viewTypeOptions.length === 0 ? (
              <p className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-xs">
                No view types in TrackingItemsTbl for this company.
              </p>
            ) : (
              <div className="border-input bg-muted/20 flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                {viewTypeOptions.map((vt) => (
                  <div
                    key={vt}
                    className="flex flex-wrap items-center gap-2 text-sm leading-none"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <Checkbox
                        checked={createViewTypes.has(vt)}
                        onCheckedChange={() => toggleCreateViewType(vt)}
                      />
                      <span className="truncate">{vt}</span>
                    </label>
                    {createViewTypes.has(vt) && (
                      <label className="text-muted-foreground flex items-center gap-1 text-[11px]">
                        Order
                        <input
                          type="number"
                          className="border-input bg-background w-16 rounded-md border px-1.5 py-1 text-xs"
                          title="Display order for this view (FieldMetadataViewOrder)"
                          value={perViewOrder[vt] ?? displayOrder}
                          onChange={(e) =>
                            setPerViewOrder((po) => ({
                              ...po,
                              [vt]: Number(e.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                  </div>
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
          {!isCalculated && dataType === "dropdown" && (
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium">
                Dropdown Options
              </p>
              <div className="space-y-2">
                {createOptions.length > 0 && (
                  <div className="border-input bg-muted/10 mb-3 max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {createOptions.map((opt, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{opt.value}</span>
                          {opt.label !== opt.value && (
                            <span className="text-muted-foreground">
                              {" "}
                              / {opt.label}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteCreateOption(idx)}
                          className="text-destructive hover:bg-destructive/10 rounded px-2 py-1"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="border-input bg-muted/20 space-y-2 rounded-md border p-2">
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
                    onChange={(e) =>
                      setNewCreateOptOrder(Number(e.target.value))
                    }
                  />
                  <button
                    type="button"
                    onClick={() => addCreateOption()}
                    className="bg-primary text-on-primary hover:bg-primary/90 w-full rounded-md py-1 text-xs font-medium"
                  >
                    Add Option
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-surface-container-lowest px-6 py-4">
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
