import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * GET /api/pending-tracking/:trackingItemId/attachments?companyId=
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
      AttachmentId: number
      FileName: string
      ContentType: string
      FileSizeBytes: number | null
      BlobUrl: string
      UploadedAt: Date
      UploadedBy: string | null
      Description: string | null
    }>(`
      SELECT AttachmentId, FileName, ContentType, FileSizeBytes, BlobUrl,
             UploadedAt, UploadedBy, Description
      FROM dbo.ResidentAttachment
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId AND IsDeleted = 0
      ORDER BY UploadedAt DESC
    `)

    const attachments = result.recordset.map((r) => ({
      attachmentId: r.AttachmentId,
      fileName: r.FileName,
      contentType: r.ContentType,
      fileSizeBytes: r.FileSizeBytes,
      blobUrl: r.BlobUrl,
      uploadedAt: (r.UploadedAt instanceof Date ? r.UploadedAt : new Date(r.UploadedAt)).toISOString(),
      uploadedBy: r.UploadedBy,
      description: r.Description,
    }))

    return NextResponse.json({ attachments })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load attachments."
    return NextResponse.json({ error: message, attachments: [] }, { status: 500 })
  }
}

/**
 * POST /api/pending-tracking/:trackingItemId/attachments
 * Logs attachment metadata after file has been uploaded to Azure Blob.
 * Body: { companyId, fileName, contentType, fileSizeBytes?, blobUrl, blobContainer, blobName, description? }
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
      fileName?: string
      contentType?: string
      fileSizeBytes?: number | null
      blobUrl?: string
      blobContainer?: string
      blobName?: string
      description?: string | null
    }

    const companyId = Number(body.companyId)
    const fileName = body.fileName?.trim() ?? ""
    const contentType = body.contentType?.trim() ?? "application/octet-stream"
    const blobUrl = body.blobUrl?.trim() ?? ""
    const blobContainer = body.blobContainer?.trim() ?? ""
    const blobName = body.blobName?.trim() ?? ""

    if (!Number.isFinite(companyId) || !fileName || !blobUrl || !blobContainer || !blobName) {
      return NextResponse.json(
        { error: "companyId, fileName, blobUrl, blobContainer, blobName required" },
        { status: 400 }
      )
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    req.input("fileName", sql.NVarChar(500), fileName)
    req.input("contentType", sql.NVarChar(200), contentType)
    req.input("fileSizeBytes", sql.BigInt, body.fileSizeBytes ?? null)
    req.input("blobUrl", sql.NVarChar(2000), blobUrl)
    req.input("blobContainer", sql.NVarChar(256), blobContainer)
    req.input("blobName", sql.NVarChar(1000), blobName)
    req.input("uploadedBy", sql.NVarChar(256), "system")
    req.input("description", sql.NVarChar(1000), body.description ?? null)

    const result = await req.query<{ AttachmentId: number }>(`
      INSERT INTO dbo.ResidentAttachment
        (TrackingItemId, CompanyId, FileName, ContentType, FileSizeBytes,
         BlobUrl, BlobContainer, BlobName, UploadedBy, Description)
      OUTPUT INSERTED.AttachmentId
      VALUES
        (@trackingItemId, @companyId, @fileName, @contentType, @fileSizeBytes,
         @blobUrl, @blobContainer, @blobName, @uploadedBy, @description)
    `)

    const attachmentId = Number(result.recordset[0]?.AttachmentId)
    return NextResponse.json({ ok: true, attachmentId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to log attachment."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
