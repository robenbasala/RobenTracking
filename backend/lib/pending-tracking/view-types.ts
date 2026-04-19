/**
 * View-type tabs are loaded from GET /api/pending-tracking/view-types
 * (distinct PendingTrackingItem.ViewType per facility).
 */

/** Basic sanity check for grid API (values come from DB, not a fixed allowlist). */
export function isValidViewTypeParam(value: string): boolean {
  const t = value.trim()
  return t.length > 0 && t.length <= 120 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)
}
