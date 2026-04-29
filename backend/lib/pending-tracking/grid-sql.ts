/**
 * Grid SQL driven by dbo.FieldMetadata (Main screen).
 * Base fields → TrackingItemsTbl; custom → TrackingItemFieldValues + FieldMetadataOption.
 */
import sql from "mssql"
import type { ConnectionPool } from "mssql"
import {
  SCREEN_MAIN,
  TRACKING_ITEM_ID_FIELD_NAME,
  isCalculatedField,
  loadFieldMetadataForScreen,
  type FieldMetadataRow,
} from "./field-metadata"
import {
  SQL_FILTER_FACILITY_LIST_TI,
  sanitizeFacilityIdsForCsv,
} from "./facility-query.js"
import { gridColumnTitleFromFieldMetadata } from "./formatters"
import type { GridColumnMeta, GridColumnType } from "./types"

export { loadFieldMetadataForScreen, SCREEN_MAIN }

/** Safe T-SQL bracket identifier (FieldName / column name). */
export function isSafeFieldNameAlias(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 128 &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
  )
}

/**
 * Permissive alias check for user-defined FieldNames used as bracket-quoted SQL aliases.
 * Allows spaces (e.g. "Millionth day") since bracketQuoteIdentifier makes them safe.
 * SourceColumnName (actual DB columns) still uses the strict isSafeFieldNameAlias.
 */
function isSafeBracketAlias(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 128 &&
    /^[A-Za-z_][A-Za-z0-9_ ]*$/.test(name)
  )
}

