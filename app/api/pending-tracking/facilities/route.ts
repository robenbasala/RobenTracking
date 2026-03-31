import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * GET /api/pending-tracking/facilities?companyId=
 * Returns distinct facilities (id + name) for the filter dropdown.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ??
        process.env.TRACKING_DEFAULT_COMPANY_ID ??
        "1"
    )
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "Invalid companyId" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("companyId", sql.Int, companyId)

    const result = await req.query<{
      FacilityId: string
      FacilityName: string
    }>(`
      SELECT DISTINCT FacilityId, FacilityName
      FROM dbo.PendingTrackingItem
      WHERE CompanyId = @companyId
        AND FacilityName IS NOT NULL
        AND FacilityName <> N''
      ORDER BY FacilityName
    `)

    const facilities = result.recordset.map((r: { FacilityId: string; FacilityName: string }) => ({
      facilityId: r.FacilityId,
      facilityName: r.FacilityName,
    }))
    return NextResponse.json({ facilities })
  } catch (e) {
    console.error("GET /api/pending-tracking/facilities error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
