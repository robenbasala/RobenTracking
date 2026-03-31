/**
 * If FieldMetadata is empty and PendingTrackingItem exists, seed one row per column (same idea as sql/004).
 * Runs at most once per process when auto-seed is enabled.
 */
import sql from "mssql"
import type { ConnectionPool } from "mssql"
import { humanizeIdentifierForDisplay } from "./formatters"

let seedDone = false

function mapInformationSchemaToDataType(dataType: string): string {
  const t = dataType.toLowerCase()
  if (["varchar", "nvarchar", "char", "nchar", "text", "ntext"].includes(t))
    return "text"
  if (["money", "smallmoney"].includes(t)) return "currency"
  if (
    ["decimal", "numeric", "float", "real", "int", "bigint", "smallint", "tinyint"].includes(t)
  )
    return "number"
  if (
    ["date", "datetime", "datetime2", "smalldatetime", "datetimeoffset"].includes(t)
  )
    return "date"
  if (t === "bit") return "boolean"
  return "text"
}

function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

function defaultDisplayName(columnName: string): string {
  return columnName.replace(/_/g, " ").replace(/Id\b/g, " ID")
}

export async function seedFieldMetadataIfDatabaseEmpty(
  pool: ConnectionPool
): Promise<void> {
  if (process.env.TRACKING_AUTO_SEED_FIELD_METADATA === "0") {
    return
  }
  if (seedDone) return

  const tableCheck = await pool.request().query<{ oid: number | null }>(`
    SELECT OBJECT_ID(N'dbo.PendingTrackingItem', N'U') AS oid
  `)
  if (!tableCheck.recordset[0]?.oid) {
    return
  }

  const countReq = await pool.request().query<{ c: number }>(`
    SELECT COUNT(*) AS c FROM dbo.FieldMetadata
  `)
  if ((countReq.recordset[0]?.c ?? 0) > 0) {
    seedDone = true
    return
  }

  const companyId = Number(
    process.env.TRACKING_DEFAULT_COMPANY_ID ??
      process.env.NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID ??
      "1"
  )
  if (!Number.isFinite(companyId)) {
    return
  }

  const cols = await pool.request().query<{
    COLUMN_NAME: string
    DATA_TYPE: string
    ORDINAL_POSITION: number
  }>(`
    SELECT COLUMN_NAME, DATA_TYPE, ORDINAL_POSITION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = N'PendingTrackingItem'
    ORDER BY ORDINAL_POSITION
  `)

  for (const c of cols.recordset) {
    if (!isSafeIdentifier(c.COLUMN_NAME)) continue
    const dataType = mapInformationSchemaToDataType(c.DATA_TYPE)
    const displayName = humanizeIdentifierForDisplay(c.COLUMN_NAME)
    const displayOrder = c.ORDINAL_POSITION * 10

    const req = pool.request()
    req.input("companyId", sql.Int, companyId)
    req.input("fieldName", sql.NVarChar(128), c.COLUMN_NAME)
    req.input("displayName", sql.NVarChar(256), displayName)
    req.input("dataType", sql.NVarChar(50), dataType)
    req.input("displayOrder", sql.Int, displayOrder)
    await req.query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.FieldMetadata
        WHERE CompanyId = @companyId AND FieldName = @fieldName
      )
      INSERT INTO dbo.FieldMetadata (
        CompanyId, FieldName, DisplayName, DataType, ScreenLocation, DisplayOrder,
        IsActive, IsRequired, IsEditable, IsSystemField, SourceType, SourceColumnName
      )
      VALUES (
        @companyId, @fieldName, @displayName, @dataType, N'Detail', @displayOrder,
        1, 0, 1, 1, N'BaseTable', @fieldName
      )
    `)
  }

  const upd = pool.request()
  upd.input("companyId", sql.Int, companyId)
  await upd.query(`
    UPDATE fm
    SET ScreenLocation = N'Main', DisplayOrder = o.ord
    FROM dbo.FieldMetadata fm
    INNER JOIN (
      SELECT N'ResidentName' AS fn, 10 AS ord UNION ALL
      SELECT N'FacilityName', 20 UNION ALL
      SELECT N'ViewType', 30 UNION ALL
      SELECT N'Status', 40 UNION ALL
      SELECT N'Balance', 50 UNION ALL
      SELECT N'AdmitDate', 60
    ) o ON fm.FieldName = o.fn
    WHERE fm.CompanyId = @companyId AND fm.IsSystemField = 1
  `)

  seedDone = true
}
