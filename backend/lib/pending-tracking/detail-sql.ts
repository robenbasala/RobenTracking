import sql from "mssql"
import type { ConnectionPool } from "mssql"

export async function fetchTrackingItemBase(
  pool: ConnectionPool,
  trackingItemId: number,
  datasetId: string
): Promise<Record<string, unknown> | null> {
  const request = pool.request()
  request.input("trackingItemId", sql.Int, trackingItemId)
  request.input("datasetId", sql.NVarChar(64), datasetId)
  const result = await request.query(`
    SELECT *
    FROM dbo.TrackingItemsTbl
    WHERE TrackingItemId = @trackingItemId
      AND DatasetId = @datasetId
  `)
  const row = result.recordset[0] as Record<string, unknown> | undefined
  return row ?? null
}
