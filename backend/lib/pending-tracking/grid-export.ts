/**
 * Shared grid query for Excel / PDF exports (full result set, no paging).
 */
import type { ConnectionPool } from "mssql"
import {
  applyGridRequestInputs,
  buildGridColumnMetadataFromFields,
  buildGridDataSql,
  fetchDropdownOptionsForFields,
  hasIsHotCaseColumn,
  hasReportEligibleItemsTvf,
  loadGridFieldMetadata,
  type GridQueryParams,
} from "./grid-sql.js"
import { mapGridRowWithFieldMetadata } from "./map-row.js"
import type { GridColumnMeta } from "./types.js"

export type GridExportLoadResult = {
  columns: GridColumnMeta[]
  rows: Record<string, unknown>[]
  includeHotCase: boolean
}

export async function loadGridExportRows(
  pool: ConnectionPool,
  params: GridQueryParams,
  viewTypeRaw: string,
  state: string | null
): Promise<GridExportLoadResult | null> {
  const fields = await loadGridFieldMetadata(
    pool,
    params.companyId,
    viewTypeRaw,
    state
  )
  if (fields.length === 0) return null
  const columns = buildGridColumnMetadataFromFields(fields)
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
  const useReportEligibleTvf = await hasReportEligibleItemsTvf(pool)
  const { sql: dataSql } = buildGridDataSql(
    fields,
    params,
    includeHotCase,
    useReportEligibleTvf
  )
  const dataRequest = pool.request()
  applyGridRequestInputs(dataRequest, params)
  const dataResult = await dataRequest.query(dataSql)
  const rows = dataResult.recordset.map((r: Record<string, unknown>) =>
    mapGridRowWithFieldMetadata(r, fields)
  )
  return { columns, rows, includeHotCase }
}
