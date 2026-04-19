import sql from "mssql"
import type { ConnectionPool } from "mssql"

export async function fetchTrackingItemBase(
  pool: ConnectionPool,
  trackingItemId: number
): Promise<Record<string, unknown> | null> {
  const request = pool.request()
  request.input("trackingItemId", sql.Int, trackingItemId)
  const result = await request.query(`
    SELECT *
    FROM dbo.TrackingItemsTbl
    WHERE TrackingItemId = @trackingItemId
  `)
  const row = result.recordset[0] as Record<string, unknown> | undefined
  return row ?? null
}
