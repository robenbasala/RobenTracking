import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * PATCH /api/pending-tracking/:trackingItemId/notes/:noteId
 * Body: { companyId, body?, noteType? }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ trackingItemId: string; noteId: string }> }
) {
  try {
    const { trackingItemId: tidParam, noteId: nidParam } = await context.params
    const trackingItemId = Number(tidParam)
    const noteId = Number(nidParam)
    const json = (await request.json()) as {
      companyId?: number
      body?: string
      noteType?: string
    }
    const companyId = Number(
      json.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(noteId) ||
      !Number.isFinite(companyId)
    ) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 })
    }

    const sets: string[] = []
    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("noteId", sql.Int, noteId)
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)

    if (json.body != null) {
      sets.push("Body = @body")
      req.input("body", sql.NVarChar(sql.MAX), json.body)
    }
    if (json.noteType != null) {
      sets.push("NoteType = @noteType")
      req.input("noteType", sql.NVarChar(50), json.noteType)
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    await req.query(`
      UPDATE dbo.ResidentNote
      SET ${sets.join(", ")}
      WHERE NoteId = @noteId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update note."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/pending-tracking/:trackingItemId/notes/:noteId?companyId=
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ trackingItemId: string; noteId: string }> }
) {
  try {
    const { trackingItemId: tidParam, noteId: nidParam } = await context.params
    const trackingItemId = Number(tidParam)
    const noteId = Number(nidParam)
    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(trackingItemId) || !Number.isFinite(noteId) || !Number.isFinite(companyId)) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("noteId", sql.Int, noteId)
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    await req.query(`
      DELETE FROM dbo.ResidentNote
      WHERE NoteId = @noteId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete note."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
