import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * PATCH /api/admin/field-metadata/:fieldMetadataId/options/:optionId
 * Update a dropdown option
 * Body: { optionValue?: string, optionLabel?: string, displayOrder?: number, isActive?: boolean }
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ fieldMetadataId: string; optionId: string }> }
) {
  try {
    const { fieldMetadataId: fmIdParam, optionId: opIdParam } = await context.params
    const fieldMetadataId = Number(fmIdParam)
    const optionId = Number(opIdParam)
    if (!Number.isFinite(fieldMetadataId) || !Number.isFinite(optionId)) {
      return NextResponse.json({ error: "Invalid IDs" }, { status: 400 })
    }

    const body = (await request.json()) as {
      optionValue?: string
      optionLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("optionId", sql.Int, optionId)
    req.input("fieldMetadataId", sql.Int, fieldMetadataId)

    // Build dynamic UPDATE based on what was provided
    const updates: string[] = []
    if (body.optionValue !== undefined) {
      const val = body.optionValue?.trim() ?? ""
      if (!val) {
        return NextResponse.json(
          { error: "optionValue cannot be empty" },
          { status: 400 }
        )
      }
      updates.push("OptionValue = @optionValue")
      req.input("optionValue", sql.NVarChar(500), val)
    }
    if (body.optionLabel !== undefined) {
      updates.push("OptionLabel = @optionLabel")
      req.input("optionLabel", sql.NVarChar(500), body.optionLabel?.trim() ?? null)
    }
    if (body.displayOrder !== undefined) {
      updates.push("DisplayOrder = @displayOrder")
      req.input("displayOrder", sql.Int, body.displayOrder)
    }
    if (body.isActive !== undefined) {
      updates.push("IsActive = @isActive")
      req.input("isActive", sql.Bit, body.isActive ? 1 : 0)
    }

    if (updates.length === 0) {
      return NextResponse.json({ ok: true })
    }

    const result = await req.query(`
      UPDATE dbo.FieldMetadataOption
      SET ${updates.join(", ")}
      WHERE FieldOptionId = @optionId AND FieldMetadataId = @fieldMetadataId
    `)

    if (result.rowsAffected[0] === 0) {
      return NextResponse.json({ error: "Option not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update option."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/field-metadata/:fieldMetadataId/options/:optionId
 * Delete a dropdown option
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ fieldMetadataId: string; optionId: string }> }
) {
  try {
    const { fieldMetadataId: fmIdParam, optionId: opIdParam } = await context.params
    const fieldMetadataId = Number(fmIdParam)
    const optionId = Number(opIdParam)
    if (!Number.isFinite(fieldMetadataId) || !Number.isFinite(optionId)) {
      return NextResponse.json({ error: "Invalid IDs" }, { status: 400 })
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("optionId", sql.Int, optionId)
    req.input("fieldMetadataId", sql.Int, fieldMetadataId)

    const result = await req.query(`
      DELETE FROM dbo.FieldMetadataOption
      WHERE FieldOptionId = @optionId AND FieldMetadataId = @fieldMetadataId
    `)

    if (result.rowsAffected[0] === 0) {
      return NextResponse.json({ error: "Option not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete option."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
