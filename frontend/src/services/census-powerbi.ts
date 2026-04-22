/**
 * Census rows via backend proxy (never call Power BI URL or secret from the browser).
 */

import { apiPost } from "./api"

export type CensusBalanceRow = {
  balance: number | null
  payerType: string | null
  payerName: string | null
  month: string | null
  yearMonth: number | null
  facId: string | null
  patientId: string | null
  payerId: string | null
}

export type CensusPowerBiResponse = {
  rows: CensusBalanceRow[]
  empty?: boolean
  error?: string
}

/**
 * Loads census / balance-by-month rows for a resident (Power BI DAX executed on the API server).
 */
export async function fetchCensusByResidentId(
  residentId: string
): Promise<CensusPowerBiResponse> {
  const id = residentId.trim()
  if (!id) {
    return { rows: [], empty: true, error: "ResidentId is required." }
  }
  const res = await apiPost("/api/census/power-bi", { residentId: id })
  const data = (await res.json()) as CensusPowerBiResponse
  if (!res.ok) {
    return {
      rows: [],
      empty: true,
      error: data.error ?? `Request failed (${res.status})`,
    }
  }
  return {
    rows: Array.isArray(data.rows) ? data.rows : [],
    empty: Boolean(data.empty),
  }
}
