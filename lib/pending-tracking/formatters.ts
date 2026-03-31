import type { GridColumnType } from "./types"

/**
 * Turns PascalCase / snake_case identifiers into readable titles when Field Admin
 * leaves DisplayName empty or mirrors FieldName without spaces.
 */
export function humanizeIdentifierForDisplay(name: string): string {
  const raw = name.trim()
  if (!raw) return raw
  return raw
    .replace(/_/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .replace(/\bId\b/gi, "ID")
}

/** Column header: Field Admin DisplayName wins; raw PascalCase duplicates get humanized. */
export function gridColumnTitleFromFieldMetadata(
  displayName: string | null | undefined,
  fieldName: string
): string {
  const d = displayName?.trim() ?? ""
  const fn = fieldName.trim()
  if (!fn) return d
  if (!d) return humanizeIdentifierForDisplay(fn)
  if (d.toLowerCase() === fn.toLowerCase()) return humanizeIdentifierForDisplay(fn)
  return d
}

export function formatDateDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const d =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null
  if (!d || Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  })
}

export function formatCurrencyDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n)
}

export function formatNumberDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  return new Intl.NumberFormat("en-US").format(n)
}

export function parseBooleanFromCell(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return value
  const s = String(value).toLowerCase()
  if (s === "true" || s === "1" || s === "yes") return true
  if (s === "false" || s === "0" || s === "no") return false
  return null
}

export function formatCellForColumn(
  value: unknown,
  type: GridColumnType
): string {
  switch (type) {
    case "currency":
      return formatCurrencyDisplay(value)
    case "number":
      return formatNumberDisplay(value)
    case "date":
      return formatDateDisplay(value)
    case "boolean": {
      const b = parseBooleanFromCell(value)
      return b === null ? "—" : b ? "Yes" : "No"
    }
    default:
      return value === null || value === undefined ? "—" : String(value)
  }
}
