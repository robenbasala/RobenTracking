import sql from "mssql"
import type { ConnectionPool } from "mssql"

/** Matches dbo.FieldMetadata (application layer). */
export type FieldMetadataRow = {
  FieldMetadataId: number
  FieldName: string
  DisplayName: string
  DataType: string
  ScreenLocation: string
  DisplayOrder: number
  IsActive: boolean
  IsRequired: boolean
  IsEditable: boolean
  IsSystemField: boolean
  SourceType: string
  SourceColumnName: string | null
  ModalSectionId: number | null
  /** `regular` (default) or `calculated` when FieldKind column exists */
  FieldKind: string
  /** JSON string for calculated fields */
  FormulaDefinitionJson: string | null
}

export function isCalculatedField(f: FieldMetadataRow): boolean {
  return (f.FieldKind ?? "regular") === "calculated"
}

export const SCREEN_MAIN = "Main"
export const SCREEN_DETAIL = "Detail"
/** Field appears on both grid and detail drawer */
export const SCREEN_BOTH = "Both"

/** PendingTrackingItem primary key — not shown as a configurable grid/detail field */
export const TRACKING_ITEM_ID_FIELD_NAME = "TrackingItemId"

/** Cached once per process – true if dbo.FieldMetadata has a ModalSectionId column. */
let _hasModalSectionId: boolean | null = null

export async function hasModalSectionIdColumn(pool: ConnectionPool): Promise<boolean> {
  if (_hasModalSectionId !== null) return _hasModalSectionId
  try {
    const r = await pool.request().query(
      `SELECT 1 AS x FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'ModalSectionId'`
    )
    _hasModalSectionId = r.recordset.length > 0
  } catch {
    _hasModalSectionId = false
  }
  return _hasModalSectionId
}

/** Call when a migration adds the column so we stop issuing the fallback query. */
export function resetModalSectionIdCache(): void {
  _hasModalSectionId = null
}

/** Cached — true if dbo.FieldMetadata has FieldKind + FormulaDefinitionJson. */
let _hasFieldFormulaColumns: boolean | null = null

export async function hasFieldFormulaColumns(
  pool: ConnectionPool
): Promise<boolean> {
  if (_hasFieldFormulaColumns !== null) return _hasFieldFormulaColumns
  try {
    const r = await pool.request().query(`
      SELECT 1 AS x FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'FieldKind'
    `)
    _hasFieldFormulaColumns = r.recordset.length > 0
  } catch {
    _hasFieldFormulaColumns = false
  }
  return _hasFieldFormulaColumns
}

export function resetFieldFormulaColumnsCache(): void {
  _hasFieldFormulaColumns = null
}

function rethrowIfMissingFieldMetadataSchema(error: unknown): never {
  const msg = error instanceof Error ? error.message : String(error)
  if (/invalid object name/i.test(msg) && /FieldMetadata/i.test(msg)) {
    throw new Error(
      "dbo.FieldMetadata is missing. The app normally creates it on first connect — ensure the DB login can CREATE TABLE, or run sql/003-field-metadata-schema.sql. If the table is empty, run sql/004 or set TRACKING_AUTO_SEED_FIELD_METADATA (default: seed when empty). Override: TRACKING_SKIP_AUTO_FIELD_METADATA_SCHEMA=1."
    )
  }
  throw error instanceof Error ? error : new Error(msg)
}

function normalizeRow(r: FieldMetadataRow): FieldMetadataRow {
  const fk =
    (r as FieldMetadataRow & { FieldKind?: string }).FieldKind != null
      ? String((r as FieldMetadataRow & { FieldKind?: string }).FieldKind)
      : "regular"
  const fj = (r as FieldMetadataRow & { FormulaDefinitionJson?: unknown })
    .FormulaDefinitionJson
  return {
    ...r,
    IsActive: Boolean(r.IsActive),
    IsRequired: Boolean(r.IsRequired),
    IsEditable: Boolean(r.IsEditable),
    IsSystemField: Boolean(r.IsSystemField),
    ModalSectionId: r.ModalSectionId != null ? Number(r.ModalSectionId) : null,
    FieldKind: fk,
    FormulaDefinitionJson:
      fj != null && fj !== "" ? String(fj) : null,
  }
}

const BASE_COLUMNS = `
  fm.FieldMetadataId,
  fm.FieldName,
  fm.DisplayName,
  fm.DataType,
  fm.ScreenLocation,
  COALESCE(vto.DisplayOrder, fm.DisplayOrder) AS DisplayOrder,
  fm.IsActive,
  fm.IsRequired,
  fm.IsEditable,
  fm.IsSystemField,
  fm.SourceType,
  fm.SourceColumnName`

