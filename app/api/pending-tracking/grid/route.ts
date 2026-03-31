import { NextResponse } from "next/server"
import { getTrackingPool } from "@/lib/pending-tracking/db"
import {
  applyGridRequestInputs,
  buildGridColumnMetadataFromFields,
  buildGridCountSql,
  buildGridDataSql,
  fetchDropdownOptionsForFields,
  hasIsHotCaseColumn,
  loadGridFieldMetadata,
  type GridQueryParams,
} from "@/lib/pending-tracking/grid-sql"
import { mapGridRowWithFieldMetadata } from "@/lib/pending-tracking/map-row"
import type { PendingTrackingGridResponse } from "@/lib/pending-tracking/types"
import { isValidViewTypeParam } from "@/lib/pending-tracking/view-types"

/**
 * GET /api/pending-tracking/grid
 * Columns: active FieldMetadata for Main (and Both), displayOrder, filtered by ViewType + optional state.
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
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"))
    const pageSize = Math.min(
      200,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? "25"))
    )
    const sortBy = url.searchParams.get("sortBy") ?? "trackingItemId"
    const sortDirection =
      url.searchParams.get("sortDirection") === "desc" ? "desc" : "asc"

    const params: GridQueryParams = {
      companyId,
      viewType,
      state,
      search,
      facilityId,
      status,
      page,
      pageSize,
      sortBy,
      sortDirection,
    }

    const pool = await getTrackingPool()
    const fields = await loadGridFieldMetadata(pool, companyId, viewType, state)

    if (fields.length === 0) {
      return NextResponse.json(
        {
          columns: [],
          rows: [],
          totalCount: 0,
          page,
          pageSize,
          defaultSortKey: "trackingItemId",
          error:
            "No grid fields configured. Run sql/003-field-metadata-schema.sql and sql/004-seed-field-metadata-from-pending-tracking-item.sql, then set ScreenLocation = Main for columns to show.",
        } satisfies PendingTrackingGridResponse & { error?: string },
        { status: 200 }
      )
    }

    const columns = buildGridColumnMetadataFromFields(fields)
    const defaultSortKey = columns[0]?.key ?? "trackingItemId"

    // Fetch dropdown options for dropdown columns
    const dropdownColIds = columns
      .filter((c) => c.type === "dropdown")
      .map((c) => c.fieldMetadataId)
    if (dropdownColIds.length > 0) {
      const optionsMap = await fetchDropdownOptionsForFields(pool, dropdownColIds)
      for (const col of columns) {
        if (col.type === "dropdown") {
          col.dropdownOptions = optionsMap.get(col.fieldMetadataId) ?? []
        }
      }
    }

    const includeHotCase = await hasIsHotCaseColumn(pool)
    const { sql: dataSql } = buildGridDataSql(fields, params, includeHotCase)
    const countSql = buildGridCountSql()

    const dataRequest = pool.request()
    applyGridRequestInputs(dataRequest, params)
    const dataResult = await dataRequest.query<Record<string, unknown>>(dataSql)

    const countRequest = pool.request()
    applyGridRequestInputs(countRequest, params)
    const countResult = await countRequest.query<{ TotalCount: number }>(
      countSql
    )
    const totalCount = countResult.recordset[0]?.TotalCount ?? 0

    const rows = dataResult.recordset.map((r) =>
      mapGridRowWithFieldMetadata(r as Record<string, unknown>, fields)
    )

    const body: PendingTrackingGridResponse = {
      columns,
      rows,
      totalCount,
      page,
      pageSize,
      defaultSortKey,
    }

    return NextResponse.json(body)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load grid."
    return NextResponse.json(
      {
        columns: [],
        rows: [],
        totalCount: 0,
        page: 1,
        pageSize: 25,
        defaultSortKey: "trackingItemId",
        error: message,
      } satisfies PendingTrackingGridResponse & { error?: string },
      { status: 500 }
    )
  }
}
