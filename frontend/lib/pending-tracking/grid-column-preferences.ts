import type { GridColumnMeta } from "./types"

const VERSION = 1

export type GridColumnPrefs = {
  version: number
  /** Visible columns only, in display order. */
  orderedVisibleKeys: string[]
}

function storageKey(companyId: number, viewType: string): string {
  return `rt.grid.cols.v${VERSION}:${companyId}:${viewType}`
}

export function loadGridColumnPrefs(
  companyId: number,
  viewType: string
): GridColumnPrefs | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(storageKey(companyId, viewType))
    if (!raw) return null
    const j = JSON.parse(raw) as GridColumnPrefs
    if (
      !j ||
      j.version !== VERSION ||
      !Array.isArray(j.orderedVisibleKeys)
    ) {
      return null
    }
    return j
  } catch {
    return null
  }
}

export function saveGridColumnPrefs(
  companyId: number,
  viewType: string,
  orderedVisibleKeys: string[]
): void {
  const p: GridColumnPrefs = {
    version: VERSION,
    orderedVisibleKeys: [...orderedVisibleKeys],
  }
  localStorage.setItem(storageKey(companyId, viewType), JSON.stringify(p))
}

export function clearGridColumnPrefs(companyId: number, viewType: string): void {
  localStorage.removeItem(storageKey(companyId, viewType))
}

/**
 * Apply saved visibility + order. Only keys listed in prefs are shown (in that order).
 */
export function applyGridColumnPrefs(
  columns: GridColumnMeta[],
  prefs: GridColumnPrefs | null
): GridColumnMeta[] {
  const base = [...columns].sort((a, b) => a.order - b.order)
  if (!prefs?.orderedVisibleKeys?.length) return base
  const byKey = new Map(base.map((c) => [c.key.toLowerCase(), c]))
  const out: GridColumnMeta[] = []
  for (const k of prefs.orderedVisibleKeys) {
    const c = byKey.get(k.trim().toLowerCase())
    if (c && !out.some((x) => x.key === c.key)) out.push(c)
  }
  return out.length > 0 ? out : base
}

/** Value for `columnKeys` query param (same order as grid). */
export function columnKeysForExportQuery(
  companyId: number,
  viewType: string
): string | null {
  const p = loadGridColumnPrefs(companyId, viewType)
  if (!p?.orderedVisibleKeys?.length) return null
  return p.orderedVisibleKeys.join(",")
}
