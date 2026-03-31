import { NextResponse } from "next/server"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import {
  applyGridRequestInputs,
  buildGridColumnMetadataFromFields,
  buildGridDataSql,
  hasIsHotCaseColumn,
  loadGridFieldMetadata,
  type GridQueryParams,
} from "@/lib/pending-tracking/grid-sql"
import { mapGridRowWithFieldMetadata } from "@/lib/pending-tracking/map-row"
import { isValidViewTypeParam } from "@/lib/pending-tracking/view-types"
import * as XLSX from "xlsx"

/**
 * GET /api/pending-tracking/export
 * Returns an .xlsx file with ALL rows (no pagination) for the current filters.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const companyIdRaw =
      url.searchParams.get("companyId") ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    const companyId = Number(companyIdRaw)
    if (!Number.isFinite(companyId)) {
      return NextResponse.json(
        { error: "companyId is required." },
        { status: 400 }
      )
    }

    const viewTypeRaw = url.searchParams.get("viewType")?.trim() ?? ""
    if (!viewTypeRaw || !isValidViewTypeParam(viewTypeRaw)) {
      return NextResponse.json(
        { error: "viewType is required and must be a valid value." },
        { status: 400 }
      )
    }
    const viewType = viewTypeRaw

    const stateRaw = url.searchParams.get("state")?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null

    const search = url.searchParams.get("search")
    const facilityId = url.searchParams.get("facilityId")
    const status = url.searchParams.get("status")

    // Use a very large pageSize and page 1 to fetch all rows
    const params: GridQueryParams = {
      companyId,
      viewType,
      state,
      search,
      facilityId,
      status,
      page: 1,
      pageSize: 100_000,
      sortBy: "trackingItemId",
      sortDirection: "asc",
    }

    const pool = await getTrackingPool()
    const fields = await loadGridFieldMetadata(pool, companyId, viewType, state)

    if (fields.length === 0) {
      return NextResponse.json(
        { error: "No fields configured for export." },
        { status: 400 }
      )
    }

    const columns = buildGridColumnMetadataFromFields(fields)
    const includeHotCase = await hasIsHotCaseColumn(pool)
    const { sql: dataSql } = buildGridDataSql(fields, params, includeHotCase)

    const dataRequest = pool.request()
    applyGridRequestInputs(dataRequest, params)
    const dataResult = await dataRequest.query<Record<string, unknown>>(dataSql)

    const rows = dataResult.recordset.map((r: Record<string, unknown>) =>
      mapGridRowWithFieldMetadata(r, fields)
    )

    // Build header row using column titles
    const headers = columns.map((c) => c.title)
    if (includeHotCase) {
      headers.push("Hot Case")
    }

    // Build data rows in same column order
    const sheetData = rows.map((row: Record<string, unknown>) => {
      const values: unknown[] = columns.map((c) => {
        const val = row[c.key]
        if (val === null || val === undefined) return ""
        if (c.type === "boolean") return val === true || val === "true" ? "Yes" : "No"
        return val
      })
      if (includeHotCase) {
        values.push(row.isHotCase ? "Yes" : "No")
      }
      return values
    })

    // Create workbook
    const wsData = [headers, ...sheetData]
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Auto-size columns
    ws["!cols"] = headers.map((h: string, i: number) => {
      let maxLen = h.length
      for (const row of sheetData) {
        const cellLen = String(row[i] ?? "").length
        if (cellLen > maxLen) maxLen = cellLen
      }
      return { wch: Math.min(maxLen + 2, 50) }
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, viewType)

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    const filename = `${viewType.replace(/[^a-zA-Z0-9]/g, "_")}_export_${new Date().toISOString().slice(0, 10)}.xlsx`

    return new Response(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Export failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