function bracketQuoteIdentifier(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`
}

function mapDataTypeToColumnType(dataType: string): GridColumnType {
  const t = dataType.toLowerCase()
  if (t === "textarea") return "text"
  if (t.includes("dropdown")) return "dropdown"
  if (t.includes("boolean") || t === "bit") return "boolean"
  if (t.includes("date") || t.includes("time")) return "date"
  if (t.includes("currency") || t.includes("money")) return "currency"
  if (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("float") ||
    t.includes("number")
  )
    return "number"
  return "text"
}

function pascalToCamelKey(fieldName: string): string {
  if (!fieldName) return fieldName
  return fieldName.charAt(0).toLowerCase() + fieldName.slice(1)
}

/** Primary key on TrackingItemsTbl — always loaded for rows but not shown as a configurable column. */
export const CORE_TRACKING_ITEM_ID_FIELD = "TrackingItemId"

function fieldOpensResidentDetail(fieldName: string): boolean {
  return /^residentname$/i.test(fieldName.trim())
}

export function buildGridColumnMetadataFromFields(
  fields: FieldMetadataRow[]
): GridColumnMeta[] {
  return fields
    .filter(
      (f) =>
        isSafeBracketAlias(f.FieldName) &&
        f.FieldName !== TRACKING_ITEM_ID_FIELD_NAME
    )
    .map((f) => ({
      fieldName: f.FieldName,
      key: pascalToCamelKey(f.FieldName),
      title: gridColumnTitleFromFieldMetadata(f.DisplayName, f.FieldName),
      type: mapDataTypeToColumnType(f.DataType),
      isBase: f.SourceType === "BaseTable",
      order: f.DisplayOrder,
      fieldMetadataId: f.FieldMetadataId,
      sourceType: f.SourceType === "BaseTable" ? ("base" as const) : ("custom" as const),
      opensResidentDetail: fieldOpensResidentDetail(f.FieldName),
      isEditable:
        f.IsEditable && !f.IsSystemField && !isCalculatedField(f),
      ...(isCalculatedField(f) ? { isCalculated: true as const } : {}),
    }))
    .sort((a, b) => a.order - b.order)
}

function customResolvedExpression(dataType: string): string {
  const dt = dataType.toLowerCase()
  if (dt === "dropdown") {
    return `COALESCE(opt.OptionLabel, opt.OptionValue, N'')`
  }
  if (dt === "date" || dt === "datetime") {
    return `CONVERT(varchar(30), tfv.DateValue, 23)`
  }
  if (dt === "boolean" || dt === "bit") {
    return `CASE WHEN tfv.BooleanValue = 1 THEN N'true' ELSE N'false' END`
  }
  if (
    dt === "number" ||
    dt === "currency" ||
    dt === "money" ||
    dt === "decimal" ||
    dt === "float" ||
    dt === "int"
  ) {
    return `CAST(tfv.NumberValue AS varchar(100))`
  }
  return `ISNULL(tfv.TextValue, N'')`
}

export type GridQueryParams = {
  companyId: number
  datasetId: string
  /** Tab / report key; passed to dbo.fn_PendingTracking_ReportEligibleItems as @reportKey. */
  viewType: string
  /** US state (2-letter), optional — filters FieldMetadataState when set. */
  state: string | null
  search: string | null
  /** Empty = no facility restriction (all). */
  facilityIds: string[]
  status: string | null
  page: number
  pageSize: number
  sortBy: string
  sortDirection: "asc" | "desc"
  /** When true, include rows where TrackingItemsTbl.IsActive = 0. */
  includeInactive?: boolean
}

/**
 * Same row filter as dbo.trk_PendingTracking_ReportSelect (via dbo.fn_PendingTracking_ReportEligibleItems).
 * Deploy sql/012-pending-tracking-report-eligible-items.sql (after 010) so this object exists.
 */
const SQL_REPORT_ELIGIBLE_JOIN_TI = `
  INNER JOIN dbo.fn_PendingTracking_ReportEligibleItems(
    @reportKey, @companyId, @facilityIdList, @status, @search, @includeInactive
  ) rep ON rep.TrackingItemId = ti.TrackingItemId`

function activeRowFilterSql(includeInactive: boolean | undefined): string {
  if (includeInactive) return ""
  return "ti.IsActive = 1\n    AND "
}

/**
 * True if dbo.fn_PendingTracking_ReportEligibleItems exists (sql/012).
 * Not cached: after deploying SQL, the next grid request must see the object without API restart.
 */
export async function hasReportEligibleItemsTvf(
  pool: ConnectionPool
): Promise<boolean> {
  try {
    const r = await pool.request().query(`
      SELECT 1 AS x FROM sys.objects
      WHERE object_id = OBJECT_ID(N'dbo.fn_PendingTracking_ReportEligibleItems')
        AND type IN (N'IF', N'TF')
    `)
    return r.recordset.length > 0
  } catch {
    return false
  }
}

/** @deprecated No-op — detection is no longer cached. */
export function resetReportEligibleItemsTvfCache(): void {}

/**
 * True if dbo.trk_PendingTracking_ReportSelectItemIds exists (sql/012).
 * Not cached — deploy 012 and the grid can use INSERT…EXEC on the next request.
 */
export async function hasReportSelectItemIdsProcedure(
  pool: ConnectionPool
): Promise<boolean> {
  try {
    const r = await pool.request().query(`
      SELECT 1 AS x FROM sys.objects
      WHERE object_id = OBJECT_ID(N'dbo.trk_PendingTracking_ReportSelectItemIds')
        AND type = N'P'
    `)
    return r.recordset.length > 0
  } catch {
    return false
  }
}

/** @deprecated No-op — detection is no longer cached. */
export function resetReportSelectItemIdsProcedureCache(): void {}

/**
 * When true (default), the pending-tracking grid uses a batch that runs
 * dbo.trk_PendingTracking_ReportSelectItemIds via INSERT…EXEC (requires 012 on the DB).
 * Set TRACKING_GRID_USE_REPORT_ITEM_IDS_PROC=0 to force the TVF JOIN / legacy SQL path instead.
 */
export function useReportItemIdsProcedureForGrid(): boolean {
  const v = process.env.TRACKING_GRID_USE_REPORT_ITEM_IDS_PROC?.trim().toLowerCase()
  return v !== "0" && v !== "false" && v !== "no"
}

type GridReportFilterMode = "tvf" | "legacy" | "tempIds"

function buildGridPagedSelectSql(
  fields: FieldMetadataRow[],
  params: GridQueryParams,
  includeHotCase: boolean,
  filterMode: GridReportFilterMode
): { sql: string; orderByColumn: string } {
  const fieldSelect = buildFieldSelectFragments(fields)
  const hasCustom = fields.some(
    (f) => f.SourceType === "Custom" && !isCalculatedField(f)
  )
  const sortCol = validateSortColumnPascal(params.sortBy, fields)
  const orderByColumn = sortCol

  const tfvJoin = hasCustom
    ? `LEFT JOIN dbo.TrackingItemFieldValues tfv ON tfv.TrackingItemId = ti.TrackingItemId
  LEFT JOIN dbo.FieldMetadataOption opt ON opt.FieldOptionId = tfv.DropdownOptionId
    AND opt.FieldMetadataId = tfv.FieldMetadataId`
    : ""

  const rowStateSql = `MAX(CAST(ISNULL(ti.IsActive, 1) AS INT)) AS [IsActive],
    MAX(ti.StoppedAt) AS [StoppedAt],
    MAX(ti.StoppedBy) AS [StoppedBy]`

  const selectParts: string[] = ["ti.TrackingItemId"]
  if (includeHotCase) {
    selectParts.push(
      "MAX(CAST(ISNULL(ti.IsHotCase, 0) AS INT)) AS [IsHotCase]"
    )
  }
  selectParts.push(rowStateSql)
  if (fieldSelect) selectParts.push(fieldSelect)
  const selectList = selectParts.join(",\n    ")

  let reportFilterJoin = ""
  let reportFilterAnd = ""
  if (filterMode === "tvf") {
    reportFilterJoin = SQL_REPORT_ELIGIBLE_JOIN_TI
  } else if (filterMode === "legacy") {
    reportFilterAnd = `
    AND dbo.fn_PendingTracking_MatchesReport(@reportKey, ti.PayerType, ti.PayerName, ti.ViewType) = 1
    ${SQL_FILTER_FACILITY_LIST_TI}
    AND (@status IS NULL OR @status = N'' OR ti.Status = @status)
    AND (
      @search IS NULL OR @search = N'' OR ti.ResidentName LIKE N'%' + @search + N'%'
    )`
  } else {
    reportFilterJoin = `
  INNER JOIN #rt_report_ids rt ON rt.TrackingItemId = ti.TrackingItemId`
  }

  const sql = `
;WITH Grid AS (
  SELECT
    ${selectList}
  FROM dbo.TrackingItemsTbl ti
  ${reportFilterJoin}
  ${tfvJoin}
  WHERE ${activeRowFilterSql(params.includeInactive)}ti.CompanyId = @companyId
    AND ti.DatasetId = @datasetId
  ${reportFilterAnd}
  GROUP BY ti.TrackingItemId
)
SELECT *
FROM Grid
ORDER BY ${orderByColumn} ${params.sortDirection === "desc" ? "DESC" : "ASC"}
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
`

  return { sql, orderByColumn }
}

