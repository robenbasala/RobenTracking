import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * PATCH /api/pending-tracking/:trackingItemId/hot-case
 * Body: { companyId, isHotCase: boolean }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ trackingItemId: string }> }
) {
  try {
    const { trackingItemId: idParam } = await context.params
    const trackingItemId = Number(idParam)
    const body = (await request.json()) as {
      companyId?: number
      isHotCase?: boolean
    }
    const companyId = Number(
      body.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(trackingItemId) || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 })
    }
    if (typeof body.isHotCase !== "boolean") {
      return NextResponse.json(
        { error: "isHotCase must be a boolean" },
        { status: 400 }
      )
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    req.input("isHotCase", sql.Bit, body.isHotCase ? 1 : 0)

    await req.query(`
      UPDATE dbo.PendingTrackingItem
      SET IsHotCase = @isHotCase
      WHERE TrackingItemId = @trackingItemId
        AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true, isHotCase: body.isHotCase })
  } catch (e) {
    console.error("PATCH hot-case error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
