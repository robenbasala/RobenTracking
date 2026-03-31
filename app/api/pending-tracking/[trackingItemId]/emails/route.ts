import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * GET /api/pending-tracking/:trackingItemId/emails?companyId=
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
    // Check which optional columns exist (Body/CcEmails added in 007)
    const colCheck = await pool.request().query(`
      SELECT name FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name IN (N'Body', N'CcEmails')
    `)
    const existingCols = new Set(colCheck.recordset.map((r: { name: string }) => r.name))
    const bodyCol = existingCols.has("Body") ? ", Body" : ", NULL AS Body"
    const ccCol = existingCols.has("CcEmails") ? ", CcEmails" : ", NULL AS CcEmails"

    const result = await req.query<{
      EmailId: number
      Subject: string
      Body: string | null
      RecipientEmail: string
      RecipientName: string | null
      CcEmails: string | null
      SentAt: Date
      SentBy: string | null
      Status: string
      ExternalMessageId: string | null
    }>(`
      SELECT EmailId, Subject${bodyCol}, RecipientEmail, RecipientName${ccCol}, SentAt, SentBy, Status, ExternalMessageId
      FROM dbo.ResidentEmail
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId
      ORDER BY SentAt DESC
    `)

    const emails = result.recordset.map((r) => ({
      emailId: r.EmailId,
      subject: r.Subject,
      body: r.Body ?? null,
      recipientEmail: r.RecipientEmail,
      recipientName: r.RecipientName,
      ccEmails: r.CcEmails ?? null,
      sentAt: (r.SentAt instanceof Date ? r.SentAt : new Date(r.SentAt)).toISOString(),
      sentBy: r.SentBy,
      status: r.Status,
      externalMessageId: r.ExternalMessageId,
    }))

    return NextResponse.json({ emails })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load emails."
    return NextResponse.json({ error: message, emails: [] }, { status: 500 })
  }
}

/**
 * POST /api/pending-tracking/:trackingItemId/emails
 * Logs email metadata (send is handled by external API).
 * Body: { companyId, subject, recipientEmail, recipientName?, status?, externalMessageId? }
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
      subject?: string
      body?: string | null
      recipientEmail?: string
      recipientName?: string | null
      ccEmails?: string | null
      status?: string
      externalMessageId?: string | null
    }

    const companyId = Number(body.companyId)
    const subject = body.subject?.trim() ?? ""
    const recipientEmail = body.recipientEmail?.trim() ?? ""
    if (!Number.isFinite(companyId) || !subject || !recipientEmail) {
      return NextResponse.json(
        { error: "companyId, subject, recipientEmail required" },
        { status: 400 }
      )
    }

    const validStatuses = ["Sent", "Failed", "Queued"]
    const rawStatus = body.status?.trim() ?? ""
    const status = validStatuses.includes(rawStatus) ? rawStatus : "Queued"

    const pool = await getTrackingPool()

    // Check which optional columns exist (Body/CcEmails added in 007)
    const colCheck2 = await pool.request().query(`
      SELECT name FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name IN (N'Body', N'CcEmails')
    `)
    const postCols = new Set(colCheck2.recordset.map((r: { name: string }) => r.name))
    const hasBody = postCols.has("Body")
    const hasCc = postCols.has("CcEmails")

    const req = pool.request()
    req.input("trackingItemId", sql.Int, trackingItemId)
    req.input("companyId", sql.Int, companyId)
    req.input("subject", sql.NVarChar(500), subject)
    req.input("recipientEmail", sql.NVarChar(500), recipientEmail)
    req.input("recipientName", sql.NVarChar(256), body.recipientName ?? null)
    req.input("sentBy", sql.NVarChar(256), "system")
    req.input("status", sql.NVarChar(50), status)
    req.input("externalMessageId", sql.NVarChar(500), body.externalMessageId ?? null)

    // Build INSERT dynamically based on which columns exist
    const insertCols = ["TrackingItemId", "CompanyId", "Subject", "RecipientEmail", "RecipientName", "SentBy", "Status", "ExternalMessageId"]
    const insertVals = ["@trackingItemId", "@companyId", "@subject", "@recipientEmail", "@recipientName", "@sentBy", "@status", "@externalMessageId"]
    if (hasBody) {
      req.input("emailBody", sql.NVarChar(sql.MAX), body.body ?? null)
      insertCols.push("Body")
      insertVals.push("@emailBody")
    }
    if (hasCc) {
      req.input("ccEmails", sql.NVarChar(sql.MAX), body.ccEmails ?? null)
      insertCols.push("CcEmails")
      insertVals.push("@ccEmails")
    }

    const result = await req.query<{ EmailId: number }>(`
      INSERT INTO dbo.ResidentEmail (${insertCols.join(", ")})
      OUTPUT INSERTED.EmailId
      VALUES (${insertVals.join(", ")})
    `)

    const emailId = Number(result.recordset[0]?.EmailId)
    return NextResponse.json({ ok: true, emailId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to log email."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
