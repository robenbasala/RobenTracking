import sql from "mssql"
import type { ConnectionPool } from "mssql"
import { fetchTrackingItemBase } from "./detail-sql"
import { applyCalculatedToPascalContext } from "./calculated-fields.js"
import {
  SCREEN_DETAIL,
  TRACKING_ITEM_ID_FIELD_NAME,
  isCalculatedField,
  loadFieldMetadataForScreen,
  type FieldMetadataRow,
} from "./field-metadata"
import type {
  DetailDropdownOption,
  ModalSectionMeta,
  PendingTrackingDetailResponse,
  ResidentDetailHeader,
  UnifiedDetailFieldRow,
} from "./types"

function getColumnValue(
  row: Record<string, unknown>,
  columnName: string | null
): unknown {
  if (!columnName) return null
  const keys = Object.keys(row)
  const match = keys.find((k) => k.toLowerCase() === columnName.toLowerCase())
  return match !== undefined ? row[match] : null
}

function firstNonEmpty(
  row: Record<string, unknown>,
  names: string[]
): unknown {
  for (const n of names) {
    const v = getColumnValue(row, n)
    if (v !== null && v !== undefined && String(v).trim() !== "") return v
  }
  return null
}

function formatUsDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const d = raw instanceof Date ? raw : new Date(String(raw))
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  })
}

function calcAgeYears(dob: Date): number {
  const t = new Date()
  let age = t.getFullYear() - dob.getFullYear()
  const m = t.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && t.getDate() < dob.getDate())) age--
  return age
}

function maskSsn(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).replace(/\D/g, "")
  if (s.length >= 4) return `XXX-XX-${s.slice(-4)}`
  const t = String(raw).trim()
  if (t) return "XXX-XX-XXXX"
  return null
}

export function extractResidentHeader(
  baseRow: Record<string, unknown>
): ResidentDetailHeader {
  const residentNameRaw = firstNonEmpty(baseRow, ["ResidentName", "residentName"])
  const residentName =
    residentNameRaw !== null && residentNameRaw !== undefined
      ? String(residentNameRaw)
      : null

  const residentIdRaw = firstNonEmpty(baseRow, [
    "ResidentID",
    "ResidentId",
    "residentId",
    "residentid",
    "PatientID",
    "PatientId",
    "patientId",
    "patientid",
    "resstayID",
    "resstayid",
    "CID",
    "cid",
    "UniqueId",
    "uniqueid",
  ])
  const residentId =
    residentIdRaw !== null && residentIdRaw !== undefined
      ? String(residentIdRaw).trim()
      : null

  const payerRaw = firstNonEmpty(baseRow, ["ViewType", "viewType"])
  const payerLabel =
    payerRaw !== null && payerRaw !== undefined ? String(payerRaw) : null

  const dobRaw = firstNonEmpty(baseRow, ["DBIRTH", "DateOfBirth", "dateOfBirth"])
  let dateOfBirthDisplay: string | null = null
  let ageYears: number | null = null
  if (dobRaw !== null && dobRaw !== undefined) {
    const d =
      dobRaw instanceof Date ? dobRaw : new Date(String(dobRaw))
    if (!Number.isNaN(d.getTime())) {
      dateOfBirthDisplay = formatUsDate(dobRaw)
      ageYears = calcAgeYears(d)
    }
  }

  const ssnDisplay = maskSsn(firstNonEmpty(baseRow, ["CSSN", "SSN", "ssn"]))

  const admitRaw = firstNonEmpty(baseRow, [
    "LatestAdmit",
    "EarliestAdmit",
    "AdmitDate",
    "admitDate",
  ])
  const admitDateDisplay = formatUsDate(admitRaw)

  const discRaw = firstNonEmpty(baseRow, [
    "EndofCareDate",
    "DischargeDate",
    "dischargeDate",
  ])
  const dischargeDateDisplay = formatUsDate(discRaw)

  const hotCaseRaw = getColumnValue(baseRow, "IsHotCase")
  const isHotCase = hotCaseRaw === true || hotCaseRaw === 1 || String(hotCaseRaw).toLowerCase() === "true"

  return {
    residentName,
    residentId,
    payerLabel,
    dateOfBirthDisplay,
    ageYears,
    ssnDisplay,
    admitDateDisplay,
    dischargeDateDisplay,
    isHotCase,
  }
}