/**
 * Single batch: fill #rt_report_ids via INSERT…EXEC dbo.trk_PendingTracking_ReportSelectItemIds,
 * COUNT(*), then FieldMetadata aggregation CTE (same as grid) restricted to those ids.
 */
export function buildGridPagedBatchViaReportItemIdsProc(
  fields: FieldMetadataRow[],
  params: GridQueryParams,
  includeHotCase: boolean
): string {
  const { sql: innerSelect } = buildGridPagedSelectSql(
    fields,
    params,
    includeHotCase,
    "tempIds"
  )
  return `
SET NOCOUNT ON;
IF OBJECT_ID(N'tempdb..#rt_report_ids') IS NOT NULL DROP TABLE #rt_report_ids;
CREATE TABLE #rt_report_ids (TrackingItemId INT NOT NULL PRIMARY KEY);
INSERT INTO #rt_report_ids (TrackingItemId)
EXEC dbo.trk_PendingTracking_ReportSelectItemIds
  @ReportType = @reportKey,
  @CompanyId = @companyId,
  @FacilityId = NULL,
  @FacilityIdList = @facilityIdList,
  @Status = @status,
  @Search = @search,
  @IncludeInactive = @includeInactive;

SELECT COUNT(*) AS TotalCount FROM #rt_report_ids;
${innerSelect}
IF OBJECT_ID(N'tempdb..#rt_report_ids') IS NOT NULL DROP TABLE #rt_report_ids;
`
}

