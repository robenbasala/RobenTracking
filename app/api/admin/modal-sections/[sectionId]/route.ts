import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * PATCH /api/admin/modal-sections/:sectionId
 * Body: { companyId, sectionName?, sectionType?, displayOrder?, isActive? }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { sectionId: idParam } = await context.params
    const sectionId = Number(idParam)
    if (!Number.isFinite(sectionId)) {
      return NextResponse.json({ error: "Invalid sectionId" }, { status: 400 })
    }

    const body = (await request.json()) as {
      companyId?: number
      sectionName?: string
      sectionType?: string
      displayOrder?: number
      isActive?: boolean
    }

    const companyId = Number(body.companyId)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("id", sql.Int, sectionId)
    req.input("companyId", sql.Int, companyId)

    const sets: string[] = []
    if (body.sectionName !== undefined) {
      req.input("sectionName", sql.NVarChar(128), body.sectionName.trim())
      sets.push("SectionName = @sectionName")
    }
    if (body.sectionType === "Standard" || body.sectionType === "LOCTracking") {
      req.input("sectionType", sql.NVarChar(50), body.sectionType)
      sets.push("SectionType = @sectionType")
    }
    if (body.displayOrder !== undefined) {
      req.input("displayOrder", sql.Int, body.displayOrder)
      sets.push("DisplayOrder = @displayOrder")
    }
    if (body.isActive !== undefined) {
      req.input("isActive", sql.Bit, body.isActive ? 1 : 0)
      sets.push("IsActive = @isActive")
    }

    if (sets.length > 0) {
      await req.query(`
        UPDATE dbo.ModalSection SET ${sets.join(", ")}
        WHERE ModalSectionId = @id AND CompanyId = @companyId
      `)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update section."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/modal-sections/:sectionId?companyId=
 * Nulls out FieldMetadata.ModalSectionId (via ON DELETE SET NULL) and deletes the section.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { sectionId: idParam } = await context.params
    const sectionId = Number(idParam)
    if (!Number.isFinite(sectionId)) {
      return NextResponse.json({ error: "Invalid sectionId" }, { status: 400 })
    }

    const url = new URL(request.url)
    const companyId = Number(
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("id", sql.Int, sectionId)
    req.input("companyId", sql.Int, companyId)
    await req.query(`
      DELETE FROM dbo.ModalSection
      WHERE ModalSectionId = @id AND CompanyId = @companyId
    `)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete section."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
