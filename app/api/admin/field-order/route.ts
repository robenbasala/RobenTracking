import { NextResponse } from "next/server"
import sql from "mssql"
import { getTrackingPool } from "@/lib/pending-tracking/db"

/**
 * GET /api/admin/field-order?companyId=&viewType=
 * Returns all fields with their effective display order for the given viewType.
 * If viewType is empty, returns global (default) order from FieldMetadata.DisplayOrder.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const companyIdRaw =
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    const companyId = Number(companyIdRaw)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json(
        { error: "companyId is required (or set TRACKING_DEFAULT_COMPANY_ID)." },
        { status: 400 }
      )
    }

    const viewType = url.searchParams.get("viewType")?.trim() ?? null

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    req.input("viewType", sql.NVarChar(100), viewType)

    const sqlText = viewType
      ? `
        SELECT
          fm.FieldMetadataId,
          fm.FieldName,
          fm.DisplayName,
          COALESCE(vto.DisplayOrder, fm.DisplayOrder) AS DisplayOrder
        FROM dbo.FieldMetadata fm
        LEFT JOIN dbo.FieldMetadataViewOrder vto
          ON vto.FieldMetadataId = fm.FieldMetadataId AND vto.ViewType = @viewType
        WHERE fm.CompanyId = @companyId
          AND fm.IsActive = 1
        ORDER BY COALESCE(vto.DisplayOrder, fm.DisplayOrder) ASC, fm.FieldMetadataId ASC
      `
      : `
        SELECT
          fm.FieldMetadataId,
          fm.FieldName,
          fm.DisplayName,
          fm.DisplayOrder
        FROM dbo.FieldMetadata fm
        WHERE fm.CompanyId = @companyId
          AND fm.IsActive = 1
        ORDER BY fm.DisplayOrder ASC, fm.FieldMetadataId ASC
      `

    type FieldOrderRow = {
      FieldMetadataId: number
      FieldName: string
      DisplayName: string
      DisplayOrder: number
    }

    const result = await req.query<FieldOrderRow>(sqlText)
    const fields = result.recordset.map((row) => ({
      fieldMetadataId: row.FieldMetadataId,
      fieldName: row.FieldName,
      displayName: row.DisplayName,
      displayOrder: row.DisplayOrder,
    }))

    return NextResponse.json({ fields })
  } catch (error) {
    console.error("field-order GET error:", error)
    return NextResponse.json(
      { error: "Failed to fetch field order" },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/admin/field-order
 * Saves display order. If viewType is null, updates FieldMetadata.DisplayOrder (global).
 * If viewType is set, upserts into FieldMetadataViewOrder.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as {
      companyId: number
      viewType: string | null
      fields: { fieldMetadataId: number; displayOrder: number }[]
    }

    const { companyId, viewType, fields } = body
    if (!Number.isFinite(companyId) || !Array.isArray(fields)) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    const pool = await getTrackingPool()

    if (!viewType) {
      // Update global display order in FieldMetadata
      for (const field of fields) {
        const req = pool.request()
        req.input("id", sql.Int, field.fieldMetadataId)
        req.input("order", sql.Int, field.displayOrder)
        req.input("companyId", sql.Int, companyId)
        await req.query(
          `UPDATE dbo.FieldMetadata
           SET DisplayOrder = @order
           WHERE FieldMetadataId = @id AND CompanyId = @companyId`
        )
      }
    } else {
      // Upsert into FieldMetadataViewOrder
      for (const field of fields) {
        const req = pool.request()
        req.input("fieldId", sql.Int, field.fieldMetadataId)
        req.input("viewType", sql.NVarChar(100), viewType)
        req.input("order", sql.Int, field.displayOrder)
        await req.query(
          `MERGE INTO dbo.FieldMetadataViewOrder AS target
           USING (SELECT @fieldId AS FieldMetadataId, @viewType AS ViewType) AS source
           ON target.FieldMetadataId = source.FieldMetadataId AND target.ViewType = source.ViewType
           WHEN MATCHED THEN
             UPDATE SET DisplayOrder = @order
           WHEN NOT MATCHED THEN
             INSERT (FieldMetadataId, ViewType, DisplayOrder)
             VALUES (source.FieldMetadataId, source.ViewType, @order);`
        )
      }

      // Delete any view-type orders not in the submitted list (reset to global)
      const submittedIds = fields.map((f) => f.fieldMetadataId)
      if (submittedIds.length > 0) {
        const req = pool.request()
        req.input("viewType", sql.NVarChar(100), viewType)
        const idList = submittedIds.map((_, i) => `@id${i}`).join(",")
        submittedIds.forEach((id, i) => {
          req.input(`id${i}`, sql.Int, id)
        })
        await req.query(
          `DELETE FROM dbo.FieldMetadataViewOrder
           WHERE ViewType = @viewType AND FieldMetadataId NOT IN (${idList})`
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("field-order PUT error:", error)
    return NextResponse.json(
      { error: "Failed to save field order" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/admin/field-order?companyId=&viewType=
 * Clears all display order overrides for the given viewType (resets to global).
 */
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const companyIdRaw =
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    const companyId = Number(companyIdRaw)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    const viewType = url.searchParams.get("viewType")?.trim()
    if (!viewType) {
      return NextResponse.json(
        { error: "viewType is required for DELETE" },
        { status: 400 }
      )
    }

    const pool = await getTrackingPool()
    const req = pool.request()
    req.input("viewType", sql.NVarChar(100), viewType)
    await req.query(
      `DELETE FROM dbo.FieldMetadataViewOrder WHERE ViewType = @viewType`
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("field-order DELETE error:", error)
    return NextResponse.json(
      { error: "Failed to reset field order" },
      { status: 500 }
    )
  }
}