/**
 * Load active field metadata for a screen, scoped by company, payer type, and optional US state.
 * Empty payer/state mapping tables mean "all payers" / "all states".
 */
export async function loadFieldMetadataForScreen(
  pool: ConnectionPool,
  options: {
    companyId: number
    payerType: string
    state: string | null
    screenLocation: typeof SCREEN_MAIN | typeof SCREEN_DETAIL
  }
): Promise<FieldMetadataRow[]> {
  const { companyId, payerType, state, screenLocation } = options
  const hasMSI = await hasModalSectionIdColumn(pool)
  const msiCol = hasMSI ? ",\n      fm.ModalSectionId" : ",\n      NULL AS ModalSectionId"
  const hasFf = await hasFieldFormulaColumns(pool)
  const ffCol = hasFf
    ? ",\n      fm.FieldKind,\n      fm.FormulaDefinitionJson"
    : ",\n      N'regular' AS FieldKind,\n      CAST(NULL AS nvarchar(max)) AS FormulaDefinitionJson"

  const sqlText = `
    SELECT ${BASE_COLUMNS}${msiCol}${ffCol}
    FROM dbo.FieldMetadata fm
    LEFT JOIN dbo.FieldMetadataViewOrder vto
      ON vto.FieldMetadataId = fm.FieldMetadataId AND vto.ViewType = @payerType
    WHERE fm.CompanyId = @companyId
      AND (fm.ScreenLocation = @screenLoc OR fm.ScreenLocation = N'Both')
      AND fm.IsActive = 1
      AND (
        NOT EXISTS (
          SELECT 1 FROM dbo.FieldMetadataPayerType pt
          WHERE pt.FieldMetadataId = fm.FieldMetadataId
        )
        OR EXISTS (
          SELECT 1 FROM dbo.FieldMetadataPayerType pt
          WHERE pt.FieldMetadataId = fm.FieldMetadataId
            AND pt.PayerType = @payerType
        )
      )
      AND (
        @state IS NULL
        OR LTRIM(RTRIM(@state)) = N''
        OR NOT EXISTS (
          SELECT 1 FROM dbo.FieldMetadataState st
          WHERE st.FieldMetadataId = fm.FieldMetadataId
        )
        OR EXISTS (
          SELECT 1 FROM dbo.FieldMetadataState st
          WHERE st.FieldMetadataId = fm.FieldMetadataId
            AND st.State = @state
        )
      )
    ORDER BY COALESCE(vto.DisplayOrder, fm.DisplayOrder) ASC, fm.FieldMetadataId ASC
  `

  const req = pool.request()
  req.input("companyId", sql.Int, companyId)
  req.input("payerType", sql.NVarChar(100), payerType)
  req.input("screenLoc", sql.NVarChar(20), screenLocation)
  const st = state?.trim().toUpperCase().slice(0, 2) ?? ""
  req.input("state", sql.NVarChar(2), st.length === 2 ? st : null)

  try {
    const result = await req.query<FieldMetadataRow>(sqlText)
    return result.recordset.map(normalizeRow)
  } catch (e) {
    rethrowIfMissingFieldMetadataSchema(e)
  }
}

export async function getFieldMetadataById(
  pool: ConnectionPool,
  fieldMetadataId: number,
  companyId: number
): Promise<FieldMetadataRow | null> {
  const hasMSI = await hasModalSectionIdColumn(pool)
  const msiCol = hasMSI ? ", ModalSectionId" : ", NULL AS ModalSectionId"
  const hasFf = await hasFieldFormulaColumns(pool)
  const ffCol = hasFf
    ? ", FieldKind, FormulaDefinitionJson"
    : ", N'regular' AS FieldKind, CAST(NULL AS nvarchar(max)) AS FormulaDefinitionJson"

  const req = pool.request()
  req.input("id", sql.Int, fieldMetadataId)
  req.input("companyId", sql.Int, companyId)
  let r: FieldMetadataRow | undefined
  try {
    const result = await req.query<FieldMetadataRow>(`
      SELECT TOP 1
        FieldMetadataId, FieldName, DisplayName, DataType, ScreenLocation, DisplayOrder,
        IsActive, IsRequired, IsEditable, IsSystemField, SourceType, SourceColumnName
        ${msiCol}${ffCol}
      FROM dbo.FieldMetadata
      WHERE FieldMetadataId = @id AND CompanyId = @companyId
    `)
    r = result.recordset[0]
  } catch (e) {
    rethrowIfMissingFieldMetadataSchema(e)
  }
  if (!r) return null
  return normalizeRow(r)
}
