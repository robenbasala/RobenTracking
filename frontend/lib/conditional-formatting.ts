import { Parser } from "expr-eval"

export type ConditionOperator =
  | "="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_blank"
  | "is_not_blank"

export type ConditionNode =
  | {
      type: "condition"
      fieldKey: string
      operator: ConditionOperator
      value: string | number | boolean | null
    }
  | {
      type: "group"
      join: "AND" | "OR"
      children: ConditionNode[]
    }

export type ConditionalFormattingRuleModel = {
  id?: string
  datasetId: string
  reportKey: string | null
  targetFieldKey: string | null
  applyTo: "row" | "field"
  backgroundColor: string
  textColor?: string | null
  conditionTree: ConditionNode
  isEnabled: boolean
  sortOrder?: number
}

export function createEmptyCondition(): ConditionNode {
  return { type: "condition", fieldKey: "", operator: "=", value: "" }
}

export function createEmptyGroup(join: "AND" | "OR" = "AND"): ConditionNode {
  return { type: "group", join, children: [createEmptyCondition()] }
}

export function validateConditionTree(node: ConditionNode): string[] {
  const errors: string[] = []
  const walk = (n: ConditionNode, path: string) => {
    if (n.type === "group") {
      if (n.children.length === 0) errors.push(`${path} has no children`)
      n.children.forEach((c, i) => walk(c, `${path}.${i + 1}`))
      return
    }
    if (!n.fieldKey.trim()) errors.push(`${path} missing field`)
    if (
      n.operator !== "is_blank" &&
      n.operator !== "is_not_blank" &&
      (n.value === null || String(n.value).trim() === "")
    ) {
      errors.push(`${path} missing value`)
    }
  }
  walk(node, "root")
  return errors
}

export function buildConditionSummary(node: ConditionNode): string {
  if (node.type === "condition") {
    const op = node.operator
    if (op === "is_blank" || op === "is_not_blank") {
      return `${node.fieldKey || "[Field]"} ${op}`
    }
    return `${node.fieldKey || "[Field]"} ${op} ${String(node.value ?? "")}`
  }
  const parts = node.children.map((c) => buildConditionSummary(c))
  return `(${parts.join(` ${node.join} `)})`
}

const parser = new Parser({
  operators: {
    assignment: false,
    logical: true,
    comparison: true,
    add: true,
    concatenate: true,
    conditional: false,
    divide: true,
    factorial: false,
    multiply: true,
    power: false,
    remainder: true,
    subtract: true,
    in: false,
  },
})

function toNumberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

function toDateValue(value: unknown): Date | null {
  if (value == null || value === "") return null
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

function lookupRowValue(row: Record<string, unknown>, key: unknown): unknown {
  const target = String(key ?? "")
  if (target in row) return row[target]
  const lowered = target.toLowerCase()
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === lowered) return v
  }
  return undefined
}

export function evaluateConditionFormula(
  formula: string,
  row: Record<string, unknown>
): boolean {
  const src = formula.trim()
  if (!src) return false
  try {
    // Normalize row access so keys with spaces/special chars work reliably.
    const normalized = src
      .replace(/row\[\s*"([^"]+)"\s*\]/g, (_m, key: string) => `field(${JSON.stringify(key)})`)
      .replace(/row\[\s*'([^']+)'\s*\]/g, (_m, key: string) => `field(${JSON.stringify(key)})`)
      .replace(/\brow\.([A-Za-z_][A-Za-z0-9_]*)/g, (_m, key: string) => `field(${JSON.stringify(key)})`)
    const expr = parser.parse(normalized)
    const result = expr.evaluate({
      row,
      field: (k: unknown) => lookupRowValue(row, k),
      isBlank: (v: unknown) => v == null || String(v).trim() === "",
      isNotBlank: (v: unknown) => !(v == null || String(v).trim() === ""),
      contains: (v: unknown, t: unknown) =>
        String(v ?? "").toLowerCase().includes(String(t ?? "").toLowerCase()),
      startsWith: (v: unknown, t: unknown) =>
        String(v ?? "").toLowerCase().startsWith(String(t ?? "").toLowerCase()),
      endsWith: (v: unknown, t: unknown) =>
        String(v ?? "").toLowerCase().endsWith(String(t ?? "").toLowerCase()),
      toNumber: toNumberValue,
      toDate: (v: unknown) => toDateValue(v)?.getTime() ?? NaN,
      daysUntil: (v: unknown) => {
        const d = toDateValue(v)
        if (!d) return NaN
        return Math.floor((d.getTime() - Date.now()) / 86400000)
      },
      daysSince: (v: unknown) => {
        const d = toDateValue(v)
        if (!d) return NaN
        return Math.floor((Date.now() - d.getTime()) / 86400000)
      },
      null: null,
      true: true,
      false: false,
    } as any)
    return Boolean(result)
  } catch {
    return false
  }
}

