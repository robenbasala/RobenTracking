import type { GridColumnMeta } from "./types.js"

/** MM/DD/YYYY for exports (PDF / Excel). */
export function formatShortDateValue(val: unknown): string {
  const d = coerceToDate(val)
  if (!d || Number.isNaN(d.getTime())) {
    if (val === null || val === undefined) return ""
    return String(val)
  }
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const y = d.getFullYear()
  return `${m}/${day}/${y}`
}

function looksLikeLongDateString(val: unknown): boolean {
  if (val instanceof Date) return true
  if (typeof val !== "string") return false
  const s = val.trim()
  if (s.length < 12 || s.length > 120) return false
  const t = Date.parse(s)
  if (Number.isNaN(t)) return false
  return (
    /^\d{4}-\d{2}-\d{2}/.test(s) ||
    s.includes("GMT") ||
    (s.includes("T") && s.includes(":")) ||
    /^\w{3}\s+\w{3}\s+\d{1,2}/.test(s)
  )
}

function coerceToDate(val: unknown): Date | null {
  if (val instanceof Date) return val
  const s = String(val).trim()
  if (!s) return null
  const t = Date.parse(s)
  if (!Number.isNaN(t)) return new Date(t)
  const iso = s.slice(0, 10)
  const t2 = Date.parse(iso)
  if (!Number.isNaN(t2)) return new Date(t2)
  return null
}

export function formatExportCellValue(
  val: unknown,
  col: GridColumnMeta
): string {
  if (val === null || val === undefined) return ""
  if (col.type === "boolean") {
    if (val === null || val === undefined || val === "") return ""
    return val === true ||
      val === "true" ||
      val === 1 ||
      val === "1"
      ? "Yes"
      : "No"
  }
  if (col.type === "date") return formatShortDateValue(val)
  if (col.type === "text" && looksLikeLongDateString(val)) {
    const sd = formatShortDateValue(val)
    if (sd.length > 0 && sd.length < String(val).length) return sd
  }
  return String(val)
}
