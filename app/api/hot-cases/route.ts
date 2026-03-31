import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import { hasIsHotCaseColumn } from "@/lib/pending-tracking/grid-sql"

export type HotCaseRow = {
  trackingItemId: number
  residentName: string | null
  facilityName: string | null
  viewType: string | null
  status: string | null
  balance: number | null
  updatedAt: string | null
}

/**
 * GET /api/hot-cases?companyId=&facilityId=
 * Rows flagged IsHotCase on PendingTrackingItem.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const companyIdRaw =
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    const companyId = Number(companyIdRaw)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json(
        { error: "companyId is required.", items: [] },
        { status: 400 }
      )
    }
    const facilityId = url.searchParams.get("facilityId")?.trim() || null

    const pool = await getTrackingPool()
    const includeHot = await hasIsHotCaseColumn(pool)
    if (!includeHot) {
      return NextResponse.json({
        items: [] as HotCaseRow[],
        error:
          "IsHotCase column is not available on PendingTrackingItem yet. Apply the latest schema migration.",
      })
    }

    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    req.input("facilityId", sql.NVarChar(50), facilityId)

    const result = await req.query<{
      TrackingItemId: number
      ResidentName: string | null
      FacilityName: string | null
      ViewType: string | null
      Status: string | null
      Balance: number | null
      UpdatedAt: Date | null
    }>(`
      SELECT TOP 500
        ti.TrackingItemId,
        ti.ResidentName,
        ti.FacilityName,
        ti.ViewType,
        ti.Status,
        ti.Balance,
        ti.UpdatedAt
      FROM dbo.PendingTrackingItem ti
      WHERE ti.IsActive = 1
        AND ti.CompanyId = @companyId
        AND ISNULL(ti.IsHotCase, 0) = 1
        AND (@facilityId IS NULL OR @facilityId = N'' OR ti.FacilityId = @facilityId)
      ORDER BY ISNULL(ti.UpdatedAt, ti.CreatedAt) DESC
    `)

    const items: HotCaseRow[] = result.recordset.map((r) => ({
      trackingItemId: r.TrackingItemId,
      residentName: r.ResidentName,
      facilityName: r.FacilityName,
      viewType: r.ViewType,
      status: r.Status,
      balance: r.Balance,
      updatedAt:
        r.UpdatedAt instanceof Date
          ? r.UpdatedAt.toISOString()
          : r.UpdatedAt
            ? new Date(r.UpdatedAt).toISOString()
            : null,
    }))

    return NextResponse.json({ items })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load hot cases."
    return NextResponse.json({ items: [], error: message }, { status: 500 })
  }
}
