import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * DELETE /api/pending-tracking/:trackingItemId/attachments/:attachmentId?companyId=
 * Soft-deletes (IsDeleted = 1). Caller is responsible for removing from Azure Blob if desired.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ trackingItemId: string; attachmentId: string }> }
) {
  try {
    const { trackingItemId: tidParam, attachmentId: aidParam } = await context.params
    const trackingItemId = Number(tidParam)
    const attachmentId = Number(aidParam)
    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(attachmentId) ||
      !Number.isFinite(companyId)
    ) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("attachmentId", sql.Int, attachmentId)
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    await req.query(`
      UPDATE dbo.ResidentAttachment SET IsDeleted = 1
      WHERE AttachmentId = @attachmentId
        AND TrackingItemId = @trackingItemId
        AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete attachment."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
