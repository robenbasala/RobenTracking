import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

type FieldOption = {
  fieldOptionId: number
  optionValue: string
  optionLabel: string | null
  displayOrder: number
  isActive: boolean
}

/**
 * GET /api/admin/field-metadata/:fieldMetadataId/options
 * Returns all dropdown options for a field
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ fieldMetadataId: string }> }
) {
  try {
    const { fieldMetadataId: idParam } = await context.params
    const fieldMetadataId = Number(idParam)
    if (!Number.isFinite(fieldMetadataId)) {
      return NextResponse.json({ error: "Invalid fieldMetadataId" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("fieldMetadataId", sql.Int, fieldMetadataId)
    const result = await req.query<Record<string, unknown>>(`
      SELECT FieldOptionId, OptionValue, OptionLabel, DisplayOrder, IsActive
      FROM dbo.FieldMetadataOption
      WHERE FieldMetadataId = @fieldMetadataId
      ORDER BY DisplayOrder, FieldOptionId
    `)

    const options: FieldOption[] = result.recordset.map((r) => ({
      fieldOptionId: r.FieldOptionId as number,
      optionValue: String(r.OptionValue),
      optionLabel: r.OptionLabel ? String(r.OptionLabel) : null,
      displayOrder: Number(r.DisplayOrder),
      isActive: Boolean(r.IsActive),
    }))

    return NextResponse.json({ options })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load options."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/admin/field-metadata/:fieldMetadataId/options
 * Create a new dropdown option
 * Body: { optionValue: string, optionLabel?: string, displayOrder?: number }
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ fieldMetadataId: string }> }
) {
  try {
    const { fieldMetadataId: idParam } = await context.params
    const fieldMetadataId = Number(idParam)
    if (!Number.isFinite(fieldMetadataId)) {
      return NextResponse.json({ error: "Invalid fieldMetadataId" }, { status: 400 })
    }

    const body = (await request.json()) as {
      optionValue?: string
      optionLabel?: string | null
      displayOrder?: number
    }

    const optionValue = body.optionValue?.trim() ?? ""
    if (!optionValue) {
      return NextResponse.json(
        { error: "optionValue is required" },
        { status: 400 }
      )
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("fieldMetadataId", sql.Int, fieldMetadataId)
    req.input("optionValue", sql.NVarChar(500), optionValue)
    req.input("optionLabel", sql.NVarChar(500), body.optionLabel?.trim() ?? null)
    req.input("displayOrder", sql.Int, body.displayOrder ?? 0)

    const result = await req.query<{ FieldOptionId: number }>(`
      INSERT INTO dbo.FieldMetadataOption (FieldMetadataId, OptionValue, OptionLabel, DisplayOrder, IsActive)
      OUTPUT INSERTED.FieldOptionId
      VALUES (@fieldMetadataId, @optionValue, @optionLabel, @displayOrder, 1)
    `)

    const fieldOptionId = Number(result.recordset[0]?.FieldOptionId)
    if (!fieldOptionId) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, fieldOptionId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create option."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
