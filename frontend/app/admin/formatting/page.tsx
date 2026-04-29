"use client"

import { apiDelete, apiGet, apiPost, apiPut } from "@/services/api"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { type ConditionNode } from "@/lib/conditional-formatting"
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

const DEFAULT_COMPANY_ID = Number(
  process.env.NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID ?? "1"
)
const DEFAULT_DATASET_ID =
  process.env.NEXT_PUBLIC_TRACKING_DEFAULT_DATASET_ID ??
  "4c41eb0d-2fea-4ed7-8de3-224dad8455c6"

type Rule = {
  id: string
  reportKey: string | null
  targetFieldKey: string | null
  applyTo: "row" | "field"
  backgroundColor: string
  textColor?: string | null
  conditionFormula: string
  conditionTree?: ConditionNode | null
  isEnabled: boolean
  sortOrder: number
}

type AdminField = {
  fieldMetadataId: number
  fieldName: string
  displayName: string
  dataType: string
}

type ReportTab = {
  viewType: string
  label: string
}

type DeleteRequest =
  | { kind: "all"; ids: string[]; title: string; description: string }
  | { kind: "group"; ids: string[]; title: string; description: string }

const SIMPLE_OPERATORS: Array<{ value: string; label: string }> = [
  { value: "eq", label: "=" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "contains", label: "contains" },
  { value: "isEmpty", label: "is blank" },
  { value: "notEmpty", label: "is not blank" },
]

function scopeLabel(scope: "field" | "row"): string {
  return scope === "row" ? "Row (entire row)" : "Field (selected column only)"
}

