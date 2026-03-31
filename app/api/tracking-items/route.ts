import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

type NavSection =
  | "pending"
  | "medicare"
  | "managed-care"
  | "recertifications"
  | "tasks"
  | "hot-cases"

type TrackingItem = {
  trackingItemId: number
  facilityName: string | null
  residentName: string | null
  payerName: string | null
  payerType: string | null
  admitDate: string | null
  balance: number | null
  status: string | null
  assignedTo: string | null
  isHotCase: boolean
}

const viewTypeMap: Record<NavSection, string> = {
  pending: "Pending",
  medicare: "Medicare",
  "managed-care": "ManagedCare",
  recertifications: "Recertifications",
  tasks: "Tasks",
  "hot-cases": "HotCases",
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const section = (searchParams.get("section") ?? "pending") as NavSection
    const selectedViewType = viewTypeMap[section] ?? "Pending"

    const companyIdRaw =
      searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    const companyId = companyIdRaw ? Number(companyIdRaw) : null

    const facilityName =
      searchParams.get("facilityName") ??
      process.env.TRACKING_DEFAULT_FACILITY_NAME ??
      "Peak Healthcare"

    const requestDb = (await getTrackingPool()).request()
    requestDb.input("viewType", sql.VarChar(50), selectedViewType)
    requestDb.input("facilityName", sql.VarChar(200), facilityName)
    requestDb.input("section", sql.VarChar(20), section)
    requestDb.input("companyId", sql.Int, Number.isFinite(companyId) ? companyId : null)

    const result = await requestDb.query<TrackingItem>(`
      SELECT
        TrackingItemId AS trackingItemId,
        FacilityName AS facilityName,
        ResidentName AS residentName,
        PayerName AS payerName,
        PayerType AS payerType,
        CONVERT(varchar(10), AdmitDate, 23) AS admitDate,
        Balance AS balance,
        Status AS status,
        AssignedTo AS assignedTo,
        CASE
          WHEN @section = 'hot-cases'
            OR ISNULL(Balance, 0) >= 5000
            OR UPPER(ISNULL(Status, '')) LIKE '%HOT%'
          THEN CAST(1 AS bit)
          ELSE CAST(0 AS bit)
        END AS isHotCase
      FROM dbo.PendingTrackingItem
      WHERE IsActive = 1
        AND ViewType = @viewType
        AND FacilityName = @facilityName
        AND (@companyId IS NULL OR CompanyId = @companyId)
      ORDER BY ISNULL(UpdatedAt, CreatedAt) DESC
    `)

    return NextResponse.json({ items: result.recordset })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load tracking items."
    return NextResponse.json({ items: [], error: message }, { status: 500 })
  }
}
