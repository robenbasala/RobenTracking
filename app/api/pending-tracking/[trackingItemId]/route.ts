import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import { buildDetailResponse } from "@/lib/pending-tracking/detail-metadata"
import type { PendingTrackingDetailResponse } from "@/lib/pending-tracking/types"

/**
 * GET /api/pending-tracking/:trackingItemId
 * Unified fields from dbo.FieldMetadata (Detail screen) + base + custom values.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ trackingItemId: string }> }
) {
  try {
    const { trackingItemId: idParam } = await context.params
    const trackingItemId = Number(idParam)
    if (!Number.isFinite(trackingItemId)) {
      return NextResponse.json({ error: "Invalid trackingItemId" }, { status: 400 })
    }

    const url = new URL(request.url)
    const stateRaw = url.searchParams.get("state")?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null

    const pool = await getTrackingPool()
    const body = await buildDetailResponse(pool, trackingItemId, state)

    if (!body) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json(body satisfies PendingTrackingDetailResponse)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load detail."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/pending-tracking/:trackingItemId?companyId=
 * Soft-delete: sets IsActive = 0
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ trackingItemId: string }> }
) {
  try {
    const { trackingItemId: idParam } = await context.params
    const trackingItemId = Number(idParam)
    if (!Number.isFinite(trackingItemId)) {
      return NextResponse.json({ error: "Invalid trackingItemId" }, { status: 400 })
    }

    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    await req.query(`
      UPDATE dbo.PendingTrackingItem
      SET IsActive = 0
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete item."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
