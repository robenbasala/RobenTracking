import { applyCalculatedGridColumns } from "./calculated-fields.js"
import type { FieldMetadataRow } from "./field-metadata"

/** Same as TRACKING_ITEM_ID_FIELD_NAME in field-metadata — local to avoid importing mssql in client bundles. */
const TRACKING_ITEM_ID_FIELD_NAME = "TrackingItemId"

function pascalToCamelKey(fieldName: string): string {
  if (!fieldName) return fieldName
  return fieldName.charAt(0).toLowerCase() + fieldName.slice(1)
}

/** SQL Server / drivers may return column names in varying casing; normalize for lookup. */
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

/** Read a value from an API grid row by camelCase key (case-insensitive on keys). */
export function getRowValueForKey(
  row: Record<string, unknown>,
  camelKey: string
): unknown {
  if (camelKey in row) return row[camelKey]
  const target = camelKey.toLowerCase()
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === target) return v
  }
  return undefined
}

/** Stable numeric id for API detail routes; null if missing or invalid. */
export function getTrackingItemIdFromRow(
  row: Record<string, unknown>
): number | null {
  const raw = getRowValueForKey(row, "trackingItemId")
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/**
 * Maps a SQL grid row to API shape: FieldMetadata.FieldName (Pascal) → camelCase keys.
 * Lookup is case-insensitive so driver casing never breaks the grid or `trackingItemId`.
 */
export function mapGridRowWithFieldMetadata(
  row: Record<string, unknown>,
  fields: FieldMetadataRow[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const f of fields) {
    const v = valueByFieldName(row, f.FieldName)
    if (v !== undefined) {
      out[pascalToCamelKey(f.FieldName)] = v
    }
  }

  const idVal = valueByFieldName(row, TRACKING_ITEM_ID_FIELD_NAME)
  if (idVal !== undefined) {
    out[pascalToCamelKey(TRACKING_ITEM_ID_FIELD_NAME)] = idVal
  }

  // Pass through IsHotCase if present in the raw row
  const hotCase = valueByFieldName(row, "IsHotCase")
  if (hotCase !== undefined) {
    out.isHotCase = hotCase === true || hotCase === 1 || String(hotCase) === "1"
  }

  applyCalculatedGridColumns(out, row, fields)

  return out
}

/** @deprecated */
export function mapGridRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[pascalToCamelKey(k)] = v
  }
  return out
}

/** @deprecated */
export function mapBaseRowKeys(
  row: Record<string, unknown>
): Record<string, unknown> {
  return mapGridRowKeys(row)
}
