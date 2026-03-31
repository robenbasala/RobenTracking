import { NextResponse } from "next/server"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import { fetchTrackingItemBase } from "@/lib/pending-tracking/detail-sql"
import { saveTrackingItemFieldValues } from "@/lib/pending-tracking/save-field-values"

/**
 * PUT /api/pending-tracking/:trackingItemId/values
 * Body: { "values": { "FieldName": value, ... } } — FieldName matches dbo.FieldMetadata.FieldName
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ trackingItemId: string }> }
) {
  try {
    const { trackingItemId: idParam } = await context.params
    const trackingItemId = Number(idParam)
    if (!Number.isFinite(trackingItemId)) {
      return NextResponse.json({ error: "Invalid trackingItemId" }, { status: 400 })
    }

    const json = (await request.json()) as { values?: Record<string, unknown> }
    const values = json.values ?? {}
    if (typeof values !== "object" || values === null) {
      return NextResponse.json({ error: "values object required" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const baseRow = await fetchTrackingItemBase(pool, trackingItemId)
    if (!baseRow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const companyId = Number(baseRow.CompanyId)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "Invalid company" }, { status: 422 })
    }

    const result = await saveTrackingItemFieldValues(
      pool,
      trackingItemId,
      companyId,
      values
    )

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save values."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
