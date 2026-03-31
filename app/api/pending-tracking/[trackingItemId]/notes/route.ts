import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * GET /api/pending-tracking/:trackingItemId/notes?companyId=
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
      NoteId: number
      NoteType: string
      Body: string
      CreatedAt: Date
      CreatedBy: string | null
    }>(`
      SELECT NoteId, NoteType, Body, CreatedAt, CreatedBy
      FROM dbo.ResidentNote
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId
      ORDER BY CreatedAt DESC
    `)

    const notes = result.recordset.map((r) => ({
      noteId: r.NoteId,
      noteType: r.NoteType,
      body: r.Body,
      createdAt: (r.CreatedAt instanceof Date ? r.CreatedAt : new Date(r.CreatedAt)).toISOString(),
      createdBy: r.CreatedBy,
    }))

    return NextResponse.json({ notes })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load notes."
    return NextResponse.json({ error: message, notes: [] }, { status: 500 })
  }
}

/**
 * POST /api/pending-tracking/:trackingItemId/notes
 * Body: { companyId, body, noteType? }
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

    const payload = (await request.json()) as {
      companyId?: number
      body?: string
      noteType?: string
    }

    const companyId = Number(payload.companyId)
    const body = payload.body?.trim() ?? ""
    if (!Number.isFinite(companyId) || !body) {
      return NextResponse.json({ error: "companyId, body required" }, { status: 400 })
    }

    const validTypes = ["CaseNote", "Internal", "External"]
    const rawType = payload.noteType?.trim() ?? ""
    const noteType = validTypes.includes(rawType) ? rawType : "CaseNote"

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    req.input("noteType", sql.NVarChar(50), noteType)
    req.input("body", sql.NVarChar(sql.MAX), body)
    req.input("createdBy", sql.NVarChar(256), "system")

    const result = await req.query<{ NoteId: number }>(`
      INSERT INTO dbo.ResidentNote (TrackingItemId, CompanyId, NoteType, Body, CreatedBy)
      OUTPUT INSERTED.NoteId
      VALUES (@trackingItemId, @companyId, @noteType, @body, @createdBy)
    `)

    const noteId = Number(result.recordset[0]?.NoteId)
    return NextResponse.json({ ok: true, noteId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create note."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
