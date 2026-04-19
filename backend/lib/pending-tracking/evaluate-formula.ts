import type {
  FormulaDefinition,
  FormulaOperand,
} from "./formula-definition.js"

function pascalKey(fieldCode: string): string {
  const t = fieldCode.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  let s = String(v).trim()
  if (s === "") return null
  // Accounting: (1,234.56) → -1234.56
  if (/^\(.*\)$/.test(s)) {
    const inner = s.slice(1, -1).replace(/,/g, "").trim()
    const n = Number(inner)
    return Number.isFinite(n) ? -n : null
  }
  s = s.replace(/[$€£\s%]/g, "").replace(/,/g, "")
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v
  }
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function toComparableString(v: unknown): string {
  if (v === null || v === undefined) return ""
  if (typeof v === "boolean") return v ? "true" : "false"
  if (typeof v === "number") return String(v)
  return String(v).trim()
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === "string") return v.trim() === ""
  return false
}

export function evaluateOperand(
  op: FormulaOperand,
  ctx: Record<string, unknown>
): unknown {
  if (op.sourceType === "constant") {
    return op.constantValue ?? null
  }
  const code = op.fieldCode?.trim()
  if (!code) return null
  const key = pascalKey(code)
  if (Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key]
  const lower = code.toLowerCase()
  for (const [k, val] of Object.entries(ctx)) {
    if (k.toLowerCase() === lower) return val
  }
  return null
}

type ConditionalFormula = Extract<
  FormulaDefinition,
  { calculationType: "conditional" }
>

function compare(op: ConditionalFormula, ctx: Record<string, unknown>): boolean {
  const left = evaluateOperand(op.leftOperand, ctx)
  const comp = op.comparisonOperator

  if (comp === "is_empty") return isEmptyValue(left)
  if (comp === "is_not_empty") return !isEmptyValue(left)

  const right = op.rightOperand
    ? evaluateOperand(op.rightOperand, ctx)
    : null

  const orderingOps = [
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "greater_than_or_equal",
    "less_than_or_equal",
  ] as const

  // Prefer numeric comparison first. Plain numbers like "1000" must not be parsed as
  // years via `new Date("1000")`, and string ordering wrongly treats "72.4" >= "1000".
  const ln = toNumber(left)
  const rn = toNumber(right)
  const bothNums =
    ln !== null &&
    rn !== null &&
    (orderingOps as readonly string[]).includes(comp)

  if (bothNums) {
    if (comp === "equals") return ln === rn
    if (comp === "not_equals") return ln !== rn
    if (comp === "greater_than") return ln! > rn!
    if (comp === "less_than") return ln! < rn!
    if (comp === "greater_than_or_equal") return ln! >= rn!
    if (comp === "less_than_or_equal") return ln! <= rn!
  }

  const ld = toDate(left)
  const rd = toDate(right)
  const bothDates =
    ld !== null &&
    rd !== null &&
    (orderingOps as readonly string[]).includes(comp)

  if (bothDates) {
    const lt = ld!.getTime()
    const rt = rd!.getTime()
    if (comp === "equals") return lt === rt
    if (comp === "not_equals") return lt !== rt
    if (comp === "greater_than") return lt > rt
    if (comp === "less_than") return lt < rt
    if (comp === "greater_than_or_equal") return lt >= rt
    if (comp === "less_than_or_equal") return lt <= rt
  }

  const ls = toComparableString(left)
  const rs = toComparableString(right)
  if (comp === "equals") return ls === rs
  if (comp === "not_equals") return ls !== rs
  if (comp === "contains")
    return ls.toLowerCase().includes(rs.toLowerCase())
  if (comp === "greater_than") return ls > rs
  if (comp === "less_than") return ls < rs
  if (comp === "greater_than_or_equal") return ls >= rs
  if (comp === "less_than_or_equal") return ls <= rs
  return false
}

function coerceConditionalResult(
  raw: unknown,
  resultDataType: "text" | "numeric" | "date" | "boolean"
): unknown {
  if (raw === null || raw === undefined) return null
  if (resultDataType === "boolean") {
    if (typeof raw === "boolean") return raw
    const s = String(raw).toLowerCase()
    if (s === "true" || s === "1") return true
    if (s === "false" || s === "0") return false
    return null
  }
  if (resultDataType === "numeric") {
    return toNumber(raw)
  }
  if (resultDataType === "date") {
    const d = toDate(raw)
    return d ? d.toISOString().slice(0, 10) : null
  }
  return String(raw)
}

/**
 * Evaluates a formula against a Pascal-keyed context (FieldMetadata.FieldName → value).
 */
export function evaluateFormulaDefinition(
  def: FormulaDefinition,
  ctx: Record<string, unknown>
): unknown {
  switch (def.calculationType) {
    case "date_arithmetic": {
      const base = toDate(
        evaluateOperand(
          { sourceType: "field", fieldCode: def.sourceFieldCode },
          ctx
        )
      )
      if (!base) return null
      const ms =
        def.operator === "add_days"
          ? def.days * 86400000
          : -def.days * 86400000
      const next = new Date(base.getTime() + ms)
      return next.toISOString().slice(0, 10)
    }
    case "number_arithmetic": {
      const a = evaluateOperand(def.leftOperand, ctx)
      const b = evaluateOperand(def.rightOperand, ctx)
      const x = toNumber(a)
      const y = toNumber(b)
      if (x === null || y === null) return null
      switch (def.operator) {
        case "add":
          return x + y
        case "subtract":
          return x - y
        case "multiply":
          return x * y
        case "divide":
          return y === 0 ? null : x / y
        default:
          return null
      }
    }
    case "conditional": {
      const ok = compare(def, ctx)
      const branch = ok ? def.trueResult : def.falseResult
      const raw = evaluateOperand(branch, ctx)
      return coerceConditionalResult(raw, def.resultDataType)
    }
    default:
      return null
  }
}
