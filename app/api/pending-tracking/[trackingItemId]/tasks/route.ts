import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * GET /api/pending-tracking/:trackingItemId/tasks?companyId=
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ trackingItemId: string }> }
) {
  try {
    const { trackingItemId: idParam } = await context.params
    const trackingItemId = Number(idParam)
    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(trackingItemId) || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    const result = await req.query<{
      TaskId: number
      Title: string
      DueDate: Date | null
      Status: string
      Assignee: string | null
      Notes: string | null
      CreatedAt: Date
      CreatedBy: string | null
    }>(`
      SELECT TaskId, Title, DueDate, Status, Assignee, Notes, CreatedAt, CreatedBy
      FROM dbo.ResidentTask
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId
      ORDER BY CreatedAt DESC
    `)

    const tasks = result.recordset.map((r) => ({
      taskId: r.TaskId,
      title: r.Title,
      dueDate: r.DueDate
        ? (r.DueDate instanceof Date ? r.DueDate : new Date(r.DueDate))
            .toISOString()
            .slice(0, 10)
        : null,
      status: r.Status,
      assignee: r.Assignee,
      notes: r.Notes,
      createdAt: (r.CreatedAt instanceof Date ? r.CreatedAt : new Date(r.CreatedAt)).toISOString(),
      createdBy: r.CreatedBy,
    }))

    return NextResponse.json({ tasks })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load tasks."
    return NextResponse.json({ error: message, tasks: [] }, { status: 500 })
  }
}

/**
 * POST /api/pending-tracking/:trackingItemId/tasks
 * Body: { companyId, title, dueDate?, status?, assignee?, notes? }
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ trackingItemId: string }> }
) {
  try {
    const { trackingItemId: idParam } = await context.params
    const trackingItemId = Number(idParam)
    if (!Number.isFinite(trackingItemId)) {
      return NextResponse.json({ error: "Invalid trackingItemId" }, { status: 400 })
    }

    const body = (await request.json()) as {
      companyId?: number
      title?: string
      dueDate?: string | null
      status?: string
      assignee?: string | null
      notes?: string | null
    }

    const companyId = Number(body.companyId)
    const title = body.title?.trim() ?? ""
    if (!Number.isFinite(companyId) || !title) {
      return NextResponse.json({ error: "companyId, title required" }, { status: 400 })
    }

    const rawStatus = body.status?.trim() ?? ""
    const validStatuses = ["Open", "InProgress", "Completed", "Cancelled"]
    const status = validStatuses.includes(rawStatus) ? rawStatus : "Open"

    const dueDate =
      body.dueDate ? new Date(body.dueDate) : null
    const dueDateVal = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    req.input("title", sql.NVarChar(256), title)
    req.input("dueDate", sql.Date, dueDateVal)
    req.input("status", sql.NVarChar(50), status)
    req.input("assignee", sql.NVarChar(256), body.assignee ?? null)
    req.input("notes", sql.NVarChar(sql.MAX), body.notes ?? null)
    req.input("createdBy", sql.NVarChar(256), "system")

    const result = await req.query<{ TaskId: number }>(`
      INSERT INTO dbo.ResidentTask (TrackingItemId, CompanyId, Title, DueDate, Status, Assignee, Notes, CreatedBy)
      OUTPUT INSERTED.TaskId
      VALUES (@trackingItemId, @companyId, @title, @dueDate, @status, @assignee, @notes, @createdBy)
    `)

    const taskId = Number(result.recordset[0]?.TaskId)
    return NextResponse.json({ ok: true, taskId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create task."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
