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

function toComparable(value: unknown): number | string {
  if (value == null) return ""
  if (typeof value === "number") return value
  const asNum = Number(value)
  if (Number.isFinite(asNum)) return asNum
  const asDate = new Date(String(value))
  if (!Number.isNaN(asDate.getTime())) return asDate.getTime()
  return String(value).toLowerCase()
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase()
}

export function validateConditionTree(node: unknown): string[] {
  const errors: string[] = []
  const walk = (n: unknown, path: string) => {
    if (!n || typeof n !== "object") {
      errors.push(`${path}: invalid node`)
      return
    }
    const nodeObj = n as Record<string, unknown>
    if (nodeObj.type === "group") {
      if (nodeObj.join !== "AND" && nodeObj.join !== "OR") {
        errors.push(`${path}.join must be AND/OR`)
      }
      if (!Array.isArray(nodeObj.children) || nodeObj.children.length === 0) {
        errors.push(`${path}.children must have at least one child`)
        return
      }
      nodeObj.children.forEach((child, idx) => walk(child, `${path}.children[${idx}]`))
      return
    }
    if (nodeObj.type === "condition") {
      const fieldKey = String(nodeObj.fieldKey ?? "").trim()
      const operator = String(nodeObj.operator ?? "")
      if (!fieldKey) errors.push(`${path}.fieldKey is required`)
      const allowed: ConditionOperator[] = [
        "=",
        "!=",
        ">",
        ">=",
        "<",
        "<=",
        "contains",
        "not_contains",
        "starts_with",
        "ends_with",
        "is_blank",
        "is_not_blank",
      ]
      if (!allowed.includes(operator as ConditionOperator)) {
        errors.push(`${path}.operator is invalid`)
      }
      if (
        operator !== "is_blank" &&
        operator !== "is_not_blank" &&
        !("value" in nodeObj)
      ) {
        errors.push(`${path}.value is required`)
      }
      return
    }
    errors.push(`${path}.type must be condition/group`)
  }
  walk(node, "conditionTree")
  return errors
}

export function evaluateConditionTree(node: ConditionNode, row: Record<string, unknown>): boolean {
  if (node.type === "group") {
    const results = node.children.map((child) => evaluateConditionTree(child, row))
    return node.join === "AND" ? results.every(Boolean) : results.some(Boolean)
  }

  const actual = row[node.fieldKey]
  const expected = node.value

  switch (node.operator) {
    case "=":
      return normalize(actual) === normalize(expected)
    case "!=":
      return normalize(actual) !== normalize(expected)
    case ">":
      return toComparable(actual) > toComparable(expected)
    case ">=":
      return toComparable(actual) >= toComparable(expected)
    case "<":
      return toComparable(actual) < toComparable(expected)
    case "<=":
      return toComparable(actual) <= toComparable(expected)
    case "contains":
      return normalize(actual).includes(normalize(expected))
    case "not_contains":
      return !normalize(actual).includes(normalize(expected))
    case "starts_with":
      return normalize(actual).startsWith(normalize(expected))
    case "ends_with":
      return normalize(actual).endsWith(normalize(expected))
    case "is_blank":
      return actual === null || actual === undefined || String(actual).trim() === ""
    case "is_not_blank":
      return !(actual === null || actual === undefined || String(actual).trim() === "")
    default:
      return false
  }
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

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

function toDate(value: unknown): Date | null {
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
    const scope = {
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
      toNumber,
      toDate: (v: unknown) => toDate(v)?.getTime() ?? NaN,
      daysUntil: (v: unknown) => {
        const d = toDate(v)
        if (!d) return NaN
        return Math.floor((d.getTime() - Date.now()) / 86400000)
      },
      daysSince: (v: unknown) => {
        const d = toDate(v)
        if (!d) return NaN
        return Math.floor((Date.now() - d.getTime()) / 86400000)
      },
      null: null,
      true: true,
      false: false,
    }
    const out = expr.evaluate(scope as any)
    return Boolean(out)
  } catch {
    return false
  }
}