export function parseDetailScalar(
  raw: unknown,
  dataType: string
): string | number | boolean | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === "boolean" || typeof raw === "number") return raw
  const t = dataType.toLowerCase()
  if (t.includes("bit") || t.includes("bool")) {
    if (typeof raw === "boolean") return raw
    const s = String(raw).toLowerCase()
    if (s === "true" || s === "1") return true
    if (s === "false" || s === "0") return false
    return null
  }
  if (
    t.includes("int") ||
    t.includes("decimal") ||
    t.includes("numeric") ||
    t.includes("float") ||
    t.includes("money") ||
    t.includes("currency") ||
    t.includes("number")
  ) {
    const n = typeof raw === "number" ? raw : Number(raw)
    return Number.isNaN(n) ? String(raw) : n
  }
  if (raw instanceof Date) return raw.toISOString().slice(0, 10)
  return String(raw)
}

type TfRow = {
  FieldMetadataId: number
  TextValue: string | null
  NumberValue: number | null
  DateValue: Date | null
  BooleanValue: boolean | null
  DropdownOptionId: number | null
  OptionLabel: string | null
  OptionValue: string | null
}

async function fetchDropdownOptionsMap(
  pool: ConnectionPool,
  fieldIds: number[]
): Promise<Map<number, DetailDropdownOption[]>> {
  const map = new Map<number, DetailDropdownOption[]>()
  if (fieldIds.length === 0) return map
  const placeholders = fieldIds.map((_, i) => `@dd${i}`).join(", ")
  const r = pool.request()
  fieldIds.forEach((id, i) => r.input(`dd${i}`, sql.Int, id))
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

async function fetchCustomValueRows(
  pool: ConnectionPool,
  trackingItemId: number
): Promise<Map<number, TfRow>> {
  const req = pool.request()
  req.input("trackingItemId", sql.Int, trackingItemId)
  const result = await req.query<TfRow>(`
    SELECT
      tfv.FieldMetadataId,
      tfv.TextValue,
      tfv.NumberValue,
      tfv.DateValue,
      tfv.BooleanValue,
      tfv.DropdownOptionId,
      opt.OptionLabel,
      opt.OptionValue
    FROM dbo.TrackingItemFieldValues tfv
    LEFT JOIN dbo.FieldMetadataOption opt
      ON opt.FieldOptionId = tfv.DropdownOptionId
    WHERE tfv.TrackingItemId = @trackingItemId
  `)
  const map = new Map<number, TfRow>()
  for (const r of result.recordset) {
    map.set(r.FieldMetadataId, r)
  }
  return map
}

function resolveCustomValue(
  row: TfRow | undefined,
  fm: FieldMetadataRow
): string | number | boolean | null {
  if (!row) return null
  const t = fm.DataType.toLowerCase()
  if (t === "dropdown") {
    const s = row.OptionLabel ?? row.OptionValue ?? row.TextValue
    return s ?? null
  }
  if (t === "date" || t.includes("time")) {
    if (!row.DateValue) return null
    const d = row.DateValue instanceof Date ? row.DateValue : new Date(row.DateValue)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  if (t === "boolean" || t === "bit") {
    if (row.BooleanValue === null || row.BooleanValue === undefined) return null
    return Boolean(row.BooleanValue)
  }
  if (
    t === "number" ||
    t === "currency" ||
    t === "money" ||
    t === "float" ||
    t === "int"
  ) {
    if (row.NumberValue === null || row.NumberValue === undefined) return null
    return row.NumberValue
  }
  return row.TextValue ?? null
}

export async function buildDetailResponse(
  pool: ConnectionPool,
  trackingItemId: number,
  state: string | null
): Promise<PendingTrackingDetailResponse | null> {
  const baseRow = await fetchTrackingItemBase(pool, trackingItemId)
  if (!baseRow) return null

  const companyId = Number(baseRow.CompanyId)
  const viewType = String(baseRow.ViewType ?? "")
  if (!Number.isFinite(companyId) || !viewType) {
    return null
  }

  const fieldsMetaRaw = await loadFieldMetadataForScreen(pool, {
    companyId,
    payerType: viewType,
    state,
    screenLocation: SCREEN_DETAIL,
  })
  const fieldsMeta: FieldMetadataRow[] = fieldsMetaRaw.filter(
    (f: FieldMetadataRow) => f.FieldName !== TRACKING_ITEM_ID_FIELD_NAME
  )

  const dropdownFieldIds = fieldsMeta
    .filter((f) => f.DataType.toLowerCase() === "dropdown")
    .map((f) => f.FieldMetadataId)
  const dropdownOptionsMap = await fetchDropdownOptionsMap(
    pool,
    dropdownFieldIds
  )

  const hasCustom = fieldsMeta.some(
    (f) => f.SourceType === "Custom" && !isCalculatedField(f)
  )
  const customMap = hasCustom
    ? await fetchCustomValueRows(pool, trackingItemId)
    : new Map<number, TfRow>()

  const valueMap = new Map<string, unknown>()

  for (const fm of fieldsMeta) {
    if (isCalculatedField(fm)) continue
    let value: string | number | boolean | null = null
    if (fm.SourceType === "BaseTable") {
      const raw = getColumnValue(baseRow, fm.SourceColumnName)
      value = parseDetailScalar(raw, fm.DataType)
    } else {
      const row = customMap.get(fm.FieldMetadataId)
      value = resolveCustomValue(row, fm)
    }
    valueMap.set(fm.FieldName, value)
  }

  applyCalculatedToPascalContext(fieldsMeta, valueMap)

  const fields: UnifiedDetailFieldRow[] = fieldsMeta.map((fm: FieldMetadataRow) => {
    const value = (valueMap.get(fm.FieldName) ?? null) as
      | string
      | number
      | boolean
      | null
    let dropdownOptionId: number | null = null
    if (
      !isCalculatedField(fm) &&
      fm.SourceType !== "BaseTable" &&
      fm.DataType.toLowerCase() === "dropdown"
    ) {
      const row = customMap.get(fm.FieldMetadataId)
      if (row) dropdownOptionId = row.DropdownOptionId ?? null
    }
    const opts =
      fm.DataType.toLowerCase() === "dropdown"
        ? (dropdownOptionsMap.get(fm.FieldMetadataId) ?? [])
        : undefined
    return {
      fieldMetadataId: fm.FieldMetadataId,
      fieldName: fm.FieldName,
      displayName: fm.DisplayName,
      dataType: fm.DataType,
      screenLocation: fm.ScreenLocation,
      displayOrder: fm.DisplayOrder,
      modalSectionId: fm.ModalSectionId ?? null,
      value,
      sourceType: fm.SourceType as "BaseTable" | "Custom",
      isEditable: fm.IsEditable && !isCalculatedField(fm),
      ...(opts !== undefined ? { dropdownOptions: opts } : {}),
      ...(dropdownOptionId !== null ? { dropdownOptionId } : {}),
    }
  })

  fields.sort((a, b) => a.displayOrder - b.displayOrder)

  // ── Build sections ─────────────────────────────────────────────────
  const sectionIds = [
    ...new Set(fields.map((f) => f.modalSectionId).filter((id): id is number => id !== null)),
  ]

  type ModalSectionRow = {
    ModalSectionId: number
    SectionName: string
    SectionType: string
    DisplayOrder: number
  }
  const sectionMetaMap = new Map<number, ModalSectionRow>()
  if (sectionIds.length > 0) {
    const req2 = pool.request()
    const placeholders = sectionIds.map((_, i) => `@s${i}`).join(", ")
    sectionIds.forEach((id, i) => req2.input(`s${i}`, sql.Int, id))
    const secResult = await req2.query<ModalSectionRow>(`
      SELECT ModalSectionId, SectionName, SectionType, DisplayOrder
      FROM dbo.ModalSection
      WHERE ModalSectionId IN (${placeholders}) AND IsActive = 1
    `)
    for (const r of secResult.recordset) {
      sectionMetaMap.set(r.ModalSectionId, r)
    }
  }

  const fieldsBySection = new Map<number | null, UnifiedDetailFieldRow[]>()
  for (const f of fields) {
    const key = f.modalSectionId
    const list = fieldsBySection.get(key) ?? []
    list.push(f)
    fieldsBySection.set(key, list)
  }

  const sections: ModalSectionMeta[] = [
    ...sectionMetaMap
      .values(),
  ]
    .sort((a, b) => a.DisplayOrder - b.DisplayOrder)
    .map((meta) => ({
      modalSectionId: meta.ModalSectionId,
      sectionName: meta.SectionName,
      sectionType: meta.SectionType as "Standard" | "LOCTracking",
      displayOrder: meta.DisplayOrder,
      fields: (fieldsBySection.get(meta.ModalSectionId) ?? []).sort(
        (a, b) => a.displayOrder - b.displayOrder
      ),
    }))

  const unsectionedFields = fieldsBySection.get(null) ?? []
  if (unsectionedFields.length > 0) {
    sections.unshift({
      modalSectionId: null,
      sectionName: "General",
      sectionType: "Standard",
      displayOrder: 0,
      fields: unsectionedFields,
    })
  }

  return {
    trackingItemId,
    companyId,
    viewType,
    fields,
    sections,
    header: extractResidentHeader(baseRow),
  }
}
