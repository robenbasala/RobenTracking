import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

export type ViewTypeTabDto = {
  viewType: string
  label: string
}

function formatTabLabel(viewType: string): string {
  const t = viewType.trim()
  if (!t) return t
  const withSpaces = t.replace(/([a-z])([A-Z])/g, "$1 $2")
  return withSpaces.replace(/_/g, " ")
}

/**
 * GET /api/pending-tracking/view-types
 * Distinct ViewType values for the facility from dbo.PendingTrackingItem.
 *
 * Query: companyId (required), facilityId (optional — omit for all facilities in company)
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const companyIdRaw =
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    const companyId = Number(companyIdRaw)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json(
        { error: "companyId is required (or set TRACKING_DEFAULT_COMPANY_ID)." },
        { status: 400 }
      )
    }

    const facilityId = url.searchParams.get("facilityId")?.trim() || null

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    req.input("facilityId", sql.NVarChar(50), facilityId)

    const queryText = `
      SELECT DISTINCT LTRIM(RTRIM(ti.ViewType)) AS ViewType
      FROM dbo.PendingTrackingItem ti
      WHERE ti.CompanyId = @companyId
        AND ti.IsActive = 1
        AND ti.ViewType IS NOT NULL
        AND LTRIM(RTRIM(ti.ViewType)) <> N''
        AND (@facilityId IS NULL OR @facilityId = N'' OR ti.FacilityId = @facilityId)
      ORDER BY ViewType
    `

    const result = await req.query<{ ViewType: string }>(queryText)
    const viewTypes = result.recordset
      .map((r) => r.ViewType)
      .filter((v): v is string => typeof v === "string" && v.length > 0)

    const tabs: ViewTypeTabDto[] = viewTypes.map((viewType) => ({
      viewType,
      label: formatTabLabel(viewType),
    }))

    return NextResponse.json({ tabs })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load view types."
    return NextResponse.json({ tabs: [], error: message }, { status: 500 })
  }
}
