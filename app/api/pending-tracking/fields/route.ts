import { NextResponse } from "next/server"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import {
  SCREEN_DETAIL,
  SCREEN_MAIN,
  loadFieldMetadataForScreen,
} from "@/lib/pending-tracking/field-metadata"

/**
 * GET /api/pending-tracking/fields?companyId=&payerType=&state=&screenLocation=Main|Detail
 * Resolved field list for forms (same rules as grid/detail).
 */
export async function GET(request: Request) {
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

    const payerType = url.searchParams.get("payerType")?.trim() ?? ""
    if (!payerType) {
      return NextResponse.json(
        { error: "payerType is required" },
        { status: 400 }
      )
    }

    const stateRaw = url.searchParams.get("state")?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null

    const locRaw = url.searchParams.get("screenLocation")?.trim() ?? "Main"
    const screenLocation =
      locRaw.toLowerCase() === "detail" ? SCREEN_DETAIL : SCREEN_MAIN

    const pool = await getTrackingPool()
    const fields = await loadFieldMetadataForScreen(pool, {
      companyId,
      payerType,
      state,
      screenLocation,
    })

    return NextResponse.json({
      fields: fields.map((f) => ({
        fieldMetadataId: f.FieldMetadataId,
        fieldName: f.FieldName,
        displayName: f.DisplayName,
        dataType: f.DataType,
        screenLocation: f.ScreenLocation,
        displayOrder: f.DisplayOrder,
        isRequired: f.IsRequired,
        isEditable: f.IsEditable,
        isSystemField: f.IsSystemField,
        sourceType: f.SourceType,
        sourceColumnName: f.SourceColumnName,
      })),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load fields."
    return NextResponse.json({ error: message, fields: [] }, { status: 500 })
  }
}
