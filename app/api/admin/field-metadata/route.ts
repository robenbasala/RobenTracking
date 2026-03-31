import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import { hasModalSectionIdColumn } from "@/lib/pending-tracking/field-metadata"

type FieldMetaApi = {
  fieldMetadataId: number
  companyId: number
  fieldName: string
  displayName: string
  dataType: string
  screenLocation: string
  displayOrder: number
  isActive: boolean
  isRequired: boolean
  isEditable: boolean
  isSystemField: boolean
  sourceType: string
  sourceColumnName: string | null
  modalSectionId: number | null
  /** PendingTrackingItem.ViewType values (stored in FieldMetadataPayerType.PayerType) */
  viewTypes: string[]
  states: string[]
}

/**
 * GET /api/admin/field-metadata?companyId=
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
    const hasMSI = await hasModalSectionIdColumn(pool)
    const msiCol = hasMSI ? ", ModalSectionId" : ", NULL AS ModalSectionId"
    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    const fmResult = await req.query<Record<string, unknown>>(`
      SELECT
        FieldMetadataId, CompanyId, FieldName, DisplayName, DataType, ScreenLocation,
        DisplayOrder, IsActive, IsRequired, IsEditable, IsSystemField, SourceType,
        SourceColumnName${msiCol}
      FROM dbo.FieldMetadata
      WHERE CompanyId = @companyId
      ORDER BY ScreenLocation, DisplayOrder, FieldMetadataId
    `)

    const vtReq = pool.request()
    vtReq.input("companyId", sql.Int, companyId)
    const vtCompany = await vtReq.query<{ ViewType: string }>(`
      SELECT DISTINCT LTRIM(RTRIM(ti.ViewType)) AS ViewType
      FROM dbo.PendingTrackingItem ti
      WHERE ti.CompanyId = @companyId
        AND ti.IsActive = 1
        AND ti.ViewType IS NOT NULL
        AND LTRIM(RTRIM(ti.ViewType)) <> N''
      ORDER BY ViewType
    `)
    const companyViewTypes = vtCompany.recordset.map((r) => String(r.ViewType))

    const ids = fmResult.recordset.map((r) => r.FieldMetadataId as number)
    const viewTypeMap = new Map<number, string[]>()
    const stateMap = new Map<number, string[]>()

    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `@id${i}`).join(", ")
      const r2 = pool.request()
      ids.forEach((id, i) => r2.input(`id${i}`, sql.Int, id))
      const pt = await r2.query<{ FieldMetadataId: number; PayerType: string }>(`
        SELECT FieldMetadataId, PayerType FROM dbo.FieldMetadataPayerType
        WHERE FieldMetadataId IN (${placeholders})
      `)
      for (const row of pt.recordset) {
        const list = viewTypeMap.get(row.FieldMetadataId) ?? []
        list.push(row.PayerType)
        viewTypeMap.set(row.FieldMetadataId, list)
      }

      const r3 = pool.request()
      ids.forEach((id, i) => r3.input(`id${i}`, sql.Int, id))
      const st = await r3.query<{ FieldMetadataId: number; State: string }>(`
        SELECT FieldMetadataId, State FROM dbo.FieldMetadataState
        WHERE FieldMetadataId IN (${placeholders})
      `)
      for (const row of st.recordset) {
        const list = stateMap.get(row.FieldMetadataId) ?? []
        list.push(String(row.State).trim())
        stateMap.set(row.FieldMetadataId, list)
      }
    }

    const fields: FieldMetaApi[] = fmResult.recordset.map((r) => {
      const id = r.FieldMetadataId as number
      return {
        fieldMetadataId: id,
        companyId: r.CompanyId as number,
        fieldName: String(r.FieldName),
        displayName: String(r.DisplayName),
        dataType: String(r.DataType),
        screenLocation: String(r.ScreenLocation),
        displayOrder: Number(r.DisplayOrder),
        isActive: Boolean(r.IsActive),
        isRequired: Boolean(r.IsRequired),
        isEditable: Boolean(r.IsEditable),
        isSystemField: Boolean(r.IsSystemField),
        sourceType: String(r.SourceType),
        sourceColumnName: r.SourceColumnName ? String(r.SourceColumnName) : null,
        modalSectionId: r.ModalSectionId != null ? Number(r.ModalSectionId) : null,
        viewTypes: viewTypeMap.get(id) ?? [],
        states: stateMap.get(id) ?? [],
      }
    })

    return NextResponse.json({ fields, companyViewTypes })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load field metadata."
    return NextResponse.json({ error: message, fields: [] }, { status: 500 })
  }
}

/**
 * POST /api/admin/field-metadata — create custom field
 * Body: { companyId, fieldName, ... viewTypes?: string[] } (ViewType = PendingTrackingItem.ViewType; same as stored PayerType column)
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      companyId?: number
      fieldName?: string
      displayName?: string
      dataType?: string
      screenLocation?: string
      displayOrder?: number
      isActive?: boolean
      isRequired?: boolean
      isEditable?: boolean
      viewTypes?: string[]
      payerTypes?: string[]
      states?: string[]
    }

    const companyId = Number(body.companyId)
    const fieldName = body.fieldName?.trim() ?? ""
    const displayName = body.displayName?.trim() ?? ""
    const dataType = body.dataType?.trim() ?? "text"
    const sl = body.screenLocation?.trim() ?? ""
    const screenLocation: "Main" | "Detail" | "Both" =
      sl === "Detail" ? "Detail" : sl === "Both" ? "Both" : "Main"

    if (!Number.isFinite(companyId) || !fieldName || !displayName) {
      return NextResponse.json(
        { error: "companyId, fieldName, displayName required" },
        { status: 400 }
      )
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    req.input("fieldName", sql.NVarChar(128), fieldName)
    req.input("displayName", sql.NVarChar(256), displayName)
    req.input("dataType", sql.NVarChar(50), dataType)
    req.input("screenLocation", sql.NVarChar(20), screenLocation)
    req.input("displayOrder", sql.Int, body.displayOrder ?? 0)
    const isActive = body.isActive !== undefined ? (body.isActive ? 1 : 0) : 1
    const isRequired = body.isRequired !== undefined ? (body.isRequired ? 1 : 0) : 0
    const isEditable = body.isEditable !== undefined ? (body.isEditable ? 1 : 0) : 1
    req.input("isActive", sql.Bit, isActive)
    req.input("isRequired", sql.Bit, isRequired)
    req.input("isEditable", sql.Bit, isEditable)

    const insertResult = await req.query<{ FieldMetadataId: number }>(`
      INSERT INTO dbo.FieldMetadata (
        CompanyId, FieldName, DisplayName, DataType, ScreenLocation, DisplayOrder,
        IsActive, IsRequired, IsEditable, IsSystemField, SourceType, SourceColumnName
      )
      OUTPUT INSERTED.FieldMetadataId
      VALUES (
        @companyId, @fieldName, @displayName, @dataType, @screenLocation, @displayOrder,
        @isActive, @isRequired, @isEditable, 0, N'Custom', NULL
      )
    `)

    const fieldMetadataId = Number(insertResult.recordset[0]?.FieldMetadataId)
    if (!fieldMetadataId) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 })
    }

    const vt = body.viewTypes ?? body.payerTypes ?? []
    await replacePayerTypes(pool, fieldMetadataId, vt)
    await replaceStates(pool, fieldMetadataId, body.states ?? [])

    return NextResponse.json({ ok: true, fieldMetadataId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create field."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

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