export default function ConditionalFormattingPage() {
  const searchParams = useSearchParams()
  const embedded = searchParams.get("embed") === "1"
  const [datasetId, setDatasetId] = useState(
    searchParams.get("datasetId")?.trim() || DEFAULT_DATASET_ID
  )
  const [rules, setRules] = useState<Rule[]>([])
  const [fields, setFields] = useState<AdminField[]>([])
  const [reportTabs, setReportTabs] = useState<ReportTab[]>([])
  const [viewTypes, setViewTypes] = useState<string[]>([])
  const [simpleFieldName, setSimpleFieldName] = useState("")
  const [simpleOperator, setSimpleOperator] = useState("eq")
  const [simpleCompareValue, setSimpleCompareValue] = useState("")
  const [targetScope, setTargetScope] = useState<"field" | "row">("row")
  const [color, setColor] = useState("#ffe082")
  const [dragRuleId, setDragRuleId] = useState<string | null>(null)
  const [dragGroupKey, setDragGroupKey] = useState<string | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [dropdownValues, setDropdownValues] = useState<Array<{ value: string; label: string }>>([])
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [formulaError, setFormulaError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [rulesRes, fieldsRes, tabsRes] = await Promise.all([
      apiGet(
        `/api/conditional-formatting?companyId=${DEFAULT_COMPANY_ID}&datasetId=${encodeURIComponent(datasetId)}`
      ),
      apiGet(
        `/api/admin/field-metadata?companyId=${DEFAULT_COMPANY_ID}&datasetId=${encodeURIComponent(datasetId)}`
      ),
      apiGet(`/api/pending-tracking/view-types?companyId=${DEFAULT_COMPANY_ID}`),
    ])
    const rulesData = (await rulesRes.json()) as { rules?: Rule[] }
    const fieldsData = (await fieldsRes.json()) as { fields?: Array<{ fieldMetadataId: number; fieldName: string; displayName: string; dataType: string }> }
    const tabsData = (await tabsRes.json()) as { tabs?: Array<{ viewType: string; label: string }> }
    setRules(rulesData.rules ?? [])
    setReportTabs((tabsData.tabs ?? []).map((t) => ({ viewType: t.viewType, label: t.label })))
    const nextFields = (fieldsData.fields ?? []).map((f) => ({
      fieldMetadataId: f.fieldMetadataId,
      fieldName: f.fieldName,
      displayName: f.displayName,
      dataType: f.dataType,
    }))
    setFields(nextFields)
    if (
      nextFields.length > 0 &&
      !nextFields.some((f) => f.fieldName === simpleFieldName)
    ) {
      setSimpleFieldName(nextFields[0].fieldName)
    }
  }, [datasetId, simpleFieldName])

  const fieldLabelByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of fields) {
      map.set(f.fieldName, f.displayName?.trim() || f.fieldName)
    }
    return map
  }, [fields])

  const selectedSimpleField = useMemo(
    () => fields.find((f) => f.fieldName === simpleFieldName) ?? null,
    [fields, simpleFieldName]
  )

  useEffect(() => {
    if (!selectedSimpleField || selectedSimpleField.dataType.toLowerCase() !== "dropdown") {
      setDropdownValues([])
      return
    }
    void (async () => {
      const res = await apiGet(
        `/api/admin/field-metadata/${selectedSimpleField.fieldMetadataId}/options?datasetId=${encodeURIComponent(datasetId)}`
      )
      const data = (await res.json()) as {
        options?: Array<{ optionValue: string; optionLabel: string | null }>
      }
      setDropdownValues(
        (data.options ?? []).map((o) => ({
          value: o.optionValue,
          label: o.optionLabel ?? o.optionValue,
        }))
      )
    })()
  }, [selectedSimpleField, datasetId])

  useEffect(() => {
    void load()
  }, [load])

  function simpleModeFormula(): string {
    const key = simpleFieldName.trim()
    if (!key) return ""
    const ref = `row[${JSON.stringify(key)}]`
    const quoted = JSON.stringify(simpleCompareValue)
    switch (simpleOperator) {
      case "eq":
        return `${ref} == ${quoted}`
      case "neq":
        return `${ref} != ${quoted}`
      case "gt":
        return `toNumber(${ref}) > toNumber(${quoted})`
      case "gte":
        return `toNumber(${ref}) >= toNumber(${quoted})`
      case "lt":
        return `toNumber(${ref}) < toNumber(${quoted})`
      case "lte":
        return `toNumber(${ref}) <= toNumber(${quoted})`
      case "contains":
        return `contains(${ref}, ${quoted})`
      case "isEmpty":
        return `isBlank(${ref})`
      case "notEmpty":
        return `isNotBlank(${ref})`
      default:
        return ""
    }
  }

  async function addRule() {
    try {
      setFormulaError(null)
      const effectiveFormula = simpleModeFormula().trim()
      if (!effectiveFormula) {
        setFormulaError("Condition Formula is required.")
        return
      }
      if (targetScope === "field" && !simpleFieldName.trim()) {
        setFormulaError("Field is required when Apply To is Field.")
        return
      }

      const targets: Array<string | null> =
        viewTypes.length > 0
          ? viewTypes
          : reportTabs.length > 0
            ? reportTabs.map((t) => t.viewType)
            : [null]
      const responses = await Promise.all(
        targets.map((target) => {
          const reportRules = rules
            .filter((r) => (r.reportKey ?? null) === (target ?? null))
            .sort((a, b) => b.sortOrder - a.sortOrder)

          const groupMaxPriority = reportRules
            .reduce((m, r) => Math.max(m, r.sortOrder), 0)

          return apiPost("/api/conditional-formatting", {
            companyId: DEFAULT_COMPANY_ID,
            datasetId,
            reportKey: target,
            targetFieldKey: targetScope === "field" ? simpleFieldName.trim() : null,
            applyTo: targetScope,
            backgroundColor: color,
            textColor: null,
            conditionFormula: effectiveFormula,
            isEnabled: true,
            sortOrder: groupMaxPriority + 1,
          })
        })
      )
      for (const res of responses) {
        if (res.ok) continue
        let message = `Failed to add rule (${res.status})`
        try {
          const data = (await res.json()) as { error?: string }
          if (data?.error) message = data.error
        } catch {
          // ignore json parse errors and keep fallback message
        }
        setFormulaError(message)
        return
      }
      setViewTypes([])
      setSimpleCompareValue("")
      await load()
    } catch (error) {
      setFormulaError(error instanceof Error ? error.message : "Failed to add rule")
    }
  }

  async function removeRule(id: string) {
    await apiDelete(
      `/api/conditional-formatting/${id}?companyId=${DEFAULT_COMPANY_ID}&datasetId=${encodeURIComponent(datasetId)}`
    )
    await load()
  }

  async function confirmDeleteRequest() {
    if (!deleteRequest) return
    setDeleting(true)
    try {
      await Promise.all(
        deleteRequest.ids.map((id) =>
          apiDelete(
            `/api/conditional-formatting/${id}?companyId=${DEFAULT_COMPANY_ID}&datasetId=${encodeURIComponent(datasetId)}`
          )
        )
      )
      setDeleteRequest(null)
      await load()
    } finally {
      setDeleting(false)
    }
  }

  function displayRuleFieldName(name: string): string {
    return fieldLabelByName.get(name) ?? name
  }

  function displayRuleReportName(reportKey: string | null): string {
    if (!reportKey) return "All reports"
    const tab = reportTabs.find((t) => t.viewType === reportKey)
    return tab?.label ?? reportKey
  }

  function formulaFieldName(formula: string): string | null {
    const bracket = /row\["([^"]+)"\]/.exec(formula)
    if (bracket?.[1]) return bracket[1]
    const dot = /row\.([A-Za-z0-9_]+)/.exec(formula)
    if (dot?.[1]) return dot[1]
    return null
  }

  const selectedReportLabels = reportTabs
    .filter((t) => viewTypes.includes(t.viewType))
    .map((t) => t.label)

  function ruleGroupKey(rule: Rule): string {
    return rule.reportKey ?? "__all__"
  }

  const groupedRules = useMemo(() => {
    const grouped = new Map<string, Rule[]>()
    for (const rule of rules) {
      const key = ruleGroupKey(rule)
      const arr = grouped.get(key) ?? []
      arr.push(rule)
      grouped.set(key, arr)
    }
    for (const arr of grouped.values()) {
      arr.sort((a, b) => b.sortOrder - a.sortOrder)
    }
    const knownKeys = reportTabs.map((t) => t.viewType)
    const keys = [...grouped.keys()].sort((a, b) => {
      if (a === "__all__") return -1
      if (b === "__all__") return 1
      const ai = knownKeys.indexOf(a)
      const bi = knownKeys.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return keys.map((key) => ({
      key,
      title: key === "__all__" ? "All reports" : displayRuleReportName(key),
      rules: grouped.get(key) ?? [],
    }))
  }, [rules, reportTabs])

  function renumberRules(list: Rule[]): Rule[] {
    const total = list.length
    return list.map((r, idx) => ({ ...r, sortOrder: total - idx }))
  }

  async function persistRuleOrder(list: Rule[]) {
    setSavingOrder(true)
    setOrderError(null)
    try {
      await Promise.all(
        list.map((r) =>
          apiPut(`/api/conditional-formatting/${r.id}`, {
            companyId: DEFAULT_COMPANY_ID,
            datasetId,
            sortOrder: r.sortOrder,
          })
        )
      )
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : "Failed to save order")
      await load()
    } finally {
      setSavingOrder(false)
    }
  }

  function reorderWithinGroup(
    allRules: Rule[],
    groupKey: string,
    movingId: string,
    targetId: string
  ): { nextAll: Rule[]; groupRules: Rule[] } | null {
    const inGroup = allRules
      .filter((r) => ruleGroupKey(r) === groupKey)
      .sort((a, b) => b.sortOrder - a.sortOrder)
    const from = inGroup.findIndex((r) => r.id === movingId)
    const to = inGroup.findIndex((r) => r.id === targetId)
    if (from < 0 || to < 0) return null
    if (from === to) return null
    const movedInGroup = [...inGroup]
    const [moved] = movedInGroup.splice(from, 1)
    movedInGroup.splice(to, 0, moved)
    const renumberedGroup = renumberRules(movedInGroup)
    const byId = new Map<string, Rule>(renumberedGroup.map((r) => [r.id, r]))
    const nextAll = allRules.map((r) => byId.get(r.id) ?? r)
    return { nextAll, groupRules: renumberedGroup }
  }

  function handleDragEnter(_targetId: string, _groupKey: string) {}

  async function handleDrop(groupKey: string, targetId?: string) {
    if (dragRuleId == null || dragGroupKey !== groupKey) return
    let nextRules = rules
    if (targetId) {
      const reordered = reorderWithinGroup(rules, groupKey, dragRuleId, targetId)
      if (reordered) nextRules = reordered.nextAll
    }
    const groupRules = nextRules
      .filter((r) => ruleGroupKey(r) === groupKey)
      .sort((a, b) => b.sortOrder - a.sortOrder)
    setRules(nextRules)
    setDragRuleId(null)
    setDragGroupKey(null)
    await persistRuleOrder(groupRules)
  }

  async function moveRule(groupKey: string, ruleId: string, direction: "up" | "down") {
    const inGroup = rules
      .filter((r) => ruleGroupKey(r) === groupKey)
      .sort((a, b) => b.sortOrder - a.sortOrder)
    const from = inGroup.findIndex((r) => r.id === ruleId)
    if (from < 0) return
    const to = direction === "up" ? from - 1 : from + 1
    if (to < 0 || to >= inGroup.length) return
    const reordered = reorderWithinGroup(rules, groupKey, ruleId, inGroup[to].id)
    if (!reordered) return
    setRules(reordered.nextAll)
    await persistRuleOrder(reordered.groupRules)
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl">
        {!embedded ? (
          <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
            <Link
              href="/admin/fields"
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Fields management
            </Link>
            <Link
              href="/admin/formatting"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Conditional formatting
            </Link>
          </div>
        ) : null}
        <h1 className="mb-4 text-2xl font-bold text-slate-900">Conditional Formatting</h1>
        {!embedded ? (
          <input
            className="mb-4 w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-mono"
            value={datasetId}
            onChange={(e) => setDatasetId(e.target.value)}
            placeholder="DatasetId"
          />
        ) : null}
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">New Rule</h2>
            <span className="text-xs text-slate-500">Smart value input by field type</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Field</div>
            <select
              className="w-full rounded-md border px-2 py-2 text-sm"
            value={simpleFieldName}
            onChange={(e) => setSimpleFieldName(e.target.value)}
            >
              <option value="">Select field...</option>
              {fields.map((f) => (
                <option key={f.fieldName} value={f.fieldName}>
                  {f.displayName || f.fieldName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Operator</div>
            <select
              className="w-full rounded-md border px-2 py-2 text-sm"
            value={simpleOperator}
            onChange={(e) => setSimpleOperator(e.target.value)}
            >
              {SIMPLE_OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Value</div>
            {simpleOperator === "isEmpty" || simpleOperator === "notEmpty" ? (
              <div className="h-10" />
            ) : simpleOperator === "contains" ? (
              <input
                className="w-full rounded-md border px-2 py-2 text-sm"
                value={simpleCompareValue}
                onChange={(e) => setSimpleCompareValue(e.target.value)}
                placeholder="Contains text..."
              />
            ) : selectedSimpleField?.dataType.toLowerCase() === "dropdown" ? (
              <select
                className="w-full rounded-md border px-2 py-2 text-sm"
                value={simpleCompareValue}
                onChange={(e) => setSimpleCompareValue(e.target.value)}
              >
                <option value="">Select option...</option>
                {dropdownValues.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : selectedSimpleField?.dataType.toLowerCase() === "date" ? (
              <input
                type="date"
                className="w-full rounded-md border px-2 py-2 text-sm"
                value={simpleCompareValue}
                onChange={(e) => setSimpleCompareValue(e.target.value)}
              />
            ) : selectedSimpleField?.dataType.toLowerCase() === "number" ||
              selectedSimpleField?.dataType.toLowerCase() === "currency" ? (
              <input
                type="number"
                className="w-full rounded-md border px-2 py-2 text-sm"
                value={simpleCompareValue}
                onChange={(e) => setSimpleCompareValue(e.target.value)}
                placeholder="Compare value"
              />
            ) : (
              <input
                className="w-full rounded-md border px-2 py-2 text-sm"
                value={simpleCompareValue}
                onChange={(e) => setSimpleCompareValue(e.target.value)}
                placeholder="Compare value"
              />
            )}
          </div>
          <div className="relative">
            <div className="mb-1 text-xs font-medium text-slate-600">Report</div>
            <button
              type="button"
              className="flex min-h-[40px] w-full items-center justify-between rounded-md border bg-white px-2 py-2 text-sm"
              onClick={() => setReportsOpen((v) => !v)}
            >
              <span className="truncate text-left">
                {selectedReportLabels.length === 0
                  ? "All reports"
                  : selectedReportLabels.join(", ")}
              </span>
              <span className="text-xs text-slate-500">{reportsOpen ? "▲" : "▼"}</span>
            </button>
            {reportsOpen ? (
              <div className="absolute left-0 top-[calc(100%+4px)] z-20 w-full rounded border border-slate-300 bg-white p-1 shadow-md">
                {reportTabs.map((tab) => {
                  const checked = viewTypes.includes(tab.viewType)
                  return (
                    <button
                      key={tab.viewType}
                      type="button"
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                      onClick={() =>
                        setViewTypes((prev) =>
                          prev.includes(tab.viewType)
                            ? prev.filter((v) => v !== tab.viewType)
                            : [...prev, tab.viewType]
                        )
                      }
                    >
                      <span className="truncate">{tab.label}</span>
                      {checked ? <Check className="h-4 w-4 text-blue-600" /> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Color</div>
            <input
              type="color"
              className="h-10 w-full cursor-pointer rounded-md border border-slate-300 p-1"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Color picker"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => void addRule()} className="h-10 w-full gap-2">
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          </div>
          </div>
          {formulaError ? <div className="mt-2 text-xs text-red-600">{formulaError}</div> : null}
          <div className="mt-3 border-t pt-3">
            <div className="mb-1 text-xs font-medium text-slate-600">Apply To</div>
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm ${targetScope === "row" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}
                onClick={() => setTargetScope("row")}
              >
                Row (entire row)
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-sm ${targetScope === "field" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"}`}
                onClick={() => setTargetScope("field")}
              >
                Field (selected column only)
              </button>
            </div>
            {targetScope === "field" ? (
              <div className="mt-2 text-xs text-slate-500">
                Target column: <span className="font-medium text-slate-700">{displayRuleFieldName(simpleFieldName || "-")}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {savingOrder ? <div className="border-b bg-blue-50 px-3 py-2 text-xs text-blue-700">Saving order...</div> : null}
          {orderError ? <div className="border-b bg-red-50 px-3 py-2 text-xs text-red-700">{orderError}</div> : null}
          {rules.length === 0 ? (
            <div className="px-3 py-6 text-center text-slate-400">No rules yet.</div>
          ) : (
            <div className="space-y-3 p-3">
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() =>
                    setDeleteRequest({
                      kind: "all",
                      ids: rules.map((r) => r.id),
                      title: "Delete all conditional rules?",
                      description: "This will remove all rules from every report.",
                    })
                  }
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete All Rules
                </Button>
              </div>
              {groupedRules.map((group) => (
              <div key={group.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <span>{group.title}</span>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                    onClick={() =>
                      setDeleteRequest({
                        kind: "group",
                        ids: group.rules.map((r) => r.id),
                        title: `Delete all rules in "${group.title}"?`,
                        description: "This will remove only this report group's rules.",
                      })
                    }
                  >
                    Delete Group
                  </button>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50/60">
                    <tr>
                      <th className="w-10 px-2 py-1.5" />
                      <th className="px-3 py-1.5">Field</th>
                      <th className="px-3 py-1.5">Condition</th>
                      <th className="px-3 py-1.5">Color</th>
                      <th className="px-3 py-1.5">Order</th>
                      <th className="px-3 py-1.5">Scope</th>
                      <th className="px-3 py-1.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rules.map((r, idx) => (
                      <tr
                        key={r.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move"
                          e.dataTransfer.setData("text/plain", r.id)
                          setDragRuleId(r.id)
                          setDragGroupKey(group.key)
                        }}
                        onDragEnd={() => {
                          setDragRuleId(null)
                          setDragGroupKey(null)
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnter={() => handleDragEnter(r.id, group.key)}
                        onDrop={() => void handleDrop(group.key, r.id)}
                        className={`border-t border-slate-100 transition-all ${dragRuleId === r.id ? "opacity-50" : ""}`}
                      >
                        <td className="px-2 py-1.5 text-slate-400"><GripVertical className="h-4 w-4" /></td>
                        <td className="px-3 py-1.5">
                          {(() => {
                            const key = r.targetFieldKey ?? formulaFieldName(r.conditionFormula)
                            return key ? displayRuleFieldName(key) : "-"
                          })()}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs">{r.conditionFormula || "-"}</td>
                        <td className="px-3 py-1.5">
                          <span className="inline-block h-4 w-8 rounded" style={{ backgroundColor: r.backgroundColor }} />
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="inline-flex items-center gap-1">
                            <span>{r.sortOrder}</span>
                            {idx > 0 ? (
                              <button
                                type="button"
                                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                onClick={() => void moveRule(group.key, r.id, "up")}
                                aria-label="Move up"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                            {idx < group.rules.length - 1 ? (
                              <button
                                type="button"
                                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                onClick={() => void moveRule(group.key, r.id, "down")}
                                aria-label="Move down"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-1.5">{scopeLabel(r.applyTo)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <button className="rounded p-1 text-red-500 hover:bg-red-50" onClick={() => void removeRule(r.id)}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            </div>
          )}
        </div>
      </div>
      <AlertDialog open={deleteRequest != null} onOpenChange={(open) => !open && !deleting && setDeleteRequest(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteRequest?.title ?? "Delete rules?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRequest?.description ?? "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault()
                void confirmDeleteRequest()
              }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

