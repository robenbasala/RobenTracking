import { evaluateFormulaDefinition } from "./evaluate-formula.js"
import type { FieldMetadataRow } from "./field-metadata.js"
import { isCalculatedField } from "./field-metadata.js"
import { parseFormulaDefinitionJson } from "./formula-definition.js"

function pascalToCamelKey(fieldName: string): string {
  if (!fieldName) return fieldName
  return fieldName.charAt(0).toLowerCase() + fieldName.slice(1)
}

function valueByFieldName(
  row: Record<string, unknown>,
  fieldName: string
): unknown {
  const target = fieldName.toLowerCase()
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === target) return v
  }
  return undefined
}

function formatValueForGrid(raw: unknown, dataType: string): unknown {
  if (raw === null || raw === undefined) return null
  const t = dataType.toLowerCase()
  if (t === "date" || t.includes("time")) {
    if (raw instanceof Date) return raw.toISOString().slice(0, 10)
    const d = new Date(String(raw))
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  if (
    t === "number" ||
    t === "currency" ||
    t === "money" ||
    t === "float" ||
    t === "int"
  ) {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw
    const n = Number(String(raw).replace(/,/g, ""))
    return Number.isFinite(n) ? n : raw
  }
  if (t === "boolean" || t === "bit") {
    if (typeof raw === "boolean") return raw
    const s = String(raw).toLowerCase()
    if (s === "true" || s === "1") return true
    if (s === "false" || s === "0") return false
    return raw
  }
  return raw
}

/**
 * Fills calculated column values on a grid row (`out` uses camelCase keys).
 */
export function applyCalculatedGridColumns(
  out: Record<string, unknown>,
  rawRow: Record<string, unknown>,
  fields: FieldMetadataRow[]
): void {
  if (!fields.some(isCalculatedField)) return

  const ctx: Record<string, unknown> = {}
  for (const f of fields) {
    if (isCalculatedField(f)) continue
    const camel = pascalToCamelKey(f.FieldName)
    let v: unknown = out[camel]
    if (v === undefined) v = valueByFieldName(rawRow, f.FieldName)
    ctx[f.FieldName] = v
  }

  const calculated = fields
    .filter(isCalculatedField)
    .sort((a, b) => a.DisplayOrder - b.DisplayOrder || a.FieldMetadataId - b.FieldMetadataId)

  const maxPasses = calculated.length + 3
  for (let p = 0; p < maxPasses; p++) {
    for (const f of calculated) {
      const def = parseFormulaDefinitionJson(f.FormulaDefinitionJson)
      if (!def) continue
      ctx[f.FieldName] = evaluateFormulaDefinition(def, ctx)
    }
  }

  for (const f of calculated) {
    const camel = pascalToCamelKey(f.FieldName)
    out[camel] = formatValueForGrid(ctx[f.FieldName], f.DataType)
  }
}

/**
 * Merges calculated values into a Pascal-keyed value map (detail / server-side).
 */
export function applyCalculatedToPascalContext(
  fields: FieldMetadataRow[],
  valueMap: Map<string, unknown>
): void {
  if (!fields.some(isCalculatedField)) return

  const ctx: Record<string, unknown> = {}
  for (const f of fields) {
    if (isCalculatedField(f)) continue
    ctx[f.FieldName] = valueMap.get(f.FieldName)
  }

  const calculated = fields
    .filter(isCalculatedField)
    .sort((a, b) => a.DisplayOrder - b.DisplayOrder || a.FieldMetadataId - b.FieldMetadataId)

  const maxPasses = calculated.length + 3
  for (let p = 0; p < maxPasses; p++) {
    for (const f of calculated) {
      const def = parseFormulaDefinitionJson(f.FormulaDefinitionJson)
      if (!def) continue
      const next = evaluateFormulaDefinition(def, ctx)
      ctx[f.FieldName] = next
      valueMap.set(f.FieldName, next)
    }
  }
}