/** Parse recordsets from buildGridPagedBatchViaReportItemIdsProc (COUNT then grid rows). */
export function parseGridPagedBatchRecordsets(
  recordsets: Record<string, unknown>[][]
): { totalCount: number; rows: Record<string, unknown>[] } {
  let totalCount = 0
  let rows: Record<string, unknown>[] = []
  for (const rs of recordsets) {
    if (!rs || rs.length === 0) continue
    const first = rs[0] as Record<string, unknown>
    const keys = first ? Object.keys(first) : []
    const isTotalCountRow =
      keys.length === 1 &&
      keys[0] === "TotalCount" &&
      Object.prototype.hasOwnProperty.call(first, "TotalCount")
    if (first && isTotalCountRow) {
      totalCount = Number(first.TotalCount ?? 0)
      continue
    }
    if (first && keys.length > 0 && !isTotalCountRow) {
      rows = rs
    }
  }
  return { totalCount, rows }
}

export async function loadGridFieldMetadata(
  pool: ConnectionPool,
  companyId: number,
  datasetId: string,
  payerType: string,
  state: string | null
): Promise<FieldMetadataRow[]> {
  return loadFieldMetadataForScreen(pool, {
    companyId,
    datasetId,
    payerType,
    state,
    screenLocation: SCREEN_MAIN,
  })
}

function buildFieldSelectFragments(fields: FieldMetadataRow[]): string {
  const parts: string[] = []
  for (const f of fields) {
    if (!isSafeBracketAlias(f.FieldName)) continue
    if (f.FieldName === "TrackingItemId") continue
    if (isCalculatedField(f)) continue
    const alias = bracketQuoteIdentifier(f.FieldName)
    if (f.SourceType === "BaseTable") {
      const col = f.SourceColumnName?.trim()
      if (!col || !isSafeFieldNameAlias(col)) continue
      parts.push(`MAX(ti.${bracketQuoteIdentifier(col)}) AS ${alias}`)
    } else {
      const inner = customResolvedExpression(f.DataType)
      parts.push(
        `MAX(CASE WHEN tfv.FieldMetadataId = ${f.FieldMetadataId} THEN ${inner} END) AS ${alias}`
      )
    }
  }
  return parts.join(",\n    ")
}

function sortKeyToPascal(
  sortBy: string,
  fields: FieldMetadataRow[]
): string | null {
  if (sortBy.toLowerCase() === "trackingitemid") {
    return TRACKING_ITEM_ID_FIELD_NAME
  }
  const direct = fields.find(
    (f) =>
      !isCalculatedField(f) &&
      (f.FieldName === sortBy ||
        f.FieldName.toLowerCase() === sortBy.toLowerCase())
  )
  if (direct) return direct.FieldName
  const camelMatch = fields.find(
    (f) =>
      !isCalculatedField(f) && pascalToCamelKey(f.FieldName) === sortBy
  )
  return camelMatch?.FieldName ?? null
}

export function validateSortColumnPascal(
  sortBy: string,
  fields: FieldMetadataRow[]
): string {
  const pascal = sortKeyToPascal(sortBy, fields)
  if (
    pascal &&
    isSafeFieldNameAlias(pascal) &&
    fields.some(
      (f) => f.FieldName === pascal && !isCalculatedField(f)
    )
  ) {
    return bracketQuoteIdentifier(pascal)
  }
  const fallback =
    fields.find(
      (f) =>
        !isCalculatedField(f) &&
        isSafeFieldNameAlias(f.FieldName) &&
        f.FieldName !== TRACKING_ITEM_ID_FIELD_NAME
    )?.FieldName ?? TRACKING_ITEM_ID_FIELD_NAME
  return bracketQuoteIdentifier(fallback)
}

/**
 * Checks whether dbo.TrackingItemsTbl has the IsHotCase column.
 * Result is cached for the lifetime of the process.
 */
let _hasIsHotCase: boolean | null = null
export async function hasIsHotCaseColumn(
  pool: import("mssql").ConnectionPool
): Promise<boolean> {
  if (_hasIsHotCase !== null) return _hasIsHotCase
  try {
    const result = await pool.request().query(`
      SELECT 1 FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.TrackingItemsTbl')
        AND name = N'IsHotCase'
    `)
    _hasIsHotCase = result.recordset.length > 0
  } catch {
    _hasIsHotCase = false
  }
  return _hasIsHotCase
}

