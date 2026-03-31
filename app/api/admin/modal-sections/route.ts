import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * GET /api/admin/modal-sections?companyId=
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    const result = await req.query<{
      ModalSectionId: number
      SectionName: string
      SectionType: string
      DisplayOrder: number
      IsActive: boolean
    }>(`
      SELECT ModalSectionId, SectionName, SectionType, DisplayOrder, IsActive
      FROM dbo.ModalSection
      WHERE CompanyId = @companyId
      ORDER BY DisplayOrder, ModalSectionId
    `)

    const sections = result.recordset.map((r) => ({
      modalSectionId: r.ModalSectionId,
      sectionName: r.SectionName,
      sectionType: r.SectionType,
      displayOrder: r.DisplayOrder,
      isActive: Boolean(r.IsActive),
    }))

    return NextResponse.json({ sections })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load sections."
    return NextResponse.json({ error: message, sections: [] }, { status: 500 })
  }
}

/**
 * POST /api/admin/modal-sections
 * Body: { companyId, sectionName, sectionType?, displayOrder? }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      companyId?: number
      sectionName?: string
      sectionType?: string
      displayOrder?: number
    }

    const companyId = Number(body.companyId)
    const sectionName = body.sectionName?.trim() ?? ""
    if (!Number.isFinite(companyId) || !sectionName) {
      return NextResponse.json({ error: "companyId, sectionName required" }, { status: 400 })
    }

    const rawType = body.sectionType?.trim() ?? ""
    const sectionType = rawType === "LOCTracking" ? "LOCTracking" : "Standard"
    const displayOrder = body.displayOrder ?? 0

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    req.input("sectionName", sql.NVarChar(128), sectionName)
    req.input("sectionType", sql.NVarChar(50), sectionType)
    req.input("displayOrder", sql.Int, displayOrder)

    const result = await req.query<{ ModalSectionId: number }>(`
      INSERT INTO dbo.ModalSection (CompanyId, SectionName, SectionType, DisplayOrder)
      OUTPUT INSERTED.ModalSectionId
      VALUES (@companyId, @sectionName, @sectionType, @displayOrder)
    `)

    const modalSectionId = Number(result.recordset[0]?.ModalSectionId)
    if (!modalSectionId) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, modalSectionId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create section."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
