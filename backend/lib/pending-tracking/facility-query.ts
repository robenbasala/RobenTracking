/**
 * Facility filter query parsing (multi-select via facilityIds CSV or legacy facilityId).
 */

/** CSV for STRING_SPLIT; null = no facility filter (all facilities). */
export function sanitizeFacilityIdsForCsv(ids: string[]): string | null {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const s = raw.trim().slice(0, 64)
    if (!s) continue
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s) || /[,']/.test(s)) continue
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= 80) break
  }
  return out.length === 0 ? null : out.join(",")
}

/**
 * Parse `facilityIds=a,b` or repeated `facilityIds`, with legacy `facilityId` fallback.
 */
export function parseFacilityIdsFromQuery(q: Record<string, unknown>): string[] {
  const rawList = q.facilityIds
  if (Array.isArray(rawList)) {
    const out: string[] = []
    for (const item of rawList) {
      if (typeof item !== "string") continue
      for (const part of item.split(",")) {
        const t = part.trim()
        if (t) out.push(t)
      }
    }
    return out
  }
  if (typeof rawList === "string" && rawList.trim()) {
    return rawList
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const single = q.facilityId
  if (typeof single === "string" && single.trim()) {
    return [single.trim()]
  }
  return []
}

/** SQL fragment: `ti` = TrackingItemsTbl. Requires @facilityIdList NVARCHAR(MAX) parameter. */
export const SQL_FILTER_FACILITY_LIST_TI = `
    AND (
      @facilityIdList IS NULL
      OR EXISTS (
        SELECT 1
        FROM STRING_SPLIT(@facilityIdList, N',') AS s
        WHERE LTRIM(RTRIM(s.value)) <> N''
          AND ti.FacilityId = LTRIM(RTRIM(s.value))
      )
    )`
