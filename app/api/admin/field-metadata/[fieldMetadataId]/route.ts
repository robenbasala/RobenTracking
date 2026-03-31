import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import { hasModalSectionIdColumn } from "@/lib/pending-tracking/field-metadata"

async function replacePayerTypes(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  fieldMetadataId: number,
  payerTypes: string[]
): Promise<void> {
  const r = pool.request()
  r.input("id", sql.Int, fieldMetadataId)
  await r.query(
    `DELETE FROM dbo.FieldMetadataPayerType WHERE FieldMetadataId = @id`
  )
  for (const pt of payerTypes) {
    const t = pt.trim()
    if (!t) continue
    const ins = pool.request()
    ins.input("id", sql.Int, fieldMetadataId)
    ins.input("pt", sql.NVarChar(100), t)
    await ins.query(`
      INSERT INTO dbo.FieldMetadataPayerType (FieldMetadataId, PayerType) VALUES (@id, @pt)
    `)
  }
}

async function replaceStates(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  fieldMetadataId: number,
  states: string[]
): Promise<void> {
  const r = pool.request()
  r.input("id", sql.Int, fieldMetadataId)
  await r.query(`DELETE FROM dbo.FieldMetadataState WHERE FieldMetadataId = @id`)
  for (const s of states) {
    const st = s.trim().toUpperCase().slice(0, 2)
    if (st.length !== 2) continue
    const ins = pool.request()
    ins.input("id", sql.Int, fieldMetadataId)
    ins.input("st", sql.Char(2), st)
    await ins.query(`
      INSERT INTO dbo.FieldMetadataState (FieldMetadataId, State) VALUES (@id, @st)
    `)
  }
}

/**
 * PATCH /api/admin/field-metadata/:fieldMetadataId
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ fieldMetadataId: string }> }
) {
  try {
    const { fieldMetadataId: idParam } = await context.params
    const fieldMetadataId = Number(idParam)
    if (!Number.isFinite(fieldMetadataId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 })
    }

    const body = (await request.json()) as {
      companyId?: number
      displayName?: string
      displayOrder?: number
      screenLocation?: string
      isActive?: boolean
      isRequired?: boolean
      isEditable?: boolean
      modalSectionId?: number | null
      /** PendingTrackingItem.ViewType values */
      viewTypes?: string[]
      payerTypes?: string[]
      states?: string[]
    }

    const companyId = Number(body.companyId)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: "companyId required" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("id", sql.Int, fieldMetadataId)
    req.input("companyId", sql.Int, companyId)

    const sets: string[] = []
    if (body.displayName !== undefined) {
      req.input("displayName", sql.NVarChar(256), body.displayName)
      sets.push("DisplayName = @displayName")
    }
    if (body.displayOrder !== undefined) {
      req.input("displayOrder", sql.Int, body.displayOrder)
      sets.push("DisplayOrder = @displayOrder")
    }
    if (
      body.screenLocation === "Detail" ||
      body.screenLocation === "Main" ||
      body.screenLocation === "Both"
    ) {
      req.input("screenLocation", sql.NVarChar(20), body.screenLocation)
      sets.push("ScreenLocation = @screenLocation")
    }
    if (body.isActive !== undefined) {
      req.input("isActive", sql.Bit, body.isActive ? 1 : 0)
      sets.push("IsActive = @isActive")
    }
    if (body.isRequired !== undefined) {
      req.input("isRequired", sql.Bit, body.isRequired ? 1 : 0)
      sets.push("IsRequired = @isRequired")
    }
    if (body.isEditable !== undefined) {
      req.input("isEditable", sql.Bit, body.isEditable ? 1 : 0)
      sets.push("IsEditable = @isEditable")
    }
    if ("modalSectionId" in body && (await hasModalSectionIdColumn(pool))) {
      req.input(
        "modalSectionId",
        sql.Int,
        body.modalSectionId != null ? body.modalSectionId : null
      )
      sets.push("ModalSectionId = @modalSectionId")
    }

    if (sets.length > 0) {
      await req.query(`
        UPDATE dbo.FieldMetadata SET ${sets.join(", ")}
        WHERE FieldMetadataId = @id AND CompanyId = @companyId
      `)
    }

    const vt = body.viewTypes ?? body.payerTypes
    if (vt) {
      await replacePayerTypes(pool, fieldMetadataId, vt)
    }
    if (body.states) {
      await replaceStates(pool, fieldMetadataId, body.states)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update field."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