export function buildGridDataSql(
  fields: FieldMetadataRow[],
  params: GridQueryParams,
  includeHotCase = false,
  useReportEligibleTvf = true
): { sql: string; orderByColumn: string } {
  const filterMode: GridReportFilterMode = useReportEligibleTvf ? "tvf" : "legacy"
  return buildGridPagedSelectSql(fields, params, includeHotCase, filterMode)
}

export function buildGridCountSql(
  params: GridQueryParams,
  useReportEligibleTvf = true
): string {
  if (useReportEligibleTvf) {
    return `
SELECT COUNT(*) AS TotalCount
FROM dbo.TrackingItemsTbl ti
${SQL_REPORT_ELIGIBLE_JOIN_TI}
WHERE ${activeRowFilterSql(params.includeInactive)}ti.CompanyId = @companyId
  AND ti.DatasetId = @datasetId
`
  }
  return `
SELECT COUNT(*) AS TotalCount
FROM dbo.TrackingItemsTbl ti
WHERE ${activeRowFilterSql(params.includeInactive)}ti.CompanyId = @companyId
  AND ti.DatasetId = @datasetId
  AND dbo.fn_PendingTracking_MatchesReport(@reportKey, ti.PayerType, ti.PayerName, ti.ViewType) = 1
  ${SQL_FILTER_FACILITY_LIST_TI}
  AND (@status IS NULL OR @status = N'' OR ti.Status = @status)
  AND (
    @search IS NULL OR @search = N'' OR ti.ResidentName LIKE N'%' + @search + N'%'
  )
`
}

export function applyGridRequestInputs(
  request: sql.Request,
  params: GridQueryParams
): void {
  const offset = (params.page - 1) * params.pageSize
  request.input("companyId", sql.Int, params.companyId)
  request.input("datasetId", sql.NVarChar(64), params.datasetId)
  request.input("reportKey", sql.NVarChar(120), params.viewType)
  request.input("search", sql.NVarChar(200), params.search ?? null)
  const facilityCsv = sanitizeFacilityIdsForCsv(params.facilityIds)
  request.input("facilityIdList", sql.NVarChar(sql.MAX), facilityCsv)
  request.input("status", sql.NVarChar(100), params.status ?? null)
  request.input(
    "includeInactive",
    sql.Bit,
    params.includeInactive ? 1 : 0
  )
  request.input("offset", sql.Int, offset)
  request.input("pageSize", sql.Int, params.pageSize)
}

export async function fetchDropdownOptionsForFields(
  pool: ConnectionPool,
  datasetId: string,
  fieldIds: number[]
): Promise<Map<number, { optionId: number; value: string; label: string }[]>> {
  const map = new Map<number, { optionId: number; value: string; label: string }[]>()
  if (fieldIds.length === 0) return map
  const placeholders = fieldIds.map((_, i) => `@id${i}`).join(", ")
  const r = pool.request()
  r.input("datasetId", sql.NVarChar(64), datasetId)
  fieldIds.forEach((id, i) => r.input(`id${i}`, sql.Int, id))
  const result = await r.query<{
    FieldMetadataId: number
    FieldOptionId: number
    OptionValue: string
    OptionLabel: string | null
  }>(`
    SELECT FieldMetadataId, FieldOptionId, OptionValue, OptionLabel
    FROM dbo.FieldMetadataOption
    WHERE FieldMetadataId IN (${placeholders}) AND IsActive = 1 AND DatasetId = @datasetId
    ORDER BY FieldMetadataId, DisplayOrder, FieldOptionId
  `)
  for (const row of result.recordset) {
    const id = row.FieldMetadataId
    const list = map.get(id) ?? []
    list.push({
      optionId: row.FieldOptionId,
      value: String(row.OptionValue),
      label: String(row.OptionLabel ?? row.OptionValue),
    })
    map.set(id, list)
  }
  return map
}

/** @deprecated removed — use loadGridFieldMetadata */
export async function loadGridFieldDefinitions(): Promise<never> {
  throw new Error("loadGridFieldDefinitions removed — use FieldMetadata")
}
