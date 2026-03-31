import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/** Whitelist of allowed sort columns to prevent SQL injection. */
const SORT_COLUMNS: Record<string, string> = {
  title: "t.Title",
  dueDate: "t.DueDate",
  status: "t.Status",
  assignee: "t.Assignee",
  createdAt: "t.CreatedAt",
  residentName: "p.ResidentName",
  facilityName: "p.FacilityName",
}

/**
 * GET /api/tasks?companyId=&status=&assignee=&search=&facilityName=&sortBy=&sortDirection=&page=&pageSize=
 * Returns all tasks across all cases, joined with resident/facility info.
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

    const statusFilter = url.searchParams.get("status")?.trim() || null
    const assigneeFilter = url.searchParams.get("assignee")?.trim() || null
    const searchFilter = url.searchParams.get("search")?.trim() || null
    const facilityFilter = url.searchParams.get("facilityName")?.trim() || null
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"))
    const pageSize = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? "50"))
    )
    const offset = (page - 1) * pageSize

    const sortByRaw = url.searchParams.get("sortBy")?.trim() || "createdAt"
    const sortCol = SORT_COLUMNS[sortByRaw] ?? "t.CreatedAt"
    const sortDir =
      url.searchParams.get("sortDirection")?.toLowerCase() === "asc"
        ? "ASC"
        : "DESC"

    const whereClause = `
      WHERE t.CompanyId = @companyId
        AND (@status IS NULL OR t.Status = @status)
        AND (@assignee IS NULL OR t.Assignee LIKE N'%' + @assignee + N'%')
        AND (@search IS NULL OR t.Title LIKE N'%' + @search + N'%')
        AND (@facilityName IS NULL OR p.FacilityName = @facilityName)
    `

    const pool = await getTrackingPool()

    // Get distinct facility names for filter dropdown
    const facReq = pool.request()
    facReq.input("companyId", sql.Int, companyId)
    const facResult = await facReq.query<{ FacilityName: string }>(`
      SELECT DISTINCT p.FacilityName
      FROM dbo.ResidentTask t
      INNER JOIN dbo.PendingTrackingItem p
        ON t.TrackingItemId = p.TrackingItemId
        AND p.CompanyId = t.CompanyId
      WHERE t.CompanyId = @companyId
        AND p.FacilityName IS NOT NULL
        AND p.FacilityName <> N''
      ORDER BY p.FacilityName
    `)
    const facilities = facResult.recordset.map((r) => r.FacilityName)

    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    req.input("status", sql.NVarChar(50), statusFilter)
    req.input("assignee", sql.NVarChar(256), assigneeFilter)
    req.input("search", sql.NVarChar(256), searchFilter)
    req.input("facilityName", sql.NVarChar(256), facilityFilter)
    req.input("offset", sql.Int, offset)
    req.input("pageSize", sql.Int, pageSize)

    const countResult = await req.query<{ TotalCount: number }>(`
      SELECT COUNT(*) AS TotalCount
      FROM dbo.ResidentTask t
      LEFT JOIN dbo.PendingTrackingItem p
        ON t.TrackingItemId = p.TrackingItemId
        AND p.CompanyId = t.CompanyId
      ${whereClause}
    `)
    const totalCount = countResult.recordset[0]?.TotalCount ?? 0

    const req2 = pool.request()
    req2.input("companyId", sql.Int, companyId)
    req2.input("status", sql.NVarChar(50), statusFilter)
    req2.input("assignee", sql.NVarChar(256), assigneeFilter)
    req2.input("search", sql.NVarChar(256), searchFilter)
    req2.input("facilityName", sql.NVarChar(256), facilityFilter)
    req2.input("offset", sql.Int, offset)
    req2.input("pageSize", sql.Int, pageSize)

    const result = await req2.query<{
      TaskId: number
      TrackingItemId: number
      Title: string
      DueDate: Date | null
      Status: string
      Assignee: string | null
      Notes: string | null
      CreatedAt: Date
      CreatedBy: string | null
      ResidentName: string | null
      FacilityName: string | null
    }>(`
      SELECT
        t.TaskId,
        t.TrackingItemId,
        t.Title,
        t.DueDate,
        t.Status,
        t.Assignee,
        t.Notes,
        t.CreatedAt,
        t.CreatedBy,
        p.ResidentName,
        p.FacilityName
      FROM dbo.ResidentTask t
      LEFT JOIN dbo.PendingTrackingItem p
        ON t.TrackingItemId = p.TrackingItemId
        AND p.CompanyId = t.CompanyId
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `)

    const tasks = result.recordset.map((r) => ({
      taskId: r.TaskId,
      trackingItemId: r.TrackingItemId,
      title: r.Title,
      dueDate: r.DueDate ? r.DueDate.toISOString().slice(0, 10) : null,
      status: r.Status,
      assignee: r.Assignee,
      notes: r.Notes,
      createdAt: r.CreatedAt.toISOString(),
      createdBy: r.CreatedBy,
      residentName: r.ResidentName,
      facilityName: r.FacilityName,
    }))

    return NextResponse.json({ tasks, totalCount, page, pageSize, facilities })
  } catch (e) {
    console.error("GET /api/tasks error:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
