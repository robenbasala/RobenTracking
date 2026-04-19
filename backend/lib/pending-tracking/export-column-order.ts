import type { GridColumnMeta } from "./types.js"

/**
 * Optional `columnKeys` query: comma-separated camelCase keys matching grid `col.key`.
 * Order is preserved; unknown keys ignored.
 */
export function parseColumnKeysFromQuery(
  q: Record<string, unknown>
): string | null {
  const raw = q.columnKeys
  if (typeof raw !== "string") return null
  const s = raw.trim()
  if (!s || s.length > 12_000) return null
  return s
}

export function orderColumnsByKeys(
  columns: GridColumnMeta[],
  columnKeysCsv: string | null
): GridColumnMeta[] {
  if (!columnKeysCsv?.trim()) return columns
  const keys = columnKeysCsv
    .split(",")
    .map((k) => k.trim())
    .filter((k) => /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(k))
  if (keys.length === 0) return columns
  const byKey = new Map(columns.map((c) => [c.key.toLowerCase(), c]))
  const out: GridColumnMeta[] = []
  for (const k of keys) {
    const c = byKey.get(k.toLowerCase())
    if (c && !out.some((x) => x.key === c.key)) out.push(c)
  }
  return out.length > 0 ? out : columns
}
