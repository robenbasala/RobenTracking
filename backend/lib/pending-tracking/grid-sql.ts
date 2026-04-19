/**
 * Grid SQL driven by dbo.FieldMetadata (Main screen).
 * Base fields → PendingTrackingItem; custom → TrackingItemFieldValues + FieldMetadataOption.
 */
import sql from "mssql"
import type { ConnectionPool } from "mssql"
import type { FieldMetadataRow } from "./field-metadata"
import {
  SCREEN_MAIN,
  TRACKING_ITEM_ID_FIELD_NAME,
  isCalculatedField,
  loadFieldMetadataForScreen,
} from "./field-metadata"
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

/** Primary key on PendingTrackingItem — always loaded for rows but not shown as a configurable column. */
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
  viewType: string
  /** US state (2-letter), optional — filters FieldMetadataState when set. */
  state: string | null
  search: string | null
  facilityId: string | null
  status: string | null
  page: number
  pageSize: number
  sortBy: string
  sortDirection: "asc" | "desc"
}

export async function loadGridFieldMetadata(
  pool: ConnectionPool,
  companyId: number,
  payerType: string,
  state: string | null
): Promise<FieldMetadataRow[]> {
  return loadFieldMetadataForScreen(pool, {
    companyId,
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
 * Checks whether dbo.PendingTrackingItem has the IsHotCase column.
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
      WHERE object_id = OBJECT_ID(N'dbo.PendingTrackingItem')
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
  includeHotCase = false
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

  const hotCaseFragment = includeHotCase
    ? `MAX(CAST(ISNULL(ti.IsHotCase, 0) AS INT)) AS [IsHotCase],`
    : ""

  const selectList = fieldSelect
    ? `ti.TrackingItemId,
    ${hotCaseFragment}
    ${fieldSelect}`
    : `ti.TrackingItemId${includeHotCase ? ",\n    MAX(CAST(ISNULL(ti.IsHotCase, 0) AS INT)) AS [IsHotCase]" : ""}`

  const sql = `
;WITH Grid AS (
  SELECT
    ${selectList}
  FROM dbo.PendingTrackingItem ti
  ${tfvJoin}
  WHERE ti.IsActive = 1
    AND ti.CompanyId = @companyId
    AND ti.ViewType = @viewType
    AND (@facilityId IS NULL OR @facilityId = N'' OR ti.FacilityId = @facilityId)
    AND (@status IS NULL OR @status = N'' OR ti.Status = @status)
    AND (
      @search IS NULL OR @search = N'' OR ti.ResidentName LIKE N'%' + @search + N'%'
    )
  GROUP BY ti.TrackingItemId
)
SELECT *
FROM Grid
ORDER BY ${orderByColumn} ${params.sortDirection === "desc" ? "DESC" : "ASC"}
OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
`

  return { sql, orderByColumn }
}

export function buildGridCountSql(): string {
  return `
SELECT COUNT(*) AS TotalCount
FROM dbo.PendingTrackingItem ti
WHERE ti.IsActive = 1
  AND ti.CompanyId = @companyId
  AND ti.ViewType = @viewType
  AND (@facilityId IS NULL OR @facilityId = N'' OR ti.FacilityId = @facilityId)
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
  request.input("viewType", sql.NVarChar(100), params.viewType)
  request.input("search", sql.NVarChar(200), params.search ?? null)
  request.input("facilityId", sql.NVarChar(50), params.facilityId ?? null)
  request.input("status", sql.NVarChar(100), params.status ?? null)
  request.input("offset", sql.Int, offset)
  request.input("pageSize", sql.Int, params.pageSize)
}

export async function fetchDropdownOptionsForFields(
  pool: ConnectionPool,
  fieldIds: number[]
): Promise<Map<number, { optionId: number; value: string; label: string }[]>> {
  const map = new Map<number, { optionId: number; value: string; label: string }[]>()
  if (fieldIds.length === 0) return map
  const placeholders = fieldIds.map((_, i) => `@id${i}`).join(", ")
  const r = pool.request()
  fieldIds.forEach((id, i) => r.input(`id${i}`, sql.Int, id))
  const result = await r.query<{
    FieldMetadataId: number
    FieldOptionId: number
    OptionValue: string
    OptionLabel: string | null
  }>(`
    SELECT FieldMetadataId, FieldOptionId, OptionValue, OptionLabel
    FROM dbo.FieldMetadataOption
    WHERE FieldMetadataId IN (${placeholders}) AND IsActive = 1
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
