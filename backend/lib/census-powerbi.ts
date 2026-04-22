/**
 * Power BI “execute DAX” proxy helpers: build query, call HTTP API, normalize rows.
 * Secrets must stay in env (never ship to the browser).
 */

const DEFAULT_DATASET_ID = "4c41eb0d-2fea-4ed7-8de3-224dad8455c6"
/** Default Cloud Run execute-DAX endpoint (override with POWERBI_EXECUTE_DAX_URL). */
const DEFAULT_EXECUTE_URL =
  "https://powerbiapi-jrtbvvz2aa-uc.a.run.app/executeDaxQuery"

function normalizeExecuteUrl(raw: string): string {
  let u = raw.trim()
  if (!u) return u
  try {
    const parsed = new URL(u)
    if (parsed.hostname.endsWith(".a.run.app") && parsed.protocol === "http:") {
      parsed.protocol = "https:"
      u = parsed.toString()
    }
  } catch {
    /* keep trimmed string */
  }
  return u
}

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

/** Escape a value embedded inside a DAX string literal: "…" */
function escapeDaxStringLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '""')
}

/**
 * Builds the census DAX for a single resident (PatientID filter).
 * Uses standard DAX table/column quoting ('Table'[Column]).
 */
export function buildCensusDaxQuery(residentId: string): string {
  const id = residentId.trim()
  if (!id) {
    throw new Error("ResidentId is required.")
  }
  const lit = escapeDaxStringLiteral(id)
  return `DEFINE
    VAR ResidentIDValueHere = "${lit}"

    VAR Core =
    SUMMARIZECOLUMNS(
        'FACMAP'[FacID],
        'Patienttbl'[PatientID],
        'PayorTbl'[PayerID],
        'PayorTbl'[PayerType],
        'PayorTbl'[PayerName],
        'AllDates'[Last day of the Month],
        FILTER(
            ALL('Patienttbl'[PatientID]),
            'Patienttbl'[PatientID] = ResidentIDValueHere
        ),
        "Balance", SUM( 'Agingtbl'[Amount] )
    )

    VAR Result =
    SELECTCOLUMNS(
        Core,
        "Balance", [Balance],
        "PayerType", 'PayorTbl'[PayerType],
        "PayerName", 'PayorTbl'[PayerName],
        "Month", DATEVALUE( 'AllDates'[Last day of the Month] ),
        "YearMonth", YEAR( 'AllDates'[Last day of the Month] ) * 100 + MONTH( 'AllDates'[Last day of the Month] )
    )

EVALUATE
    Result`
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  const lowerMap = new Map<string, unknown>()
  for (const [k, v] of Object.entries(obj)) {
    lowerMap.set(k.toLowerCase().replace(/^\[|\]$/g, ""), v)
    lowerMap.set(k.toLowerCase(), v)
  }
  for (const key of keys) {
    const v = lowerMap.get(key.toLowerCase())
    if (v !== undefined) return v
  }
  return undefined
}

function toNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function toIsoMonth(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === "string") {
    const d = new Date(v)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return v.slice(0, 10) || null
  }
  return null
}

function normalizeCensusRow(row: Record<string, unknown>): CensusBalanceRow {
  return {
    balance: toNumber(pick(row, ["Balance", "[Balance]"])),
    payerType: toStringOrNull(pick(row, ["PayerType", "[PayerType]"])),
    payerName: toStringOrNull(pick(row, ["PayerName", "[PayerName]"])),
    month: toIsoMonth(pick(row, ["Month", "[Month]"])),
    yearMonth: toNumber(pick(row, ["YearMonth", "[YearMonth]"])),
    facId: toStringOrNull(pick(row, ["FacID", "FacId", "[FacID]", "FACMAP[FacID]"])),
    patientId: toStringOrNull(pick(row, ["PatientID", "[PatientID]"])),
    payerId: toStringOrNull(pick(row, ["PayerID", "[PayerID]"])),
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Best-effort extraction of tabular rows from various Power BI / custom API shapes. */
export function parseExecuteDaxTableRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    if (payload.length > 0 && isRecord(payload[0])) {
      return payload as Record<string, unknown>[]
    }
  }

  if (!isRecord(payload)) return []

  const tryPaths = [
    () => (payload as { rows?: unknown }).rows,
    () => (payload as { data?: unknown }).data,
    () => (payload as { result?: unknown }).result,
    () => (payload as { results?: unknown }).results,
    () => (payload as { tables?: unknown }).tables,
    () => (payload as { records?: unknown }).records,
  ]

  for (const get of tryPaths) {
    const v = get()
    if (Array.isArray(v) && v.length > 0 && isRecord(v[0])) {
      return v as Record<string, unknown>[]
    }
  }

  const results = (payload as { results?: unknown }).results
  if (Array.isArray(results) && results[0] && isRecord(results[0])) {
    const t0 = (results[0] as { tables?: unknown }).tables
    if (Array.isArray(t0) && t0[0] && isRecord(t0[0])) {
      const rows = (t0[0] as { rows?: unknown }).rows
      if (Array.isArray(rows) && rows.length > 0 && isRecord(rows[0])) {
        return rows as Record<string, unknown>[]
      }
    }
  }

  const tables = (payload as { tables?: unknown }).tables
  if (Array.isArray(tables) && tables[0] && isRecord(tables[0])) {
    const rows = (tables[0] as { rows?: unknown }).rows
    if (Array.isArray(rows) && rows.length > 0 && isRecord(rows[0])) {
      return rows as Record<string, unknown>[]
    }
  }

  return []
}

export type ExecuteCensusOptions = {
  datasetId?: string
  executeUrl?: string
  secret: string
  timeoutMs?: number
}

export async function executeCensusDaxForResident(
  residentId: string,
  options: ExecuteCensusOptions
): Promise<{ rows: CensusBalanceRow[]; raw: unknown }> {
  const datasetId = options.datasetId?.trim() || DEFAULT_DATASET_ID
  const url = normalizeExecuteUrl(
    options.executeUrl?.trim() || DEFAULT_EXECUTE_URL
  )
  const query = buildCensusDaxQuery(residentId)
  const timeoutMs = options.timeoutMs ?? 90_000

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        secret: options.secret,
      },
      body: JSON.stringify({ datasetId, query }),
      signal: controller.signal,
    })
    const text = await res.text()
    let json: unknown = null
    const trimmed = text.trim()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }

    if (!res.ok) {
      if (json === null) {
        const looksGoogle404 =
          res.status === 404 &&
          (text.includes("www.google.com") || text.includes("Error 404"))
        const hint = looksGoogle404
          ? " The URL likely does not point to your Cloud Run service (404 HTML). Set POWERBI_EXECUTE_DAX_URL in .env.local to the exact HTTPS URL from Cloud Run (including path /executeDaxQuery)."
          : " Response was not JSON. Set POWERBI_EXECUTE_DAX_URL to the correct execute endpoint."
        throw new Error(`Census API HTTP ${res.status}.${hint}`)
      }
      const msg =
        isRecord(json) && typeof json.error === "string"
          ? json.error
          : text.slice(0, 400)
      throw new Error(`Census API error (${res.status}): ${msg}`)
    }

    if (json === null) {
      throw new Error(
        `Census API returned HTTP ${res.status} but body was not JSON. First bytes: ${text.slice(0, 200)}`
      )
    }
    const rawRows = parseExecuteDaxTableRows(json)
    const rows = rawRows.map(normalizeCensusRow)
    return { rows, raw: json }
  } finally {
    clearTimeout(timer)
  }
}
