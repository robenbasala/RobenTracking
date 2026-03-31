import sql from "mssql"
import type { ConnectionPool } from "mssql"
import { isSafeFieldNameAlias } from "./grid-sql"
import type { FieldMetadataRow } from "./field-metadata"

function bracketQuoteIdentifier(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`
}

async function loadMetadataForFields(
  pool: ConnectionPool,
  companyId: number,
  fieldNames: string[]
): Promise<Map<string, FieldMetadataRow>> {
  if (fieldNames.length === 0) return new Map()
  const req = pool.request()
  req.input("companyId", sql.Int, companyId)
  const placeholders = fieldNames.map((_, i) => `@n${i}`).join(", ")
  fieldNames.forEach((n, i) => {
    req.input(`n${i}`, sql.NVarChar(128), n)
  })
  const result = await req.query<FieldMetadataRow & Record<string, unknown>>(`
    SELECT
      FieldMetadataId, FieldName, DisplayName, DataType, ScreenLocation, DisplayOrder,
      IsActive, IsRequired, IsEditable, IsSystemField, SourceType, SourceColumnName
    FROM dbo.FieldMetadata
    WHERE CompanyId = @companyId
      AND FieldName IN (${placeholders})
  `)
  const map = new Map<string, FieldMetadataRow>()
  for (const r of result.recordset) {
    map.set(r.FieldName, {
      ...r,
      IsActive: Boolean(r.IsActive),
      IsRequired: Boolean(r.IsRequired),
      IsEditable: Boolean(r.IsEditable),
      IsSystemField: Boolean(r.IsSystemField),
    })
  }
  return map
}

async function updateBaseColumn(
  pool: ConnectionPool,
  trackingItemId: number,
  columnName: string,
  dataType: string,
  value: unknown
): Promise<void> {
  if (!isSafeFieldNameAlias(columnName)) return
  const col = bracketQuoteIdentifier(columnName)
  const req = pool.request()
  req.input("trackingItemId", sql.Int, trackingItemId)
  const dt = dataType.toLowerCase()

  if (value === null || value === undefined || value === "") {
    await req.query(`
      UPDATE dbo.PendingTrackingItem SET ${col} = NULL
      WHERE TrackingItemId = @trackingItemId
    `)
    return
  }

  if (dt.includes("date") || dt.includes("time")) {
    const d = typeof value === "string" ? new Date(value) : value instanceof Date ? value : null
    req.input("v", sql.Date, d && !Number.isNaN(d.getTime()) ? d : null)
    await req.query(`
      UPDATE dbo.PendingTrackingItem SET ${col} = @v WHERE TrackingItemId = @trackingItemId
    `)
    return
  }
  if (dt === "boolean" || dt === "bit") {
    const b =
      value === true ||
      value === 1 ||
      String(value).toLowerCase() === "true"
    req.input("v", sql.Bit, b ? 1 : 0)
    await req.query(`
      UPDATE dbo.PendingTrackingItem SET ${col} = @v WHERE TrackingItemId = @trackingItemId
    `)
    return
  }
  if (
    dt === "number" ||
    dt === "currency" ||
    dt === "money" ||
    dt === "float" ||
    dt === "int" ||
    dt === "decimal"
  ) {
    const n = typeof value === "number" ? value : Number(value)
    req.input("v", sql.Float, Number.isFinite(n) ? n : null)
    await req.query(`
      UPDATE dbo.PendingTrackingItem SET ${col} = @v WHERE TrackingItemId = @trackingItemId
    `)
    return
  }
  req.input("v", sql.NVarChar(sql.MAX), String(value))
  await req.query(`
    UPDATE dbo.PendingTrackingItem SET ${col} = @v WHERE TrackingItemId = @trackingItemId
  `)
}

async function upsertCustomValue(
  pool: ConnectionPool,
  trackingItemId: number,
  fieldMetadataId: number,
  dataType: string,
  value: unknown
): Promise<void> {
  const dt = dataType.toLowerCase()
  const req = pool.request()
  req.input("tid", sql.Int, trackingItemId)
  req.input("fmid", sql.Int, fieldMetadataId)

  let textVal: string | null = null
  let numVal: number | null = null
  let dateVal: Date | null = null
  let bitVal: number | null = null
  let dropId: number | null = null

  if (value === null || value === undefined || value === "") {
    await req.query(`
      MERGE dbo.TrackingItemFieldValues AS t
      USING (SELECT @tid AS TrackingItemId, @fmid AS FieldMetadataId) AS s
      ON t.TrackingItemId = s.TrackingItemId AND t.FieldMetadataId = s.FieldMetadataId
      WHEN MATCHED THEN UPDATE SET
        TextValue = NULL, NumberValue = NULL, DateValue = NULL, BooleanValue = NULL, DropdownOptionId = NULL
      WHEN NOT MATCHED THEN INSERT (TrackingItemId, FieldMetadataId, TextValue, NumberValue, DateValue, BooleanValue, DropdownOptionId)
      VALUES (@tid, @fmid, NULL, NULL, NULL, NULL, NULL);
    `)
    return
  }

  if (dt === "dropdown") {
    const n = typeof value === "number" ? value : Number(value)
    if (Number.isFinite(n)) {
      dropId = n
    } else {
      textVal = String(value)
    }
  } else if (dt === "date" || dt.includes("time")) {
    const d = typeof value === "string" ? new Date(value) : value instanceof Date ? value : null
    dateVal = d && !Number.isNaN(d.getTime()) ? d : null
  } else if (dt === "boolean" || dt === "bit") {
    const b =
      value === true ||
      value === 1 ||
      String(value).toLowerCase() === "true"
    bitVal = b ? 1 : 0
  } else if (
    dt === "number" ||
    dt === "currency" ||
    dt === "money" ||
    dt === "float" ||
    dt === "int"
  ) {
    const n = typeof value === "number" ? value : Number(value)
    numVal = Number.isFinite(n) ? n : null
  } else {
    textVal = String(value)
  }

  req.input("tv", sql.NVarChar(sql.MAX), textVal)
  req.input("nv", sql.Float, numVal)
  req.input("dv", sql.Date, dateVal)
  req.input("bv", sql.Bit, bitVal)
  req.input("did", sql.Int, dropId)

  await req.query(`
    MERGE dbo.TrackingItemFieldValues AS t
    USING (SELECT @tid AS TrackingItemId, @fmid AS FieldMetadataId) AS s
    ON t.TrackingItemId = s.TrackingItemId AND t.FieldMetadataId = s.FieldMetadataId
    WHEN MATCHED THEN UPDATE SET
      TextValue = @tv,
      NumberValue = @nv,
      DateValue = @dv,
      BooleanValue = @bv,
      DropdownOptionId = @did
    WHEN NOT MATCHED THEN INSERT (TrackingItemId, FieldMetadataId, TextValue, NumberValue, DateValue, BooleanValue, DropdownOptionId)
    VALUES (@tid, @fmid, @tv, @nv, @dv, @bv, @did);
  `)
}

/**
 * Saves field values keyed by FieldMetadata.FieldName (PascalCase as stored in DB).
 */
export async function saveTrackingItemFieldValues(
  pool: ConnectionPool,
  trackingItemId: number,
  companyId: number,
  values: Record<string, unknown>
): Promise<{ updated: string[]; skipped: string[] }> {
  // Field names go into parameterized queries in loadMetadataForFields (safe).
  // SourceColumnName (used as a SQL identifier) is validated strictly inside updateBaseColumn.
  const keys = Object.keys(values).filter((k) => k.length > 0 && k.length <= 128)
  const metaMap = await loadMetadataForFields(pool, companyId, keys)
  const updated: string[] = []
  const skipped: string[] = []

  for (const fieldName of keys) {
    const fm = metaMap.get(fieldName)
    if (!fm) {
      skipped.push(fieldName)
      continue
    }
    if (!fm.IsEditable) {
      skipped.push(fieldName)
      continue
    }
    if (fm.SourceType === "BaseTable") {
      const col = fm.SourceColumnName?.trim()
      if (!col || !isSafeFieldNameAlias(col)) {
        skipped.push(fieldName)
        continue
      }
      await updateBaseColumn(
        pool,
        trackingItemId,
        col,
        fm.DataType,
        values[fieldName]
      )
      updated.push(fieldName)
    } else {
      await upsertCustomValue(
        pool,
        trackingItemId,
        fm.FieldMetadataId,
        fm.DataType,
        values[fieldName]
      )
      updated.push(fieldName)
    }
  }

  return { updated, skipped }
}
