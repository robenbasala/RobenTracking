import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * PATCH /api/pending-tracking/:trackingItemId/tasks/:taskId
 * Body: { companyId, title?, dueDate?, status?, assignee?, notes? }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ trackingItemId: string; taskId: string }> }
) {
  try {
    const { trackingItemId: tidParam, taskId: kidParam } = await context.params
    const trackingItemId = Number(tidParam)
    const taskId = Number(kidParam)
    if (!Number.isFinite(trackingItemId) || !Number.isFinite(taskId)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 })
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
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("taskId", sql.Int, taskId)
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)

    const sets: string[] = ["UpdatedAt = SYSUTCDATETIME()"]

    if (body.title !== undefined) {
      req.input("title", sql.NVarChar(256), body.title.trim())
      sets.push("Title = @title")
    }
    if ("dueDate" in body) {
      const d = body.dueDate ? new Date(body.dueDate) : null
      req.input("dueDate", sql.Date, d && !Number.isNaN(d.getTime()) ? d : null)
      sets.push("DueDate = @dueDate")
    }
    const validStatuses = ["Open", "InProgress", "Completed", "Cancelled"]
    if (body.status !== undefined && validStatuses.includes(body.status)) {
      req.input("status", sql.NVarChar(50), body.status)
      sets.push("Status = @status")
    }
    if ("assignee" in body) {
      req.input("assignee", sql.NVarChar(256), body.assignee ?? null)
      sets.push("Assignee = @assignee")
    }
    if ("notes" in body) {
      req.input("notes", sql.NVarChar(sql.MAX), body.notes ?? null)
      sets.push("Notes = @notes")
    }

    await req.query(`
      UPDATE dbo.ResidentTask SET ${sets.join(", ")}
      WHERE TaskId = @taskId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update task."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/pending-tracking/:trackingItemId/tasks/:taskId?companyId=
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ trackingItemId: string; taskId: string }> }
) {
  try {
    const { trackingItemId: tidParam, taskId: kidParam } = await context.params
    const trackingItemId = Number(tidParam)
    const taskId = Number(kidParam)
    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(trackingItemId) || !Number.isFinite(taskId) || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("taskId", sql.Int, taskId)
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    await req.query(`
      DELETE FROM dbo.ResidentTask
      WHERE TaskId = @taskId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete task."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
