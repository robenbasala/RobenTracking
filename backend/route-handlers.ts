import type { Request, Response } from "express"
import sql from "mssql"
import * as XLSX from "xlsx"
import { z } from "zod"
import { getTrackingPool } from "./lib/pending-tracking/db.js"
import { buildDetailResponse } from "./lib/pending-tracking/detail-metadata.js"
import { fetchTrackingItemBase } from "./lib/pending-tracking/detail-sql.js"
import {
  SCREEN_DETAIL,
  SCREEN_MAIN,
  getFieldMetadataById,
  hasFieldFormulaColumns,
  hasModalSectionIdColumn,
  loadFieldMetadataForScreen,
} from "./lib/pending-tracking/field-metadata.js"
import type { FormulaDefinition } from "./lib/pending-tracking/formula-definition.js"
import { formulaDefinitionSchema } from "./lib/pending-tracking/formula-definition.js"
import {
  SQL_FILTER_FACILITY_LIST_TI,
  parseFacilityIdsFromQuery,
  sanitizeFacilityIdsForCsv,
} from "./lib/pending-tracking/facility-query.js"
import {
  applyGridRequestInputs,
  buildGridColumnMetadataFromFields,
  buildGridCountSql,
  buildGridDataSql,
  buildGridPagedBatchViaReportItemIdsProc,
  fetchDropdownOptionsForFields,
  hasIsHotCaseColumn,
  hasReportEligibleItemsTvf,
  hasReportSelectItemIdsProcedure,
  loadGridFieldMetadata,
  parseGridPagedBatchRecordsets,
  useReportItemIdsProcedureForGrid,
  type GridQueryParams,
} from "./lib/pending-tracking/grid-sql.js"
import { loadGridExportRows } from "./lib/pending-tracking/grid-export.js"
import { mapGridRowWithFieldMetadata } from "./lib/pending-tracking/map-row.js"
import { saveTrackingItemFieldValues } from "./lib/pending-tracking/save-field-values.js"
import { getDatasetId } from "./lib/pending-tracking/dataset.js"
import { parseColumnKeysFromQuery, orderColumnsByKeys } from "./lib/pending-tracking/export-column-order.js"
import { formatExportCellValue, formatShortDateValue } from "./lib/pending-tracking/export-formatters.js"
import { streamTrackingGridPdf } from "./lib/pending-tracking/stream-grid-pdf.js"
import type { PendingTrackingGridResponse } from "./lib/pending-tracking/types.js"
import { isValidViewTypeParam } from "./lib/pending-tracking/view-types.js"
import {
  generateReadSasUrl,
  uploadResidentAttachment,
} from "./lib/blob-storage.js"
import { executeCensusDaxForResident } from "./lib/census-powerbi.js"
import {
  evaluateConditionFormula,
  evaluateConditionTree,
  validateConditionTree,
  type ConditionNode,
} from "./lib/conditional-formatting.js"

type NavSection =
  | "pending"
  | "medicare"
  | "managed-care"
  | "recertifications"
  | "tasks"
  | "hot-cases"

const viewTypeMap: Record<NavSection, string> = {
  pending: "Pending",
  medicare: "Medicare",
  "managed-care": "ManagedCare",
  recertifications: "Recertifications",
  tasks: "Tasks",
  "hot-cases": "HotCases",
}

const SORT_COLUMNS: Record<string, string> = {
  title: "t.Title",
  dueDate: "t.DueDate",
  status: "t.Status",
  assignee: "t.Assignee",
  createdAt: "t.CreatedAt",
  residentName: "p.ResidentName",
  facilityName: "p.FacilityName",
}

function numParam(
  q: Record<string, unknown>,
  key: string,
  fallbackEnv?: string
): number | null {
  const raw =
    (typeof q[key] === "string" ? q[key] : null) ??
    (fallbackEnv ? process.env[fallbackEnv] : undefined)
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Query flags such as includeInactive=1 / true / yes */
function queryTruthyFlag(q: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const v = q[key]
    if (v === true) return true
    if (typeof v === "string") {
      const s = v.trim().toLowerCase()
      if (s === "1" || s === "true" || s === "yes") return true
    }
  }
  return false
}

function stoppedByFromRequest(req: Request): string {
  const q = req.query as Record<string, unknown>
  if (typeof q.stoppedBy === "string" && q.stoppedBy.trim()) {
    return q.stoppedBy.trim().slice(0, 256)
  }
  const h = req.headers["x-stopped-by"]
  if (typeof h === "string" && h.trim()) return h.trim().slice(0, 256)
  if (Array.isArray(h)) {
    const first = h[0]
    if (typeof first === "string" && first.trim())
      return first.trim().slice(0, 256)
  }
  return "Unknown"
}

function exportRowActiveLabel(row: Record<string, unknown>): string {
  const v = row.isActive
  if (v === false || v === 0 || v === "0") return "No"
  return "Yes"
}

function exportRowStoppedAt(row: Record<string, unknown>): string {
  return formatShortDateValue(row.stoppedAt)
}

function activeDatasetId(): string {
  return getDatasetId()
}

function datasetIdFromRequest(
  req: Request,
  body?: Record<string, unknown> | null
): string {
  const q = req.query as Record<string, unknown>
  const fromQuery =
    typeof q.datasetId === "string" && q.datasetId.trim()
      ? q.datasetId.trim()
      : null
  const fromBody =
    body && typeof body.datasetId === "string" && body.datasetId.trim()
      ? body.datasetId.trim()
      : null
  return fromQuery ?? fromBody ?? activeDatasetId()
}

type ConditionalFormattingRuleV2 = {
  id: string
  reportKey: string | null
  targetFieldKey: string | null
  applyTo: "row" | "field"
  backgroundColor: string
  textColor: string | null
  conditionFormula: string
  conditionTree: ConditionNode | null
  isEnabled: boolean
  sortOrder: number
}

async function loadConditionalFormattingRules(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  companyId: number,
  datasetId: string,
  reportKey: string
): Promise<ConditionalFormattingRuleV2[]> {
  await ensureConditionalFormattingRulesTable(pool)
  const r = pool.request()
  r.input("companyId", sql.Int, companyId)
  r.input("datasetId", sql.NVarChar(64), datasetId)
  r.input("reportKey", sql.NVarChar(200), reportKey)
  const result = await r.query(`
    SELECT Id, ReportKey, TargetFieldKey, ApplyTo, BackgroundColor, TextColor, ConditionFormula, ConditionJson, IsEnabled, SortOrder
    FROM dbo.ConditionalFormattingRules
    WHERE CompanyId = @companyId
      AND DatasetId = @datasetId
      AND IsEnabled = 1
      AND (
        ReportKey IS NULL
        OR ReportKey = N'ALL'
        OR ReportKey = @reportKey
      )
    ORDER BY SortOrder ASC, CreatedAt ASC
  `)
  return result.recordset.flatMap((row: Record<string, unknown>) => {
    try {
      let tree: ConditionNode | null = null
      if (row.ConditionJson != null) {
        tree = JSON.parse(String(row.ConditionJson)) as ConditionNode
      }
      return [{
        id: String(row.Id),
        reportKey: row.ReportKey == null ? null : String(row.ReportKey),
        targetFieldKey: row.TargetFieldKey == null ? null : String(row.TargetFieldKey),
        applyTo: String(row.ApplyTo).toLowerCase() === "field" ? "field" : "row",
        backgroundColor: String(row.BackgroundColor),
        textColor: row.TextColor == null ? null : String(row.TextColor),
        conditionFormula: String(row.ConditionFormula ?? ""),
        conditionTree: tree,
        isEnabled: Boolean(row.IsEnabled),
        sortOrder: Number(row.SortOrder ?? 0),
      }]
    } catch {
      return []
    }
  })
}

function applyConditionalFormattingToRows(
  rows: Record<string, unknown>[],
  rules: ConditionalFormattingRuleV2[]
): Record<string, unknown>[] {
  if (rules.length === 0) return rows
  return rows.map((row) => {
    let rowWinner: { score: number; color: string } | null = null
    const fieldWinners = new Map<string, { score: number; color: string }>()

    for (const rule of rules) {
      const matched =
        rule.conditionFormula.trim()
          ? evaluateConditionFormula(rule.conditionFormula, row)
          : rule.conditionTree
            ? evaluateConditionTree(rule.conditionTree, row)
            : false
      if (!matched) continue

      const score = rule.sortOrder + (rule.applyTo === "field" ? 100000 : 0)
      if (rule.applyTo === "row") {
        if (!rowWinner || score > rowWinner.score) {
          rowWinner = { score, color: rule.backgroundColor }
        }
      } else {
        if (!rule.targetFieldKey) continue
        const prev = fieldWinners.get(rule.targetFieldKey)
        if (!prev || score > prev.score) {
          fieldWinners.set(rule.targetFieldKey, { score, color: rule.backgroundColor })
        }
      }
    }
    if (!rowWinner && fieldWinners.size === 0) return row
    const fieldColors: Record<string, string> = {}
    for (const [k, v] of fieldWinners.entries()) fieldColors[k] = v.color
    return {
      ...row,
      ...(rowWinner ? { __rowColor: rowWinner.color } : {}),
      ...(fieldWinners.size > 0 ? { __fieldColors: fieldColors } : {}),
    }
  })
}

export async function getTrackingItems(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const section = (req.query.section ?? "pending") as NavSection
    const selectedViewType = viewTypeMap[section] ?? "Pending"
    const companyIdRaw =
      req.query.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    const companyId = companyIdRaw ? Number(companyIdRaw) : null
    const facilityName =
      (req.query.facilityName as string) ??
      process.env.TRACKING_DEFAULT_FACILITY_NAME ??
      "Peak Healthcare"

    const requestDb = (await getTrackingPool()).request()
    requestDb.input("viewType", sql.VarChar(50), selectedViewType)
    requestDb.input("facilityName", sql.VarChar(200), facilityName)
    requestDb.input("section", sql.VarChar(20), section)
    requestDb.input("companyId", sql.Int, Number.isFinite(companyId) ? companyId : null)
    requestDb.input("datasetId", sql.NVarChar(64), datasetId)

    const result = await requestDb.query(`
      SELECT
        TrackingItemId AS trackingItemId,
        FacilityName AS facilityName,
        ResidentName AS residentName,
        PayerName AS payerName,
        PayerType AS payerType,
        CONVERT(varchar(10), AdmitDate, 23) AS admitDate,
        Balance AS balance,
        Status AS status,
        AssignedTo AS assignedTo,
        CASE
          WHEN @section = 'hot-cases'
            OR ISNULL(Balance, 0) >= 5000
            OR UPPER(ISNULL(Status, '')) LIKE '%HOT%'
          THEN CAST(1 AS bit)
          ELSE CAST(0 AS bit)
        END AS isHotCase
      FROM dbo.TrackingItemsTbl
      WHERE IsActive = 1
        AND ViewType = @viewType
        AND FacilityName = @facilityName
        AND (@companyId IS NULL OR CompanyId = @companyId)
        AND DatasetId = @datasetId
      ORDER BY ISNULL(UpdatedAt, CreatedAt) DESC
    `)

    res.json({ items: result.recordset })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load tracking items."
    res.status(500).json({ items: [], error: message })
  }
}

export async function getHotCases(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({ error: "companyId is required.", items: [] })
      return
    }
    const facilityIdList = sanitizeFacilityIdsForCsv(
      parseFacilityIdsFromQuery(req.query as Record<string, unknown>)
    )
    const pool = await getTrackingPool()
    const includeHot = await hasIsHotCaseColumn(pool)
    if (!includeHot) {
      res.json({
        items: [],
        error:
          "IsHotCase column is not available on TrackingItemsTbl yet. Apply the latest schema migration.",
      })
      return
    }
    const r = pool.request()
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("facilityIdList", sql.NVarChar(sql.MAX), facilityIdList)
    const result = await r.query(`
      SELECT TOP 500
        ti.TrackingItemId,
        ti.ResidentName,
        ti.FacilityName,
        ti.ViewType,
        ti.Status,
        ti.Balance,
        ti.UpdatedAt
      FROM dbo.TrackingItemsTbl ti
      WHERE ti.IsActive = 1
        AND ti.CompanyId = @companyId
        AND ti.DatasetId = @datasetId
        AND ISNULL(ti.IsHotCase, 0) = 1
        ${SQL_FILTER_FACILITY_LIST_TI}
      ORDER BY ISNULL(ti.UpdatedAt, ti.CreatedAt) DESC
    `)
    const items = result.recordset.map((row: Record<string, unknown>) => ({
      trackingItemId: row.TrackingItemId,
      residentName: row.ResidentName,
      facilityName: row.FacilityName,
      viewType: row.ViewType,
      status: row.Status,
      balance: row.Balance,
      updatedAt:
        row.UpdatedAt instanceof Date
          ? row.UpdatedAt.toISOString()
          : row.UpdatedAt
            ? new Date(row.UpdatedAt as string).toISOString()
            : null,
    }))
    res.json({ items })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load hot cases."
    res.status(500).json({ items: [], error: message })
  }
}

export async function getTasks(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const companyId = Number(
      req.query.companyId ??
        process.env.TRACKING_DEFAULT_COMPANY_ID ??
        "1"
    )
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid companyId" })
      return
    }
    const statusFilter = (req.query.status as string)?.trim() || null
    const assigneeFilter = (req.query.assignee as string)?.trim() || null
    const searchFilter = (req.query.search as string)?.trim() || null
    const facilityFilter = (req.query.facilityName as string)?.trim() || null
    const page = Math.max(1, Number(req.query.page ?? "1"))
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize ?? "50"))
    )
    const offset = (page - 1) * pageSize
    const sortByRaw = (req.query.sortBy as string)?.trim() || "createdAt"
    const sortCol = SORT_COLUMNS[sortByRaw] ?? "t.CreatedAt"
    const sortDir =
      (req.query.sortDirection as string)?.toLowerCase() === "asc"
        ? "ASC"
        : "DESC"
    const whereClause = `
      WHERE t.CompanyId = @companyId
        AND t.DatasetId = @datasetId
        AND (@status IS NULL OR t.Status = @status)
        AND (@assignee IS NULL OR t.Assignee LIKE N'%' + @assignee + N'%')
        AND (@search IS NULL OR t.Title LIKE N'%' + @search + N'%')
        AND (@facilityName IS NULL OR p.FacilityName = @facilityName)
    `
    const pool = await getTrackingPool()
    const facReq = pool.request()
    facReq.input("companyId", sql.Int, companyId)
    facReq.input("datasetId", sql.NVarChar(64), datasetId)
    const facResult = await facReq.query(`
      SELECT DISTINCT p.FacilityName
      FROM dbo.ResidentTask t
      INNER JOIN dbo.TrackingItemsTbl p
        ON t.TrackingItemId = p.TrackingItemId
        AND p.CompanyId = t.CompanyId
      WHERE t.CompanyId = @companyId
        AND t.DatasetId = @datasetId
        AND p.FacilityName IS NOT NULL
        AND p.FacilityName <> N''
      ORDER BY p.FacilityName
    `)
    const facilities = facResult.recordset.map(
      (r: { FacilityName: string }) => r.FacilityName
    )
    const rq = pool.request()
    rq.input("companyId", sql.Int, companyId)
    rq.input("datasetId", sql.NVarChar(64), datasetId)
    rq.input("status", sql.NVarChar(50), statusFilter)
    rq.input("assignee", sql.NVarChar(256), assigneeFilter)
    rq.input("search", sql.NVarChar(256), searchFilter)
    rq.input("facilityName", sql.NVarChar(256), facilityFilter)
    rq.input("offset", sql.Int, offset)
    rq.input("pageSize", sql.Int, pageSize)
    const countResult = await rq.query<{ TotalCount: number }>(`
      SELECT COUNT(*) AS TotalCount
      FROM dbo.ResidentTask t
      LEFT JOIN dbo.TrackingItemsTbl p
        ON t.TrackingItemId = p.TrackingItemId
        AND p.CompanyId = t.CompanyId
      ${whereClause}
    `)
    const totalCount = countResult.recordset[0]?.TotalCount ?? 0
    const rq2 = pool.request()
    rq2.input("companyId", sql.Int, companyId)
    rq2.input("datasetId", sql.NVarChar(64), datasetId)
    rq2.input("status", sql.NVarChar(50), statusFilter)
    rq2.input("assignee", sql.NVarChar(256), assigneeFilter)
    rq2.input("search", sql.NVarChar(256), searchFilter)
    rq2.input("facilityName", sql.NVarChar(256), facilityFilter)
    rq2.input("offset", sql.Int, offset)
    rq2.input("pageSize", sql.Int, pageSize)
    const result = await rq2.query(`
      SELECT
        t.TaskId,
        t.TrackingItemId,
        t.Title,
        t.DueDate,
        t.Status,
        t.Assignee,
        t.Notes,
        t.CreatedAt,
        t.CreatedBy,
        p.ResidentName,
        p.FacilityName
      FROM dbo.ResidentTask t
      LEFT JOIN dbo.TrackingItemsTbl p
        ON t.TrackingItemId = p.TrackingItemId
        AND p.CompanyId = t.CompanyId
      ${whereClause}
      ORDER BY ${sortCol} ${sortDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `)
    const tasks = result.recordset.map((r: Record<string, unknown>) => ({
      taskId: r.TaskId,
      trackingItemId: r.TrackingItemId,
      title: r.Title,
      dueDate: r.DueDate
        ? (r.DueDate as Date).toISOString().slice(0, 10)
        : null,
      status: r.Status,
      assignee: r.Assignee,
      notes: r.Notes,
      createdAt: (r.CreatedAt as Date).toISOString(),
      createdBy: r.CreatedBy,
      residentName: r.ResidentName,
      facilityName: r.FacilityName,
    }))
    res.json({ tasks, totalCount, page, pageSize, facilities })
  } catch (e) {
    console.error("GET /api/tasks error:", e)
    res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    })
  }
}

export async function getViewTypes(req: Request, res: Response) {
  try {
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({
        error: "companyId is required (or set TRACKING_DEFAULT_COMPANY_ID).",
      })
      return
    }
    const facilityIdList = sanitizeFacilityIdsForCsv(
      parseFacilityIdsFromQuery(req.query as Record<string, unknown>)
    )
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("companyId", sql.Int, companyId)
    r.input("facilityIdList", sql.NVarChar(sql.MAX), facilityIdList)
    const result = await r.query(`
      SELECT DISTINCT LTRIM(RTRIM(ti.ViewType)) AS ViewType
      FROM dbo.TrackingItemsTbl ti
      WHERE ti.CompanyId = @companyId
        AND ti.IsActive = 1
        AND ti.ViewType IS NOT NULL
        AND LTRIM(RTRIM(ti.ViewType)) <> N''
        ${SQL_FILTER_FACILITY_LIST_TI}
      ORDER BY ViewType
    `)
    const viewTypes = result.recordset
      .map((row: { ViewType: string }) => row.ViewType)
      .filter((v): v is string => typeof v === "string" && v.length > 0)
    const tabs = viewTypes.map((viewType) => ({
      viewType,
      label: viewType
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " "),
    }))
    res.json({ tabs })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load view types."
    res.status(500).json({ tabs: [], error: message })
  }
}

export async function getFacilities(req: Request, res: Response) {
  try {
    const companyId = Number(
      req.query.companyId ??
        process.env.TRACKING_DEFAULT_COMPANY_ID ??
        "1"
    )
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid companyId" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("companyId", sql.Int, companyId)
    const result = await r.query(`
      SELECT DISTINCT FacilityId, FacilityName
      FROM dbo.TrackingItemsTbl
      WHERE CompanyId = @companyId
        AND FacilityName IS NOT NULL
        AND FacilityName <> N''
      ORDER BY FacilityName
    `)
    const facilities = result.recordset.map(
      (row: { FacilityId: string; FacilityName: string }) => ({
        facilityId: row.FacilityId,
        facilityName: row.FacilityName,
      })
    )
    res.json({ facilities })
  } catch (e) {
    console.error("GET /api/pending-tracking/facilities error:", e)
    res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    })
  }
}

export async function getFields(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({ error: "companyId is required", fields: [] })
      return
    }
    const payerType = (req.query.payerType as string)?.trim() ?? ""
    if (!payerType) {
      res.status(400).json({ error: "payerType is required", fields: [] })
      return
    }
    const stateRaw = (req.query.state as string)?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null
    const locRaw = (req.query.screenLocation as string)?.trim() ?? "Main"
    const screenLocation =
      locRaw.toLowerCase() === "detail" ? SCREEN_DETAIL : SCREEN_MAIN
    const pool = await getTrackingPool()
    const fields = await loadFieldMetadataForScreen(pool, {
      companyId,
      datasetId,
      payerType,
      state,
      screenLocation,
    })
    res.json({
      fields: fields.map((f) => ({
        fieldMetadataId: f.FieldMetadataId,
        fieldName: f.FieldName,
        displayName: f.DisplayName,
        dataType: f.DataType,
        screenLocation: f.ScreenLocation,
        displayOrder: f.DisplayOrder,
        isRequired: f.IsRequired,
        isEditable: f.IsEditable,
        isSystemField: f.IsSystemField,
        sourceType: f.SourceType,
        sourceColumnName: f.SourceColumnName,
        fieldKind: f.FieldKind ?? "regular",
      })),
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load fields."
    res.status(500).json({ error: message, fields: [] })
  }
}

export async function getGrid(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({
        error: "companyId is required (or set TRACKING_DEFAULT_COMPANY_ID).",
      })
      return
    }
    const viewTypeRaw = (req.query.viewType as string)?.trim() ?? ""
    if (!viewTypeRaw || !isValidViewTypeParam(viewTypeRaw)) {
      res.status(400).json({
        error: "viewType is required and must be a valid value.",
      })
      return
    }
    const stateRaw = (req.query.state as string)?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null
    const params: GridQueryParams = {
      companyId,
      datasetId,
      viewType: viewTypeRaw,
      state,
      search: (req.query.search as string) ?? null,
      facilityIds: parseFacilityIdsFromQuery(req.query as Record<string, unknown>),
      status: (req.query.status as string) ?? null,
      page: Math.max(1, Number(req.query.page ?? "1")),
      pageSize: Math.min(
        200,
        Math.max(1, Number(req.query.pageSize ?? "25"))
      ),
      sortBy: (req.query.sortBy as string) ?? "trackingItemId",
      sortDirection:
        req.query.sortDirection === "desc" ? "desc" : "asc",
      includeInactive: queryTruthyFlag(
        req.query as Record<string, unknown>,
        "includeInactive",
        "showAll"
      ),
    }
    const pool = await getTrackingPool()
    const fields = await loadGridFieldMetadata(
      pool,
      companyId,
      datasetId,
      viewTypeRaw,
      state
    )
    if (fields.length === 0) {
      res.json({
        columns: [],
        rows: [],
        totalCount: 0,
        page: params.page,
        pageSize: params.pageSize,
        defaultSortKey: "trackingItemId",
        error:
          "No grid fields configured. Run sql/003-field-metadata-schema.sql and sql/004-seed-field-metadata-from-pending-tracking-item.sql, then set ScreenLocation = Main for columns to show.",
      } satisfies PendingTrackingGridResponse & { error?: string })
      return
    }
    const columns = buildGridColumnMetadataFromFields(fields)
    const defaultSortKey =
      columns.find((c) => !c.isCalculated)?.key ?? "trackingItemId"
    const dropdownColIds = columns
      .filter((c) => c.type === "dropdown")
      .map((c) => c.fieldMetadataId)
    if (dropdownColIds.length > 0) {
      const optionsMap = await fetchDropdownOptionsForFields(
        pool,
        datasetId,
        dropdownColIds
      )
      for (const col of columns) {
        if (col.type === "dropdown") {
          col.dropdownOptions = optionsMap.get(col.fieldMetadataId) ?? []
        }
      }
    }
    const includeHotCase = await hasIsHotCaseColumn(pool)
    const useReportEligibleTvf = await hasReportEligibleItemsTvf(pool)
    const useSpItemIdsBatch =
      useReportItemIdsProcedureForGrid() &&
      useReportEligibleTvf &&
      (await hasReportSelectItemIdsProcedure(pool))

    let totalCount = 0
    let rows: Record<string, unknown>[] = []

    if (useSpItemIdsBatch) {
      const batchSql = buildGridPagedBatchViaReportItemIdsProc(
        fields,
        params,
        includeHotCase
      )
      const batchRequest = pool.request()
      applyGridRequestInputs(batchRequest, params)
      const batchResult = await batchRequest.query(batchSql)
      const parsed = parseGridPagedBatchRecordsets(
        batchResult.recordsets as Record<string, unknown>[][]
      )
      totalCount = parsed.totalCount
      rows = parsed.rows.map((r) => mapGridRowWithFieldMetadata(r, fields))
    } else {
      const { sql: dataSql } = buildGridDataSql(
        fields,
        params,
        includeHotCase,
        useReportEligibleTvf
      )
      const countSql = buildGridCountSql(params, useReportEligibleTvf)
      const dataRequest = pool.request()
      applyGridRequestInputs(dataRequest, params)
      const dataResult = await dataRequest.query(dataSql)
      const countRequest = pool.request()
      applyGridRequestInputs(countRequest, params)
      const countResult = await countRequest.query<{ TotalCount: number }>(
        countSql
      )
      totalCount = countResult.recordset[0]?.TotalCount ?? 0
      rows = dataResult.recordset.map((r: Record<string, unknown>) =>
        mapGridRowWithFieldMetadata(r, fields)
      )
    }
    const formattingRules = await loadConditionalFormattingRules(
      pool,
      companyId,
      datasetId,
      viewTypeRaw
    )
    rows = applyConditionalFormattingToRows(rows, formattingRules)
    res.json({
      columns,
      rows,
      totalCount,
      page: params.page,
      pageSize: params.pageSize,
      defaultSortKey,
      formattingRules: formattingRules.map((r) => ({
        id: r.id,
        reportKey: r.reportKey,
        targetFieldKey: r.targetFieldKey,
        applyTo: r.applyTo,
        backgroundColor: r.backgroundColor,
        textColor: r.textColor,
        conditionFormula: r.conditionFormula,
        conditionTree: r.conditionTree,
        isEnabled: r.isEnabled,
        sortOrder: r.sortOrder,
      })),
    } satisfies PendingTrackingGridResponse)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load grid."
    res.status(500).json({
      columns: [],
      rows: [],
      totalCount: 0,
      page: 1,
      pageSize: 25,
      defaultSortKey: "trackingItemId",
      error: message,
    } satisfies PendingTrackingGridResponse & { error?: string })
  }
}

export async function getExport(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({ error: "companyId is required." })
      return
    }
    const viewTypeRaw = (req.query.viewType as string)?.trim() ?? ""
    if (!viewTypeRaw || !isValidViewTypeParam(viewTypeRaw)) {
      res.status(400).json({
        error: "viewType is required and must be a valid value.",
      })
      return
    }
    const stateRaw = (req.query.state as string)?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null
    const params: GridQueryParams = {
      companyId,
      datasetId,
      viewType: viewTypeRaw,
      state,
      search: (req.query.search as string) ?? null,
      facilityIds: parseFacilityIdsFromQuery(req.query as Record<string, unknown>),
      status: (req.query.status as string) ?? null,
      page: 1,
      pageSize: 100_000,
      sortBy: "trackingItemId",
      sortDirection: "asc",
      includeInactive: queryTruthyFlag(
        req.query as Record<string, unknown>,
        "includeInactive",
        "showAll"
      ),
    }
    const pool = await getTrackingPool()
    const loaded = await loadGridExportRows(
      pool,
      params,
      viewTypeRaw,
      state
    )
    if (!loaded) {
      res.status(400).json({ error: "No fields configured for export." })
      return
    }
    const { columns: rawColumns, rows, includeHotCase } = loaded
    const keysCsv = parseColumnKeysFromQuery(req.query as Record<string, unknown>)
    const columns = orderColumnsByKeys(rawColumns, keysCsv)
    const headers = [
      ...columns.map((c) => c.title),
      ...(includeHotCase ? ["Hot Case"] : []),
      "Active",
      "Stopped at",
      "Stopped by",
    ]
    const sheetData = rows.map((row: Record<string, unknown>) => {
      const values: unknown[] = columns.map((c) => {
        const val = row[c.key]
        return formatExportCellValue(val, c)
      })
      if (includeHotCase) {
        values.push(row.isHotCase ? "Yes" : "No")
      }
      values.push(exportRowActiveLabel(row))
      values.push(exportRowStoppedAt(row))
      values.push(
        row.stoppedBy != null && row.stoppedBy !== ""
          ? String(row.stoppedBy)
          : ""
      )
      return values
    })
    const wsData = [headers, ...sheetData]
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    ws["!cols"] = headers.map((h: string, i: number) => {
      let maxLen = h.length
      for (const row of sheetData) {
        const cellLen = String((row as unknown[])[i] ?? "").length
        if (cellLen > maxLen) maxLen = cellLen
      }
      return { wch: Math.min(maxLen + 2, 50) }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, viewTypeRaw)
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })
    const filename = `${viewTypeRaw.replace(/[^a-zA-Z0-9]/g, "_")}_export_${new Date().toISOString().slice(0, 10)}.xlsx`
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    res.send(Buffer.from(buf))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed."
    res.status(500).json({ error: message })
  }
}

export async function getExportPdf(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({ error: "companyId is required." })
      return
    }
    const viewTypeRaw = (req.query.viewType as string)?.trim() ?? ""
    if (!viewTypeRaw || !isValidViewTypeParam(viewTypeRaw)) {
      res.status(400).json({
        error: "viewType is required and must be a valid value.",
      })
      return
    }
    const stateRaw = (req.query.state as string)?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null
    const params: GridQueryParams = {
      companyId,
      datasetId,
      viewType: viewTypeRaw,
      state,
      search: (req.query.search as string) ?? null,
      facilityIds: parseFacilityIdsFromQuery(req.query as Record<string, unknown>),
      status: (req.query.status as string) ?? null,
      page: 1,
      pageSize: 100_000,
      sortBy: "trackingItemId",
      sortDirection: "asc",
      includeInactive: queryTruthyFlag(
        req.query as Record<string, unknown>,
        "includeInactive",
        "showAll"
      ),
    }
    const pool = await getTrackingPool()
    const loaded = await loadGridExportRows(
      pool,
      params,
      viewTypeRaw,
      state
    )
    if (!loaded) {
      res.status(400).json({ error: "No fields configured for export." })
      return
    }
    const { columns: rawColumns, rows, includeHotCase } = loaded
    const keysCsv = parseColumnKeysFromQuery(req.query as Record<string, unknown>)
    const columns = orderColumnsByKeys(rawColumns, keysCsv)
    const headers = [
      ...columns.map((c) => c.title),
      ...(includeHotCase ? ["Hot Case"] : []),
      "Active",
      "Stopped at",
      "Stopped by",
    ]
    const pdfRows: string[][] = rows.map((row) => {
      const cells: string[] = columns.map((c) =>
        formatExportCellValue(row[c.key], c)
      )
      if (includeHotCase) cells.push(row.isHotCase ? "Yes" : "No")
      cells.push(exportRowActiveLabel(row))
      cells.push(exportRowStoppedAt(row))
      cells.push(
        row.stoppedBy != null && row.stoppedBy !== ""
          ? String(row.stoppedBy)
          : ""
      )
      return cells
    })
    const title = `Medicaid Pending List — ${viewTypeRaw} (Company ${companyId})`
    const filename = `${viewTypeRaw.replace(/[^a-zA-Z0-9]/g, "_")}_export_${new Date().toISOString().slice(0, 10)}.pdf`
    streamTrackingGridPdf(res, {
      titleLine: title,
      headers,
      rows: pdfRows,
      filename,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PDF export failed."
    if (!res.headersSent) res.status(500).json({ error: message })
  }
}

export async function getPendingDetail(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const stateRaw = (req.query.state as string)?.trim() ?? ""
    const state = stateRaw.length >= 2 ? stateRaw.slice(0, 2).toUpperCase() : null
    const pool = await getTrackingPool()
    const body = await buildDetailResponse(pool, trackingItemId, datasetId, state)
    if (!body) {
      res.status(404).json({ error: "Not found" })
      return
    }
    res.json(body)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load detail."
    res.status(500).json({ error: message })
  }
}

export async function deletePendingItem(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const stoppedBy = stoppedByFromRequest(req)
    const pool = await getTrackingPool()
    const transaction = new sql.Transaction(pool)
    await transaction.begin()
    try {
      const upd = new sql.Request(transaction)
      upd.input("trackingItemId", sql.Int, trackingItemId)
      upd.input("companyId", sql.Int, companyId)
      upd.input("datasetId", sql.NVarChar(64), datasetId)
      upd.input("stoppedBy", sql.NVarChar(256), stoppedBy)
      const updResult = await upd.query(`
        UPDATE dbo.TrackingItemsTbl
        SET IsActive = 0,
            StoppedAt = SYSUTCDATETIME(),
            StoppedBy = @stoppedBy
        WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId
      `)
      const n = updResult.rowsAffected?.[0] ?? 0
      if (!n) {
        await transaction.rollback()
        res.status(404).json({ error: "Not found or access denied." })
        return
      }
      const ins = new sql.Request(transaction)
      ins.input("trackingItemId", sql.Int, trackingItemId)
      ins.input("companyId", sql.Int, companyId)
      ins.input("datasetId", sql.NVarChar(64), datasetId)
      ins.input("stoppedBy", sql.NVarChar(256), stoppedBy)
      await ins.query(`
        INSERT INTO dbo.TrackingItemStopAudit (TrackingItemId, CompanyId, DatasetId, StoppedBy)
        VALUES (@trackingItemId, @companyId, @datasetId, @stoppedBy)
      `)
      await transaction.commit()
    } catch (e) {
      await transaction.rollback()
      throw e
    }
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete item."
    res.status(500).json({ error: message })
  }
}

const putValuesSchema = z.object({
  values: z.record(z.unknown()).optional(),
})

export async function putPendingValues(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const parsed = putValuesSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid JSON body", details: parsed.error.flatten() })
      return
    }
    const values = parsed.data.values ?? {}
    const pool = await getTrackingPool()
    const baseRow = await fetchTrackingItemBase(pool, trackingItemId, datasetId)
    if (!baseRow) {
      res.status(404).json({ error: "Not found" })
      return
    }
    const companyId = Number(baseRow.CompanyId)
    if (!Number.isFinite(companyId)) {
      res.status(422).json({ error: "Invalid company" })
      return
    }
    const result = await saveTrackingItemFieldValues(
      pool,
      trackingItemId,
      companyId,
      datasetId,
      values
    )
    res.json({ ok: true, ...result })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save values."
    res.status(500).json({ error: message })
  }
}

const hotCaseSchema = z.object({
  companyId: z.coerce.number().optional(),
  isHotCase: z.boolean(),
})

export async function patchHotCase(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const parsed = hotCaseSchema.safeParse(req.body)
    if (!parsed.success || !Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const companyId = Number(
      parsed.data.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("isHotCase", sql.Bit, parsed.data.isHotCase ? 1 : 0)
    await r.query(`
      UPDATE dbo.TrackingItemsTbl
      SET IsHotCase = @isHotCase
      WHERE TrackingItemId = @trackingItemId
        AND CompanyId = @companyId
        AND DatasetId = @datasetId
    `)
    res.json({ ok: true, isHotCase: parsed.data.isHotCase })
  } catch (e) {
    console.error("PATCH hot-case error:", e)
    res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    })
  }
}

export async function getNotes(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (!Number.isFinite(trackingItemId) || companyId === null) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const result = await r.query(`
      SELECT NoteId, NoteType, Body, CreatedAt, CreatedBy,
        CAST(ISNULL(IsPinned, 0) AS BIT) AS IsPinned,
        CAST(ISNULL(IsHighlighted, 0) AS BIT) AS IsHighlighted
      FROM dbo.ResidentNote
      WHERE TrackingItemId = @trackingItemId
        AND CompanyId = @companyId
        AND DatasetId = @datasetId
        AND ISNULL(Body, '') <> '__SOFT_DELETED__'
      ORDER BY CASE WHEN ISNULL(IsPinned, 0) = 1 THEN 0 ELSE 1 END, CreatedAt DESC
    `)
    const notes = result.recordset.map((row: Record<string, unknown>) => ({
      noteId: row.NoteId,
      noteType: row.NoteType,
      body: row.Body,
      createdAt: (row.CreatedAt instanceof Date
        ? row.CreatedAt
        : new Date(row.CreatedAt as string)
      ).toISOString(),
      createdBy: row.CreatedBy,
      isPinned: Boolean(row.IsPinned),
      isHighlighted: Boolean(row.IsHighlighted),
    }))
    res.json({ notes })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load notes."
    res.status(500).json({ error: message, notes: [] })
  }
}

const postNoteSchema = z.object({
  companyId: z.coerce.number(),
  body: z.string().min(1),
  noteType: z.string().optional(),
  isPinned: z.boolean().optional(),
  isHighlighted: z.boolean().optional(),
})

export async function postNote(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const parsed = postNoteSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "companyId, body required" })
      return
    }
    const validTypes = ["CaseNote", "Internal", "External"]
    const rawType = parsed.data.noteType?.trim() ?? ""
    const noteType = validTypes.includes(rawType) ? rawType : "CaseNote"
    const isPinned = parsed.data.isPinned ? 1 : 0
    const isHighlighted = parsed.data.isHighlighted ? 1 : 0
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, parsed.data.companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("noteType", sql.NVarChar(50), noteType)
    r.input("body", sql.NVarChar(sql.MAX), parsed.data.body.trim())
    r.input("createdBy", sql.NVarChar(256), "system")
    r.input("isPinned", sql.Bit, isPinned)
    r.input("isHighlighted", sql.Bit, isHighlighted)
    const result = await r.query<{ NoteId: number }>(`
      INSERT INTO dbo.ResidentNote (TrackingItemId, CompanyId, DatasetId, NoteType, Body, CreatedBy, IsPinned, IsHighlighted)
      OUTPUT INSERTED.NoteId
      VALUES (@trackingItemId, @companyId, @datasetId, @noteType, @body, @createdBy, @isPinned, @isHighlighted)
    `)
    const noteId = Number(result.recordset[0]?.NoteId)
    res.json({ ok: true, noteId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create note."
    res.status(500).json({ error: message })
  }
}

export async function patchNote(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const noteId = Number(req.params.noteId)
    const json = req.body as {
      companyId?: number
      body?: string
      noteType?: string
      isPinned?: boolean
      isHighlighted?: boolean
    }
    const companyId = Number(
      json.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(noteId) ||
      !Number.isFinite(companyId)
    ) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const sets: string[] = []
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("noteId", sql.Int, noteId)
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    if (json.body != null) {
      sets.push("Body = @body")
      r.input("body", sql.NVarChar(sql.MAX), json.body)
    }
    if (json.noteType != null) {
      const validTypes = ["CaseNote", "Internal", "External"]
      const nt = String(json.noteType).trim()
      if (validTypes.includes(nt)) {
        sets.push("NoteType = @noteType")
        r.input("noteType", sql.NVarChar(50), nt)
      }
    }
    if (typeof json.isPinned === "boolean") {
      sets.push("IsPinned = @isPinned")
      r.input("isPinned", sql.Bit, json.isPinned ? 1 : 0)
    }
    if (typeof json.isHighlighted === "boolean") {
      sets.push("IsHighlighted = @isHighlighted")
      r.input("isHighlighted", sql.Bit, json.isHighlighted ? 1 : 0)
    }
    if (sets.length === 0) {
      res.status(400).json({ error: "Nothing to update" })
      return
    }
    await r.query(`
      UPDATE dbo.ResidentNote
      SET ${sets.join(", ")}
      WHERE NoteId = @noteId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update note."
    res.status(500).json({ error: message })
  }
}

export async function deleteNote(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const noteId = Number(req.params.noteId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(noteId) ||
      companyId === null
    ) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("noteId", sql.Int, noteId)
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    await r.query(`
      UPDATE dbo.ResidentNote
      SET Body = '__SOFT_DELETED__',
          IsPinned = 0,
          IsHighlighted = 0
      WHERE NoteId = @noteId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete note."
    res.status(500).json({ error: message })
  }
}

export async function getEmails(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (!Number.isFinite(trackingItemId) || companyId === null) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const colCheck = await pool.request().query(`
      SELECT name FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name IN (N'Body', N'CcEmails')
    `)
    const existingCols = new Set(
      colCheck.recordset.map((row: { name: string }) => row.name)
    )
    const bodyCol = existingCols.has("Body") ? ", Body" : ", NULL AS Body"
    const ccCol = existingCols.has("CcEmails") ? ", CcEmails" : ", NULL AS CcEmails"
    const result = await r.query(`
      SELECT EmailId, Subject${bodyCol}, RecipientEmail, RecipientName${ccCol}, SentAt, SentBy, Status, ExternalMessageId
      FROM dbo.ResidentEmail
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId
      ORDER BY SentAt DESC
    `)
    const emails = result.recordset.map((row: Record<string, unknown>) => ({
      emailId: row.EmailId,
      subject: row.Subject,
      body: row.Body ?? null,
      recipientEmail: row.RecipientEmail,
      recipientName: row.RecipientName,
      ccEmails: row.CcEmails ?? null,
      sentAt: (row.SentAt instanceof Date
        ? row.SentAt
        : new Date(row.SentAt as string)
      ).toISOString(),
      sentBy: row.SentBy,
      status: row.Status,
      externalMessageId: row.ExternalMessageId,
    }))
    res.json({ emails })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load emails."
    res.status(500).json({ error: message, emails: [] })
  }
}

const postEmailSchema = z.object({
  companyId: z.coerce.number(),
  subject: z.string().min(1),
  body: z.string().nullable().optional(),
  recipientEmail: z.string().min(1),
  recipientName: z.string().nullable().optional(),
  ccEmails: z.string().nullable().optional(),
  status: z.string().optional(),
  externalMessageId: z.string().nullable().optional(),
})

export async function postEmail(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const parsed = postEmailSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "companyId, subject, recipientEmail required" })
      return
    }
    const validStatuses = ["Sent", "Failed", "Queued"]
    const rawStatus = parsed.data.status?.trim() ?? ""
    const status = validStatuses.includes(rawStatus) ? rawStatus : "Queued"
    const pool = await getTrackingPool()
    const colCheck2 = await pool.request().query(`
      SELECT name FROM sys.columns
      WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name IN (N'Body', N'CcEmails')
    `)
    const postCols = new Set(
      colCheck2.recordset.map((row: { name: string }) => row.name)
    )
    const hasBody = postCols.has("Body")
    const hasCc = postCols.has("CcEmails")
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, parsed.data.companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("subject", sql.NVarChar(500), parsed.data.subject.trim())
    r.input("recipientEmail", sql.NVarChar(500), parsed.data.recipientEmail.trim())
    r.input("recipientName", sql.NVarChar(256), parsed.data.recipientName ?? null)
    r.input("sentBy", sql.NVarChar(256), "system")
    r.input("status", sql.NVarChar(50), status)
    r.input("externalMessageId", sql.NVarChar(500), parsed.data.externalMessageId ?? null)
    const insertCols = [
      "TrackingItemId",
      "CompanyId",
      "DatasetId",
      "Subject",
      "RecipientEmail",
      "RecipientName",
      "SentBy",
      "Status",
      "ExternalMessageId",
    ]
    const insertVals = [
      "@trackingItemId",
      "@companyId",
      "@datasetId",
      "@subject",
      "@recipientEmail",
      "@recipientName",
      "@sentBy",
      "@status",
      "@externalMessageId",
    ]
    if (hasBody) {
      r.input("emailBody", sql.NVarChar(sql.MAX), parsed.data.body ?? null)
      insertCols.push("Body")
      insertVals.push("@emailBody")
    }
    if (hasCc) {
      r.input("ccEmails", sql.NVarChar(sql.MAX), parsed.data.ccEmails ?? null)
      insertCols.push("CcEmails")
      insertVals.push("@ccEmails")
    }
    const result = await r.query<{ EmailId: number }>(`
      INSERT INTO dbo.ResidentEmail (${insertCols.join(", ")})
      OUTPUT INSERTED.EmailId
      VALUES (${insertVals.join(", ")})
    `)
    const emailId = Number(result.recordset[0]?.EmailId)
    res.json({ ok: true, emailId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to log email."
    res.status(500).json({ error: message })
  }
}

export async function getResidentTasks(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (!Number.isFinite(trackingItemId) || companyId === null) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const result = await r.query(`
      SELECT TaskId, Title, DueDate, Status, Assignee, Notes, CreatedAt, CreatedBy
      FROM dbo.ResidentTask
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId
      ORDER BY CreatedAt DESC
    `)
    const tasks = result.recordset.map((row: Record<string, unknown>) => ({
      taskId: row.TaskId,
      title: row.Title,
      dueDate: row.DueDate
        ? (row.DueDate instanceof Date
            ? row.DueDate
            : new Date(row.DueDate as string)
          )
            .toISOString()
            .slice(0, 10)
        : null,
      status: row.Status,
      assignee: row.Assignee,
      notes: row.Notes,
      createdAt: (row.CreatedAt instanceof Date
        ? row.CreatedAt
        : new Date(row.CreatedAt as string)
      ).toISOString(),
      createdBy: row.CreatedBy,
    }))
    res.json({ tasks })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load tasks."
    res.status(500).json({ error: message, tasks: [] })
  }
}

const postTaskSchema = z.object({
  companyId: z.coerce.number(),
  title: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  status: z.string().optional(),
  assignee: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export async function postResidentTask(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const parsed = postTaskSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "companyId, title required" })
      return
    }
    const validStatuses = ["Open", "InProgress", "Completed", "Cancelled"]
    const rawStatus = parsed.data.status?.trim() ?? ""
    const status = validStatuses.includes(rawStatus) ? rawStatus : "Open"
    const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null
    const dueDateVal = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, parsed.data.companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("title", sql.NVarChar(256), parsed.data.title.trim())
    r.input("dueDate", sql.Date, dueDateVal)
    r.input("status", sql.NVarChar(50), status)
    r.input("assignee", sql.NVarChar(256), parsed.data.assignee ?? null)
    r.input("notes", sql.NVarChar(sql.MAX), parsed.data.notes ?? null)
    r.input("createdBy", sql.NVarChar(256), "system")
    const result = await r.query<{ TaskId: number }>(`
      INSERT INTO dbo.ResidentTask (TrackingItemId, CompanyId, DatasetId, Title, DueDate, Status, Assignee, Notes, CreatedBy)
      OUTPUT INSERTED.TaskId
      VALUES (@trackingItemId, @companyId, @datasetId, @title, @dueDate, @status, @assignee, @notes, @createdBy)
    `)
    const taskId = Number(result.recordset[0]?.TaskId)
    res.json({ ok: true, taskId })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create task."
    res.status(500).json({ error: message })
  }
}

export async function patchResidentTask(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const taskId = Number(req.params.taskId)
    const body = req.body as {
      companyId?: number
      title?: string
      dueDate?: string | null
      status?: string
      assignee?: string | null
      notes?: string | null
    }
    const companyId = Number(body.companyId)
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(taskId) ||
      !Number.isFinite(companyId)
    ) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("taskId", sql.Int, taskId)
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const sets: string[] = ["UpdatedAt = SYSUTCDATETIME()"]
    if (body.title !== undefined) {
      r.input("title", sql.NVarChar(256), body.title.trim())
      sets.push("Title = @title")
    }
    if ("dueDate" in body) {
      const d = body.dueDate ? new Date(body.dueDate) : null
      r.input("dueDate", sql.Date, d && !Number.isNaN(d.getTime()) ? d : null)
      sets.push("DueDate = @dueDate")
    }
    const validStatuses = ["Open", "InProgress", "Completed", "Cancelled"]
    if (body.status !== undefined && validStatuses.includes(body.status)) {
      r.input("status", sql.NVarChar(50), body.status)
      sets.push("Status = @status")
    }
    if ("assignee" in body) {
      r.input("assignee", sql.NVarChar(256), body.assignee ?? null)
      sets.push("Assignee = @assignee")
    }
    if ("notes" in body) {
      r.input("notes", sql.NVarChar(sql.MAX), body.notes ?? null)
      sets.push("Notes = @notes")
    }
    await r.query(`
      UPDATE dbo.ResidentTask SET ${sets.join(", ")}
      WHERE TaskId = @taskId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update task."
    res.status(500).json({ error: message })
  }
}

export async function deleteResidentTask(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const taskId = Number(req.params.taskId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(taskId) ||
      companyId === null
    ) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("taskId", sql.Int, taskId)
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    await r.query(`
      DELETE FROM dbo.ResidentTask
      WHERE TaskId = @taskId AND TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete task."
    res.status(500).json({ error: message })
  }
}

export async function getAttachments(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (!Number.isFinite(trackingItemId) || companyId === null) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const result = await r.query(`
      SELECT AttachmentId, FileName, ContentType, FileSizeBytes, BlobUrl,
             BlobContainer, BlobName, UniqueId, ResidentId, UploadedAt, UploadedBy, Description
      FROM dbo.ResidentAttachment
      WHERE TrackingItemId = @trackingItemId AND CompanyId = @companyId AND DatasetId = @datasetId AND IsDeleted = 0
      ORDER BY UploadedAt DESC
    `)
    const attachments = result.recordset.map((row: Record<string, unknown>) => ({
      attachmentId: row.AttachmentId,
      fileName: row.FileName,
      contentType: row.ContentType,
      fileSizeBytes: row.FileSizeBytes,
      blobUrl: row.BlobUrl,
      blobContainer: row.BlobContainer,
      blobName: row.BlobName,
      uniqueId: row.UniqueId,
      residentId: row.ResidentId,
      uploadedAt: (row.UploadedAt instanceof Date
        ? row.UploadedAt
        : new Date(row.UploadedAt as string)
      ).toISOString(),
      uploadedBy: row.UploadedBy,
      description: row.Description,
    }))
    res.json({ attachments })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load attachments."
    res.status(500).json({ error: message, attachments: [] })
  }
}

const postAttachmentSchema = z.object({
  companyId: z.coerce.number(),
  fileName: z.string().min(1),
  contentType: z.string().optional(),
  fileSizeBytes: z.number().nullable().optional(),
  blobUrl: z.string().min(1),
  blobContainer: z.string().min(1),
  blobName: z.string().min(1),
  uniqueId: z.string().nullable().optional(),
  residentId: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
})

function firstNonEmptyString(
  value: unknown,
  maxLen = 200
): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (!v) return null
  return v.slice(0, maxLen)
}

async function resolveAttachmentIds(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  trackingItemId: number,
  explicitUniqueId: unknown,
  explicitResidentId: unknown
): Promise<{ uniqueId: string | null; residentId: string | null }> {
  const bodyUniqueId = firstNonEmptyString(explicitUniqueId, 200)
  const bodyResidentId = firstNonEmptyString(explicitResidentId, 200)
  if (bodyUniqueId || bodyResidentId) {
    return { uniqueId: bodyUniqueId, residentId: bodyResidentId }
  }

  const r = pool.request()
  r.input("trackingItemId", sql.Int, trackingItemId)
  const result = await r.query<Record<string, unknown>>(`
    SELECT TOP 1 *
    FROM dbo.TrackingItemsTbl
    WHERE TrackingItemId = @trackingItemId
  `)
  const row = result.recordset[0] ?? {}
  const keyMap = new Map<string, unknown>()
  for (const [k, v] of Object.entries(row)) keyMap.set(k.toLowerCase(), v)

  const uniqueId =
    firstNonEmptyString(keyMap.get("uniqueid"), 200) ??
    firstNonEmptyString(keyMap.get("unique_id"), 200)
  const residentId =
    firstNonEmptyString(keyMap.get("residentid"), 200) ??
    firstNonEmptyString(keyMap.get("resstayid"), 200) ??
    firstNonEmptyString(keyMap.get("cid"), 200)

  return { uniqueId: bodyUniqueId ?? uniqueId, residentId: bodyResidentId ?? residentId }
}

export async function postAttachment(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const parsed = postAttachmentSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error: "companyId, fileName, blobUrl, blobContainer, blobName required",
      })
      return
    }
    const pool = await getTrackingPool()
    const resolvedIds = await resolveAttachmentIds(
      pool,
      trackingItemId,
      parsed.data.uniqueId,
      parsed.data.residentId
    )
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, parsed.data.companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("fileName", sql.NVarChar(500), parsed.data.fileName.trim())
    r.input("contentType", sql.NVarChar(200), parsed.data.contentType?.trim() ?? "application/octet-stream")
    r.input("fileSizeBytes", sql.BigInt, parsed.data.fileSizeBytes ?? null)
    r.input("blobUrl", sql.NVarChar(2000), parsed.data.blobUrl.trim())
    r.input("blobContainer", sql.NVarChar(256), parsed.data.blobContainer.trim())
    r.input("blobName", sql.NVarChar(1000), parsed.data.blobName.trim())
    r.input("uniqueId", sql.NVarChar(200), resolvedIds.uniqueId)
    r.input("residentId", sql.NVarChar(200), resolvedIds.residentId)
    r.input("uploadedBy", sql.NVarChar(256), "system")
    r.input("description", sql.NVarChar(1000), parsed.data.description ?? null)
    const result = await r.query<{ AttachmentId: number }>(`
      INSERT INTO dbo.ResidentAttachment
        (TrackingItemId, CompanyId, DatasetId, FileName, ContentType, FileSizeBytes,
         BlobUrl, BlobContainer, BlobName, UniqueId, ResidentId, UploadedBy, Description)
      OUTPUT INSERTED.AttachmentId
      VALUES
        (@trackingItemId, @companyId, @datasetId, @fileName, @contentType, @fileSizeBytes,
         @blobUrl, @blobContainer, @blobName, @uniqueId, @residentId, @uploadedBy, @description)
    `)
    const attachmentId = Number(result.recordset[0]?.AttachmentId)
    res.json({ ok: true, attachmentId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to log attachment."
    res.status(500).json({ error: message })
  }
}

export async function postAttachmentUpload(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    if (!Number.isFinite(trackingItemId)) {
      res.status(400).json({ error: "Invalid trackingItemId" })
      return
    }
    const companyId = Number(req.body?.companyId)
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid companyId" })
      return
    }
    const file = (req as Request & { file?: Express.Multer.File }).file
    if (!file?.buffer || !file.originalname) {
      res.status(400).json({ error: "file is required" })
      return
    }
    const descriptionRaw = req.body?.description
    const uniqueIdRaw = req.body?.uniqueId
    const residentIdRaw = req.body?.residentId
    const description =
      typeof descriptionRaw === "string" && descriptionRaw.trim().length > 0
        ? descriptionRaw.trim().slice(0, 1000)
        : null
    const uploadedByRaw = req.body?.uploadedBy
    const uploadedBy =
      typeof uploadedByRaw === "string" && uploadedByRaw.trim().length > 0
        ? uploadedByRaw.trim().slice(0, 256)
        : "system"

    const upload = await uploadResidentAttachment({
      trackingItemId,
      companyId,
      originalFileName: file.originalname,
      contentType: file.mimetype || "application/octet-stream",
      bytes: file.buffer,
    })

    const pool = await getTrackingPool()
    const resolvedIds = await resolveAttachmentIds(
      pool,
      trackingItemId,
      uniqueIdRaw,
      residentIdRaw
    )
    const r = pool.request()
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("fileName", sql.NVarChar(500), file.originalname.trim().slice(0, 500))
    r.input("contentType", sql.NVarChar(200), (file.mimetype || "application/octet-stream").slice(0, 200))
    r.input("fileSizeBytes", sql.BigInt, file.size)
    r.input("blobUrl", sql.NVarChar(2000), upload.blobUrl)
    r.input("blobContainer", sql.NVarChar(256), upload.blobContainer)
    r.input("blobName", sql.NVarChar(1000), upload.blobName)
    r.input("uniqueId", sql.NVarChar(200), resolvedIds.uniqueId)
    r.input("residentId", sql.NVarChar(200), resolvedIds.residentId)
    r.input("uploadedBy", sql.NVarChar(256), uploadedBy)
    r.input("description", sql.NVarChar(1000), description)
    const result = await r.query<{ AttachmentId: number }>(`
      INSERT INTO dbo.ResidentAttachment
        (TrackingItemId, CompanyId, DatasetId, FileName, ContentType, FileSizeBytes,
         BlobUrl, BlobContainer, BlobName, UniqueId, ResidentId, UploadedBy, Description)
      OUTPUT INSERTED.AttachmentId
      VALUES
        (@trackingItemId, @companyId, @datasetId, @fileName, @contentType, @fileSizeBytes,
         @blobUrl, @blobContainer, @blobName, @uniqueId, @residentId, @uploadedBy, @description)
    `)
    const attachmentId = Number(result.recordset[0]?.AttachmentId)
    res.json({ ok: true, attachmentId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to upload attachment."
    res.status(500).json({ error: message })
  }
}

export async function getAttachmentDownload(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const attachmentId = Number(req.params.attachmentId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(attachmentId) ||
      companyId === null
    ) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("attachmentId", sql.Int, attachmentId)
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const result = await r.query<{
      BlobContainer: string
      BlobName: string
      FileName: string
    }>(`
      SELECT BlobContainer, BlobName, FileName
      FROM dbo.ResidentAttachment
      WHERE AttachmentId = @attachmentId
        AND TrackingItemId = @trackingItemId
        AND CompanyId = @companyId
        AND DatasetId = @datasetId
        AND IsDeleted = 0
    `)
    const row = result.recordset[0]
    if (!row) {
      res.status(404).json({ error: "Attachment not found." })
      return
    }
    const sasUrl = generateReadSasUrl(row.BlobContainer, row.BlobName)
    res.redirect(sasUrl)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to download attachment."
    res.status(500).json({ error: message })
  }
}

export async function deleteAttachment(req: Request, res: Response) {
  try {
    const datasetId = activeDatasetId()
    const trackingItemId = Number(req.params.trackingItemId)
    const attachmentId = Number(req.params.attachmentId)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (
      !Number.isFinite(trackingItemId) ||
      !Number.isFinite(attachmentId) ||
      companyId === null
    ) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("attachmentId", sql.Int, attachmentId)
    r.input("trackingItemId", sql.Int, trackingItemId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    await r.query(`
      UPDATE dbo.ResidentAttachment SET IsDeleted = 1
      WHERE AttachmentId = @attachmentId
        AND TrackingItemId = @trackingItemId
        AND CompanyId = @companyId
        AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete attachment."
    res.status(500).json({ error: message })
  }
}

async function replacePayerTypes(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  datasetId: string,
  fieldMetadataId: number,
  payerTypes: string[]
): Promise<void> {
  const r = pool.request()
  r.input("id", sql.Int, fieldMetadataId)
  r.input("datasetId", sql.NVarChar(64), datasetId)
  await r.query(
    `DELETE FROM dbo.FieldMetadataPayerType WHERE FieldMetadataId = @id AND DatasetId = @datasetId`
  )
  for (const pt of payerTypes) {
    const t = pt.trim()
    if (!t) continue
    const ins = pool.request()
    ins.input("id", sql.Int, fieldMetadataId)
    ins.input("datasetId", sql.NVarChar(64), datasetId)
    ins.input("pt", sql.NVarChar(100), t)
    await ins.query(`
      INSERT INTO dbo.FieldMetadataPayerType (FieldMetadataId, DatasetId, PayerType) VALUES (@id, @datasetId, @pt)
    `)
  }
}

async function replaceStates(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  datasetId: string,
  fieldMetadataId: number,
  states: string[]
): Promise<void> {
  const r = pool.request()
  r.input("id", sql.Int, fieldMetadataId)
  r.input("datasetId", sql.NVarChar(64), datasetId)
  await r.query(`DELETE FROM dbo.FieldMetadataState WHERE FieldMetadataId = @id AND DatasetId = @datasetId`)
  for (const s of states) {
    const st = s.trim().toUpperCase().slice(0, 2)
    if (st.length !== 2) continue
    const ins = pool.request()
    ins.input("id", sql.Int, fieldMetadataId)
    ins.input("datasetId", sql.NVarChar(64), datasetId)
    ins.input("st", sql.Char(2), st)
    await ins.query(`
      INSERT INTO dbo.FieldMetadataState (FieldMetadataId, DatasetId, State) VALUES (@id, @datasetId, @st)
    `)
  }
}

type FieldMetaApi = {
  fieldMetadataId: number
  companyId: number
  fieldName: string
  displayName: string
  dataType: string
  screenLocation: string
  displayOrder: number
  isActive: boolean
  isRequired: boolean
  isEditable: boolean
  isSystemField: boolean
  sourceType: string
  sourceColumnName: string | null
  modalSectionId: number | null
  viewTypes: string[]
  states: string[]
  fieldKind: string
  formulaDefinition: unknown | null
  deletable: boolean
}

function dataTypeFromFormula(def: FormulaDefinition): string {
  switch (def.calculationType) {
    case "date_arithmetic":
      return "date"
    case "number_arithmetic":
      return "number"
    case "conditional": {
      const m: Record<string, string> = {
        numeric: "number",
        date: "date",
        boolean: "boolean",
        text: "text",
      }
      return m[def.resultDataType] ?? "text"
    }
    default:
      return "text"
  }
}

function mapSqlTypeToFieldDataType(sqlType: string): string {
  const t = sqlType.toLowerCase()
  if (
    ["varchar", "nvarchar", "char", "nchar", "text", "ntext"].includes(t)
  )
    return "text"
  if (["money", "smallmoney"].includes(t)) return "currency"
  if (
    [
      "decimal",
      "numeric",
      "float",
      "real",
      "int",
      "bigint",
      "smallint",
      "tinyint",
    ].includes(t)
  )
    return "number"
  if (["date", "datetime", "datetime2", "smalldatetime", "datetimeoffset"].includes(t))
    return "date"
  if (t === "bit") return "boolean"
  return "text"
}

async function hasFieldMetadataViewOrderTable(
  pool: Awaited<ReturnType<typeof getTrackingPool>>
): Promise<boolean> {
  const r = await pool.request().query(`
    SELECT 1 AS x FROM sys.tables
    WHERE schema_id = SCHEMA_ID(N'dbo') AND name = N'FieldMetadataViewOrder'
  `)
  return r.recordset.length > 0
}

async function assertTrackingItemColumnExists(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  columnName: string
): Promise<void> {
  const name = columnName.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      "Invalid column name: use letters, numbers, underscore; start with letter or _."
    )
  }
  const r = await pool.request().input("c", sql.NVarChar(128), name).query(`
    SELECT 1 AS x FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TrackingItemsTbl') AND name = @c
  `)
  if (r.recordset.length === 0) {
    throw new Error(
      `Column "${name}" was not found on dbo.TrackingItemsTbl. Add the column in SQL Server first.`
    )
  }
}

async function upsertFieldMetadataViewOrders(
  pool: Awaited<ReturnType<typeof getTrackingPool>>,
  datasetId: string,
  fieldMetadataId: number,
  rows: { viewType: string; displayOrder: number }[]
): Promise<void> {
  if (rows.length === 0) return
  if (!(await hasFieldMetadataViewOrderTable(pool))) return
  for (const row of rows) {
    const vt = row.viewType.trim()
    if (!vt) continue
    const ord = Number.isFinite(row.displayOrder)
      ? Math.trunc(row.displayOrder)
      : 0
    const ins = pool.request()
    ins.input("datasetId", sql.NVarChar(64), datasetId)
    ins.input("fid", sql.Int, fieldMetadataId)
    ins.input("vt", sql.NVarChar(100), vt)
    ins.input("ord", sql.Int, ord)
    await ins.query(`
      MERGE dbo.FieldMetadataViewOrder AS t
      USING (SELECT @fid AS FieldMetadataId, @vt AS ViewType, @datasetId AS DatasetId) AS s
      ON t.FieldMetadataId = s.FieldMetadataId AND t.ViewType = s.ViewType AND t.DatasetId = s.DatasetId
      WHEN MATCHED THEN UPDATE SET DisplayOrder = @ord
      WHEN NOT MATCHED THEN
        INSERT (FieldMetadataId, DatasetId, ViewType, DisplayOrder)
        VALUES (@fid, @datasetId, @vt, @ord);
    `)
  }
}

export async function getAdminTrackingItemColumns(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const companyId = Number(
      req.query.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const pool = await getTrackingPool()
    const cols = await pool.request().query<{
      ColumnName: string
      DataType: string
    }>(`
      SELECT c.COLUMN_NAME AS ColumnName, c.DATA_TYPE AS DataType
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_SCHEMA = N'dbo'
        AND c.TABLE_NAME = N'TrackingItemsTbl'
      ORDER BY c.ORDINAL_POSITION
    `)
    const fm = await pool.request().input("companyId", sql.Int, companyId)
      .input("datasetId", sql.NVarChar(64), datasetId)
      .query<{ FieldName: string }>(`
      SELECT FieldName FROM dbo.FieldMetadata WHERE CompanyId = @companyId AND DatasetId = @datasetId
    `)
    const used = new Set(
      fm.recordset.map((r) => String(r.FieldName).trim().toLowerCase())
    )
    const columns = cols.recordset.map((row) => {
      const columnName = String(row.ColumnName)
      return {
        columnName,
        sqlDataType: String(row.DataType),
        suggestedDataType: mapSqlTypeToFieldDataType(String(row.DataType)),
        hasFieldMetadata: used.has(columnName.toLowerCase()),
      }
    })
    res.json({ columns })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load table columns."
    res.status(500).json({ error: message, columns: [] })
  }
}

export async function getAdminFieldMetadata(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const companyId = Number(
      req.query.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const pool = await getTrackingPool()
    const hasMSI = await hasModalSectionIdColumn(pool)
    const msiCol = hasMSI ? ", ModalSectionId" : ", NULL AS ModalSectionId"
    const hasFf = await hasFieldFormulaColumns(pool)
    const ffCol = hasFf
      ? ", FieldKind, FormulaDefinitionJson"
      : ", N'regular' AS FieldKind, CAST(NULL AS nvarchar(max)) AS FormulaDefinitionJson"
    const r = pool.request()
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const fmResult = await r.query(`
      SELECT
        FieldMetadataId, CompanyId, FieldName, DisplayName, DataType, ScreenLocation,
        DisplayOrder, IsActive, IsRequired, IsEditable, IsSystemField, SourceType,
        SourceColumnName${msiCol}${ffCol}
      FROM dbo.FieldMetadata
      WHERE CompanyId = @companyId AND DatasetId = @datasetId
      ORDER BY ScreenLocation, DisplayOrder, FieldMetadataId
    `)
    const vtReq = pool.request()
    vtReq.input("companyId", sql.Int, companyId)
    vtReq.input("datasetId", sql.NVarChar(64), datasetId)
    const vtCompany = await vtReq.query<{ ViewType: string }>(`
      SELECT DISTINCT LTRIM(RTRIM(ti.ViewType)) AS ViewType
      FROM dbo.TrackingItemsTbl ti
      WHERE ti.CompanyId = @companyId
        AND ti.DatasetId = @datasetId
        AND ti.IsActive = 1
        AND ti.ViewType IS NOT NULL
        AND LTRIM(RTRIM(ti.ViewType)) <> N''
      ORDER BY ViewType
    `)
    const companyViewTypes = vtCompany.recordset.map((row) => String(row.ViewType))
    const ids = fmResult.recordset.map((row) => row.FieldMetadataId as number)
    const viewTypeMap = new Map<number, string[]>()
    const stateMap = new Map<number, string[]>()
    if (ids.length > 0) {
      const placeholders = ids.map((_, i) => `@id${i}`).join(", ")
      const r2 = pool.request()
      r2.input("datasetId", sql.NVarChar(64), datasetId)
      ids.forEach((id, i) => r2.input(`id${i}`, sql.Int, id))
      const pt = await r2.query<{ FieldMetadataId: number; PayerType: string }>(`
        SELECT FieldMetadataId, PayerType FROM dbo.FieldMetadataPayerType
        WHERE FieldMetadataId IN (${placeholders}) AND DatasetId = @datasetId
      `)
      for (const row of pt.recordset) {
        const list = viewTypeMap.get(row.FieldMetadataId) ?? []
        list.push(row.PayerType)
        viewTypeMap.set(row.FieldMetadataId, list)
      }
      const r3 = pool.request()
      r3.input("datasetId", sql.NVarChar(64), datasetId)
      ids.forEach((id, i) => r3.input(`id${i}`, sql.Int, id))
      const st = await r3.query<{ FieldMetadataId: number; State: string }>(`
        SELECT FieldMetadataId, State FROM dbo.FieldMetadataState
        WHERE FieldMetadataId IN (${placeholders}) AND DatasetId = @datasetId
      `)
      for (const row of st.recordset) {
        const list = stateMap.get(row.FieldMetadataId) ?? []
        list.push(String(row.State).trim())
        stateMap.set(row.FieldMetadataId, list)
      }
    }
    const valueCountMap = new Map<number, number>()
    if (ids.length > 0) {
      const placeholdersVc = ids.map((_, i) => `@vc${i}`).join(", ")
      const rVc = pool.request()
      rVc.input("datasetId", sql.NVarChar(64), datasetId)
      ids.forEach((id, i) => rVc.input(`vc${i}`, sql.Int, id))
      const vcRows = await rVc.query<{ FieldMetadataId: number; Cnt: number }>(`
        SELECT FieldMetadataId, COUNT(*) AS Cnt
        FROM dbo.TrackingItemFieldValues
        WHERE FieldMetadataId IN (${placeholdersVc}) AND DatasetId = @datasetId
        GROUP BY FieldMetadataId
      `)
      for (const row of vcRows.recordset) {
        valueCountMap.set(
          row.FieldMetadataId as number,
          Number(row.Cnt ?? 0)
        )
      }
    }
    const fields: FieldMetaApi[] = fmResult.recordset.map((row) => {
      const id = row.FieldMetadataId as number
      return {
        fieldMetadataId: id,
        companyId: row.CompanyId as number,
        fieldName: String(row.FieldName),
        displayName: String(row.DisplayName),
        dataType: String(row.DataType),
        screenLocation: String(row.ScreenLocation),
        displayOrder: Number(row.DisplayOrder),
        isActive: Boolean(row.IsActive),
        isRequired: Boolean(row.IsRequired),
        isEditable: Boolean(row.IsEditable),
        isSystemField: Boolean(row.IsSystemField),
        sourceType: String(row.SourceType),
        sourceColumnName: row.SourceColumnName
          ? String(row.SourceColumnName)
          : null,
        modalSectionId:
          row.ModalSectionId != null ? Number(row.ModalSectionId) : null,
        viewTypes: viewTypeMap.get(id) ?? [],
        states: stateMap.get(id) ?? [],
        fieldKind:
          (row as { FieldKind?: string }).FieldKind != null
            ? String((row as { FieldKind?: string }).FieldKind)
            : "regular",
        formulaDefinition: (() => {
          const raw = (row as { FormulaDefinitionJson?: string | null })
            .FormulaDefinitionJson
          if (raw == null || String(raw).trim() === "") return null
          try {
            return JSON.parse(String(raw)) as unknown
          } catch {
            return null
          }
        })(),
        deletable: (() => {
          const fk =
            (row as { FieldKind?: string }).FieldKind != null
              ? String((row as { FieldKind?: string }).FieldKind)
              : "regular"
          const st = String(row.SourceType)
          const vCount = valueCountMap.get(id) ?? 0
          return fk === "calculated" || (st === "Custom" && vCount === 0)
        })(),
      }
    })
    res.json({ fields, companyViewTypes })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load field metadata."
    res.status(500).json({ error: message, fields: [] })
  }
}

const postFieldMetaSchema = z.object({
  companyId: z.coerce.number(),
  fieldName: z.string().min(1),
  displayName: z.string().min(1),
  dataType: z.string().optional(),
  screenLocation: z.string().optional(),
  displayOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  isRequired: z.boolean().optional(),
  isEditable: z.boolean().optional(),
  isSystemField: z.boolean().optional(),
  sourceType: z.enum(["BaseTable", "Custom"]).optional(),
  sourceColumnName: z.string().optional().nullable(),
  viewTypes: z.array(z.string()).optional(),
  payerTypes: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  viewOrders: z
    .array(
      z.object({
        viewType: z.string().min(1),
        displayOrder: z.coerce.number(),
      })
    )
    .optional(),
  fieldKind: z.enum(["regular", "calculated"]).optional(),
  formulaDefinition: z.unknown().optional(),
})

export async function postAdminFieldMetadata(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const parsed = postFieldMetaSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "companyId, fieldName, displayName required" })
      return
    }
    const body = parsed.data
    const sl = body.screenLocation?.trim() ?? ""
    const screenLocation: "Main" | "Detail" | "Both" =
      sl === "Detail" ? "Detail" : sl === "Both" ? "Both" : "Main"
    const pool = await getTrackingPool()
    const kind = body.fieldKind === "calculated" ? "calculated" : "regular"
    let formulaJson: string | null = null
    let dataTypeOut = body.dataType?.trim() ?? "text"

    const sourceTypeIn: "BaseTable" | "Custom" =
      kind === "calculated"
        ? "Custom"
        : body.sourceType === "BaseTable"
          ? "BaseTable"
          : "Custom"

    let sourceColumnNameOut: string | null = null
    let fieldNameFinal = body.fieldName.trim()

    if (kind === "calculated") {
      const fp = formulaDefinitionSchema.safeParse(body.formulaDefinition)
      if (!fp.success) {
        res.status(400).json({
          error: "Invalid formulaDefinition",
          details: fp.error.flatten(),
        })
        return
      }
      formulaJson = JSON.stringify(fp.data)
      dataTypeOut = dataTypeFromFormula(fp.data)
    } else if (sourceTypeIn === "BaseTable") {
      const col = body.sourceColumnName?.trim()
      if (!col) {
        res.status(400).json({
          error: "sourceColumnName is required when sourceType is BaseTable.",
        })
        return
      }
      await assertTrackingItemColumnExists(pool, col)
      sourceColumnNameOut = col
      fieldNameFinal = col
    }

    const hasFf = await hasFieldFormulaColumns(pool)
    if (kind === "calculated" && !hasFf) {
      res.status(400).json({
        error:
          "Calculated fields require FieldKind on dbo.FieldMetadata. Restart the API (schema auto-migration) or run sql/005-calculated-fields.sql.",
      })
      return
    }

    const dupReq = pool.request()
    dupReq.input("companyId", sql.Int, body.companyId)
    dupReq.input("datasetId", sql.NVarChar(64), datasetId)
    dupReq.input("fn", sql.NVarChar(128), fieldNameFinal)
    const dup = await dupReq.query(`
      SELECT 1 AS x FROM dbo.FieldMetadata
      WHERE CompanyId = @companyId AND DatasetId = @datasetId AND FieldName = @fn
    `)
    if (dup.recordset.length > 0) {
      res.status(400).json({
        error: `A field named "${fieldNameFinal}" already exists for this company.`,
      })
      return
    }

    const isActive = body.isActive !== undefined ? (body.isActive ? 1 : 0) : 1
    const isRequired =
      kind === "calculated"
        ? 0
        : body.isRequired !== undefined
          ? (body.isRequired ? 1 : 0)
          : 0
    const isEditable =
      kind === "calculated"
        ? 0
        : body.isEditable !== undefined
          ? (body.isEditable ? 1 : 0)
          : 1
    const isSystemBit =
      kind === "calculated"
        ? 0
        : body.isSystemField !== undefined
          ? (body.isSystemField ? 1 : 0)
          : 0

    const r = pool.request()
    r.input("companyId", sql.Int, body.companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("fieldName", sql.NVarChar(128), fieldNameFinal)
    r.input("displayName", sql.NVarChar(256), body.displayName.trim())
    r.input("dataType", sql.NVarChar(50), dataTypeOut)
    r.input("screenLocation", sql.NVarChar(20), screenLocation)
    r.input("displayOrder", sql.Int, body.displayOrder ?? 0)
    r.input("isActive", sql.Bit, isActive)
    r.input("isRequired", sql.Bit, isRequired)
    r.input("isEditable", sql.Bit, isEditable)
    r.input("isSystemField", sql.Bit, isSystemBit)
    r.input(
      "sourceType",
      sql.NVarChar(20),
      sourceTypeIn === "BaseTable" ? "BaseTable" : "Custom"
    )
    r.input(
      "sourceColumnName",
      sql.NVarChar(128),
      sourceTypeIn === "BaseTable" ? sourceColumnNameOut : null
    )

    let insertResult: { recordset: { FieldMetadataId: number }[] }
    if (hasFf) {
      r.input("fieldKind", sql.NVarChar(20), kind)
      r.input("formulaJson", sql.NVarChar(sql.MAX), formulaJson)
      insertResult = await r.query<{ FieldMetadataId: number }>(`
        INSERT INTO dbo.FieldMetadata (
          CompanyId, DatasetId, FieldName, DisplayName, DataType, ScreenLocation, DisplayOrder,
          IsActive, IsRequired, IsEditable, IsSystemField, SourceType, SourceColumnName,
          FieldKind, FormulaDefinitionJson
        )
        OUTPUT INSERTED.FieldMetadataId
        VALUES (
          @companyId, @datasetId, @fieldName, @displayName, @dataType, @screenLocation, @displayOrder,
          @isActive, @isRequired, @isEditable, @isSystemField, @sourceType, @sourceColumnName,
          @fieldKind, @formulaJson
        )
      `)
    } else {
      insertResult = await r.query<{ FieldMetadataId: number }>(`
        INSERT INTO dbo.FieldMetadata (
          CompanyId, DatasetId, FieldName, DisplayName, DataType, ScreenLocation, DisplayOrder,
          IsActive, IsRequired, IsEditable, IsSystemField, SourceType, SourceColumnName
        )
        OUTPUT INSERTED.FieldMetadataId
        VALUES (
          @companyId, @datasetId, @fieldName, @displayName, @dataType, @screenLocation, @displayOrder,
          @isActive, @isRequired, @isEditable, @isSystemField, @sourceType, @sourceColumnName
        )
      `)
    }
    const fieldMetadataId = Number(insertResult.recordset[0]?.FieldMetadataId)
    if (!fieldMetadataId) {
      res.status(500).json({ error: "Insert failed" })
      return
    }
    const vt = body.viewTypes ?? body.payerTypes ?? []
    await replacePayerTypes(pool, datasetId, fieldMetadataId, vt)
    await replaceStates(pool, datasetId, fieldMetadataId, body.states ?? [])
    await upsertFieldMetadataViewOrders(pool, datasetId, fieldMetadataId, body.viewOrders ?? [])
    res.json({ ok: true, fieldMetadataId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create field."
    res.status(500).json({ error: message })
  }
}

export async function patchAdminFieldMetadata(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const fieldMetadataId = Number(req.params.fieldMetadataId)
    if (!Number.isFinite(fieldMetadataId)) {
      res.status(400).json({ error: "Invalid id" })
      return
    }
    const body = req.body as {
      companyId?: number
      displayName?: string
      displayOrder?: number
      screenLocation?: string
      isActive?: boolean
      isRequired?: boolean
      isEditable?: boolean
      modalSectionId?: number | null
      viewTypes?: string[]
      payerTypes?: string[]
      states?: string[]
      formulaDefinition?: unknown
    }
    const companyId = Number(body.companyId)
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("id", sql.Int, fieldMetadataId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const sets: string[] = []
    if (body.displayName !== undefined) {
      r.input("displayName", sql.NVarChar(256), body.displayName)
      sets.push("DisplayName = @displayName")
    }
    if (body.displayOrder !== undefined) {
      r.input("displayOrder", sql.Int, body.displayOrder)
      sets.push("DisplayOrder = @displayOrder")
    }
    if (
      body.screenLocation === "Detail" ||
      body.screenLocation === "Main" ||
      body.screenLocation === "Both"
    ) {
      r.input("screenLocation", sql.NVarChar(20), body.screenLocation)
      sets.push("ScreenLocation = @screenLocation")
    }
    if (body.isActive !== undefined) {
      r.input("isActive", sql.Bit, body.isActive ? 1 : 0)
      sets.push("IsActive = @isActive")
    }
    if (body.isRequired !== undefined) {
      r.input("isRequired", sql.Bit, body.isRequired ? 1 : 0)
      sets.push("IsRequired = @isRequired")
    }
    if (body.isEditable !== undefined) {
      r.input("isEditable", sql.Bit, body.isEditable ? 1 : 0)
      sets.push("IsEditable = @isEditable")
    }
    if ("modalSectionId" in body && (await hasModalSectionIdColumn(pool))) {
      r.input(
        "modalSectionId",
        sql.Int,
        body.modalSectionId != null ? body.modalSectionId : null
      )
      sets.push("ModalSectionId = @modalSectionId")
    }
    if (body.formulaDefinition !== undefined) {
      if (!(await hasFieldFormulaColumns(pool))) {
        res.status(400).json({
          error: "Formula updates require FieldKind / FormulaDefinitionJson columns.",
        })
        return
      }
      const existing = await getFieldMetadataById(
        pool,
        fieldMetadataId,
        companyId,
        datasetId
      )
      if (!existing || existing.FieldKind !== "calculated") {
        res.status(400).json({
          error: "formulaDefinition can only be updated for calculated fields.",
        })
        return
      }
      const fp = formulaDefinitionSchema.safeParse(body.formulaDefinition)
      if (!fp.success) {
        res.status(400).json({
          error: "Invalid formulaDefinition",
          details: fp.error.flatten(),
        })
        return
      }
      r.input("formulaJson", sql.NVarChar(sql.MAX), JSON.stringify(fp.data))
      r.input("dataType", sql.NVarChar(50), dataTypeFromFormula(fp.data))
      sets.push("FormulaDefinitionJson = @formulaJson")
      sets.push("DataType = @dataType")
    }
    if (sets.length > 0) {
      await r.query(`
        UPDATE dbo.FieldMetadata SET ${sets.join(", ")}
        WHERE FieldMetadataId = @id AND CompanyId = @companyId AND DatasetId = @datasetId
      `)
    }
    const vt = body.viewTypes ?? body.payerTypes
    if (vt) await replacePayerTypes(pool, datasetId, fieldMetadataId, vt)
    if (body.states) await replaceStates(pool, datasetId, fieldMetadataId, body.states)
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update field."
    res.status(500).json({ error: message })
  }
}

export async function deleteAdminFieldMetadata(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const fieldMetadataId = Number(req.params.fieldMetadataId)
    const companyId = Number(
      req.query.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(fieldMetadataId) || !Number.isFinite(companyId)) {
      res.status(400).json({ error: "fieldMetadataId and companyId required" })
      return
    }
    const pool = await getTrackingPool()
    const fm = await getFieldMetadataById(pool, fieldMetadataId, companyId, datasetId)
    if (!fm) {
      res.status(404).json({ error: "Field not found" })
      return
    }
    const kind = fm.FieldKind ?? "regular"
    const isCalculated = kind === "calculated"
    if (!isCalculated) {
      if (fm.SourceType !== "Custom") {
        res.status(400).json({
          error:
            "Only custom or calculated fields can be deleted. Base-table columns cannot be removed from metadata.",
        })
        return
      }
      const cntReq = pool.request()
      cntReq.input("fmid", sql.Int, fieldMetadataId)
      cntReq.input("datasetId", sql.NVarChar(64), datasetId)
      const cntR = await cntReq.query<{ c: number }>(`
        SELECT COUNT(*) AS c
        FROM dbo.TrackingItemFieldValues
        WHERE FieldMetadataId = @fmid AND DatasetId = @datasetId
      `)
      const stored = Number(cntR.recordset[0]?.c ?? 0)
      if (stored > 0) {
        res.status(409).json({
          error:
            "This field has stored per-row values. Remove or migrate them before deleting the field.",
        })
        return
      }
    }
    const delTfv = pool.request()
    delTfv.input("fmid", sql.Int, fieldMetadataId)
    delTfv.input("datasetId", sql.NVarChar(64), datasetId)
    await delTfv.query(`
      DELETE FROM dbo.TrackingItemFieldValues WHERE FieldMetadataId = @fmid AND DatasetId = @datasetId
    `)
    const delFm = pool.request()
    delFm.input("id", sql.Int, fieldMetadataId)
    delFm.input("companyId", sql.Int, companyId)
    delFm.input("datasetId", sql.NVarChar(64), datasetId)
    const delResult = await delFm.query(`
      DELETE FROM dbo.FieldMetadata
      WHERE FieldMetadataId = @id AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    const affected = delResult.rowsAffected?.[0] ?? 0
    if (affected === 0) {
      res.status(404).json({ error: "Field not found" })
      return
    }
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete field."
    res.status(500).json({ error: message })
  }
}

export async function getFieldOptions(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const fieldMetadataId = Number(req.params.fieldMetadataId)
    if (!Number.isFinite(fieldMetadataId)) {
      res.status(400).json({ error: "Invalid fieldMetadataId" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("fieldMetadataId", sql.Int, fieldMetadataId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const result = await r.query(`
      SELECT FieldOptionId, OptionValue, OptionLabel, DisplayOrder, IsActive
      FROM dbo.FieldMetadataOption
      WHERE FieldMetadataId = @fieldMetadataId AND DatasetId = @datasetId
      ORDER BY DisplayOrder, FieldOptionId
    `)
    const options = result.recordset.map((row: Record<string, unknown>) => ({
      fieldOptionId: row.FieldOptionId as number,
      optionValue: String(row.OptionValue),
      optionLabel: row.OptionLabel ? String(row.OptionLabel) : null,
      displayOrder: Number(row.DisplayOrder),
      isActive: Boolean(row.IsActive),
    }))
    res.json({ options })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load options."
    res.status(500).json({ error: message })
  }
}

const postOptionSchema = z.object({
  optionValue: z.string().min(1),
  optionLabel: z.string().nullable().optional(),
  displayOrder: z.number().optional(),
})

export async function postFieldOption(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const fieldMetadataId = Number(req.params.fieldMetadataId)
    if (!Number.isFinite(fieldMetadataId)) {
      res.status(400).json({ error: "Invalid fieldMetadataId" })
      return
    }
    const parsed = postOptionSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "optionValue is required" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("fieldMetadataId", sql.Int, fieldMetadataId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("optionValue", sql.NVarChar(500), parsed.data.optionValue.trim())
    r.input("optionLabel", sql.NVarChar(500), parsed.data.optionLabel?.trim() ?? null)
    r.input("displayOrder", sql.Int, parsed.data.displayOrder ?? 0)
    const result = await r.query<{ FieldOptionId: number }>(`
      INSERT INTO dbo.FieldMetadataOption (FieldMetadataId, DatasetId, OptionValue, OptionLabel, DisplayOrder, IsActive)
      OUTPUT INSERTED.FieldOptionId
      VALUES (@fieldMetadataId, @datasetId, @optionValue, @optionLabel, @displayOrder, 1)
    `)
    const fieldOptionId = Number(result.recordset[0]?.FieldOptionId)
    if (!fieldOptionId) {
      res.status(500).json({ error: "Insert failed" })
      return
    }
    res.json({ ok: true, fieldOptionId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create option."
    res.status(500).json({ error: message })
  }
}

export async function patchFieldOption(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const fieldMetadataId = Number(req.params.fieldMetadataId)
    const optionId = Number(req.params.optionId)
    if (!Number.isFinite(fieldMetadataId) || !Number.isFinite(optionId)) {
      res.status(400).json({ error: "Invalid IDs" })
      return
    }
    const body = req.body as {
      optionValue?: string
      optionLabel?: string | null
      displayOrder?: number
      isActive?: boolean
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("optionId", sql.Int, optionId)
    r.input("fieldMetadataId", sql.Int, fieldMetadataId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const updates: string[] = []
    if (body.optionValue !== undefined) {
      const val = body.optionValue?.trim() ?? ""
      if (!val) {
        res.status(400).json({ error: "optionValue cannot be empty" })
        return
      }
      updates.push("OptionValue = @optionValue")
      r.input("optionValue", sql.NVarChar(500), val)
    }
    if (body.optionLabel !== undefined) {
      updates.push("OptionLabel = @optionLabel")
      r.input("optionLabel", sql.NVarChar(500), body.optionLabel?.trim() ?? null)
    }
    if (body.displayOrder !== undefined) {
      updates.push("DisplayOrder = @displayOrder")
      r.input("displayOrder", sql.Int, body.displayOrder)
    }
    if (body.isActive !== undefined) {
      updates.push("IsActive = @isActive")
      r.input("isActive", sql.Bit, body.isActive ? 1 : 0)
    }
    if (updates.length === 0) {
      res.json({ ok: true })
      return
    }
    const result = await r.query(`
      UPDATE dbo.FieldMetadataOption
      SET ${updates.join(", ")}
      WHERE FieldOptionId = @optionId AND FieldMetadataId = @fieldMetadataId AND DatasetId = @datasetId
    `)
    if (result.rowsAffected[0] === 0) {
      res.status(404).json({ error: "Option not found" })
      return
    }
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update option."
    res.status(500).json({ error: message })
  }
}

export async function deleteFieldOption(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const fieldMetadataId = Number(req.params.fieldMetadataId)
    const optionId = Number(req.params.optionId)
    if (!Number.isFinite(fieldMetadataId) || !Number.isFinite(optionId)) {
      res.status(400).json({ error: "Invalid IDs" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("optionId", sql.Int, optionId)
    r.input("fieldMetadataId", sql.Int, fieldMetadataId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const result = await r.query(`
      DELETE FROM dbo.FieldMetadataOption
      WHERE FieldOptionId = @optionId AND FieldMetadataId = @fieldMetadataId AND DatasetId = @datasetId
    `)
    if (result.rowsAffected[0] === 0) {
      res.status(404).json({ error: "Option not found" })
      return
    }
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete option."
    res.status(500).json({ error: message })
  }
}

export async function getFieldOrder(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({
        error: "companyId is required (or set TRACKING_DEFAULT_COMPANY_ID).",
      })
      return
    }
    const viewType = (req.query.viewType as string)?.trim() ?? null
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("viewType", sql.NVarChar(100), viewType)
    const sqlText = viewType
      ? `
        SELECT
          fm.FieldMetadataId,
          fm.FieldName,
          fm.DisplayName,
          COALESCE(vto.DisplayOrder, fm.DisplayOrder) AS DisplayOrder
        FROM dbo.FieldMetadata fm
        LEFT JOIN dbo.FieldMetadataViewOrder vto
          ON vto.FieldMetadataId = fm.FieldMetadataId AND vto.ViewType = @viewType AND vto.DatasetId = @datasetId
        WHERE fm.CompanyId = @companyId
          AND fm.DatasetId = @datasetId
          AND fm.IsActive = 1
        ORDER BY COALESCE(vto.DisplayOrder, fm.DisplayOrder) ASC, fm.FieldMetadataId ASC
      `
      : `
        SELECT
          fm.FieldMetadataId,
          fm.FieldName,
          fm.DisplayName,
          fm.DisplayOrder
        FROM dbo.FieldMetadata fm
        WHERE fm.CompanyId = @companyId
          AND fm.DatasetId = @datasetId
          AND fm.IsActive = 1
        ORDER BY fm.DisplayOrder ASC, fm.FieldMetadataId ASC
      `
    const result = await r.query(sqlText)
    const fields = result.recordset.map((row: Record<string, unknown>) => ({
      fieldMetadataId: row.FieldMetadataId,
      fieldName: row.FieldName,
      displayName: row.DisplayName,
      displayOrder: row.DisplayOrder,
    }))
    res.json({ fields })
  } catch (error) {
    console.error("field-order GET error:", error)
    res.status(500).json({ error: "Failed to fetch field order" })
  }
}

const putFieldOrderSchema = z.object({
  companyId: z.coerce.number(),
  viewType: z.string().nullable(),
  fields: z.array(
    z.object({
      fieldMetadataId: z.number(),
      displayOrder: z.number(),
    })
  ),
})

export async function putFieldOrder(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const parsed = putFieldOrderSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" })
      return
    }
    const { companyId, viewType, fields } = parsed.data
    const pool = await getTrackingPool()
    if (!viewType) {
      for (const field of fields) {
        const rq = pool.request()
        rq.input("id", sql.Int, field.fieldMetadataId)
        rq.input("order", sql.Int, field.displayOrder)
        rq.input("companyId", sql.Int, companyId)
        rq.input("datasetId", sql.NVarChar(64), datasetId)
        await rq.query(
          `UPDATE dbo.FieldMetadata
           SET DisplayOrder = @order
           WHERE FieldMetadataId = @id AND CompanyId = @companyId AND DatasetId = @datasetId`
        )
      }
    } else {
      for (const field of fields) {
        const rq = pool.request()
        rq.input("fieldId", sql.Int, field.fieldMetadataId)
        rq.input("datasetId", sql.NVarChar(64), datasetId)
        rq.input("viewType", sql.NVarChar(100), viewType)
        rq.input("order", sql.Int, field.displayOrder)
        await rq.query(
          `MERGE INTO dbo.FieldMetadataViewOrder AS target
           USING (SELECT @fieldId AS FieldMetadataId, @viewType AS ViewType, @datasetId AS DatasetId) AS source
           ON target.FieldMetadataId = source.FieldMetadataId AND target.ViewType = source.ViewType AND target.DatasetId = source.DatasetId
           WHEN MATCHED THEN
             UPDATE SET DisplayOrder = @order
           WHEN NOT MATCHED THEN
             INSERT (FieldMetadataId, DatasetId, ViewType, DisplayOrder)
             VALUES (source.FieldMetadataId, source.DatasetId, source.ViewType, @order);`
        )
      }
      const submittedIds = fields.map((f) => f.fieldMetadataId)
      if (submittedIds.length > 0) {
        const rq = pool.request()
        rq.input("datasetId", sql.NVarChar(64), datasetId)
        rq.input("viewType", sql.NVarChar(100), viewType)
        const idList = submittedIds.map((_, i) => `@id${i}`).join(",")
        submittedIds.forEach((id, i) => {
          rq.input(`id${i}`, sql.Int, id)
        })
        await rq.query(
          `DELETE FROM dbo.FieldMetadataViewOrder
           WHERE DatasetId = @datasetId AND ViewType = @viewType AND FieldMetadataId NOT IN (${idList})`
        )
      }
    }
    res.json({ success: true })
  } catch (error) {
    console.error("field-order PUT error:", error)
    res.status(500).json({ error: "Failed to save field order" })
  }
}

export async function deleteFieldOrder(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({ error: "companyId is required" })
      return
    }
    const viewType = (req.query.viewType as string)?.trim()
    if (!viewType) {
      res.status(400).json({ error: "viewType is required for DELETE" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("viewType", sql.NVarChar(100), viewType)
    await r.query(
      `DELETE FROM dbo.FieldMetadataViewOrder WHERE DatasetId = @datasetId AND ViewType = @viewType`
    )
    res.json({ success: true })
  } catch (error) {
    console.error("field-order DELETE error:", error)
    res.status(500).json({ error: "Failed to reset field order" })
  }
}

export async function getModalSections(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const companyId = Number(
      req.query.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const result = await r.query(`
      SELECT ModalSectionId, SectionName, SectionType, DisplayOrder, IsActive
      FROM dbo.ModalSection
      WHERE CompanyId = @companyId AND DatasetId = @datasetId
      ORDER BY DisplayOrder, ModalSectionId
    `)
    const sections = result.recordset.map((row: Record<string, unknown>) => ({
      modalSectionId: row.ModalSectionId,
      sectionName: row.SectionName,
      sectionType: row.SectionType,
      displayOrder: row.DisplayOrder,
      isActive: Boolean(row.IsActive),
    }))
    res.json({ sections })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load sections."
    res.status(500).json({ error: message, sections: [] })
  }
}

const postModalSectionSchema = z.object({
  companyId: z.coerce.number(),
  sectionName: z.string().min(1),
  sectionType: z.string().optional(),
  displayOrder: z.number().optional(),
})

export async function postModalSection(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const parsed = postModalSectionSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "companyId, sectionName required" })
      return
    }
    const rawType = parsed.data.sectionType?.trim() ?? ""
    const sectionType = rawType === "LOCTracking" ? "LOCTracking" : "Standard"
    const displayOrder = parsed.data.displayOrder ?? 0
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("companyId", sql.Int, parsed.data.companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("sectionName", sql.NVarChar(128), parsed.data.sectionName.trim())
    r.input("sectionType", sql.NVarChar(50), sectionType)
    r.input("displayOrder", sql.Int, displayOrder)
    const result = await r.query<{ ModalSectionId: number }>(`
      INSERT INTO dbo.ModalSection (CompanyId, DatasetId, SectionName, SectionType, DisplayOrder)
      OUTPUT INSERTED.ModalSectionId
      VALUES (@companyId, @datasetId, @sectionName, @sectionType, @displayOrder)
    `)
    const modalSectionId = Number(result.recordset[0]?.ModalSectionId)
    if (!modalSectionId) {
      res.status(500).json({ error: "Insert failed" })
      return
    }
    res.json({ ok: true, modalSectionId })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create section."
    res.status(500).json({ error: message })
  }
}

export async function patchModalSection(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const sectionId = Number(req.params.sectionId)
    if (!Number.isFinite(sectionId)) {
      res.status(400).json({ error: "Invalid sectionId" })
      return
    }
    const body = req.body as {
      companyId?: number
      sectionName?: string
      sectionType?: string
      displayOrder?: number
      isActive?: boolean
    }
    const companyId = Number(body.companyId)
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("id", sql.Int, sectionId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const sets: string[] = []
    if (body.sectionName !== undefined) {
      r.input("sectionName", sql.NVarChar(128), body.sectionName.trim())
      sets.push("SectionName = @sectionName")
    }
    if (body.sectionType === "Standard" || body.sectionType === "LOCTracking") {
      r.input("sectionType", sql.NVarChar(50), body.sectionType)
      sets.push("SectionType = @sectionType")
    }
    if (body.displayOrder !== undefined) {
      r.input("displayOrder", sql.Int, body.displayOrder)
      sets.push("DisplayOrder = @displayOrder")
    }
    if (body.isActive !== undefined) {
      r.input("isActive", sql.Bit, body.isActive ? 1 : 0)
      sets.push("IsActive = @isActive")
    }
    if (sets.length > 0) {
      await r.query(`
        UPDATE dbo.ModalSection SET ${sets.join(", ")}
        WHERE ModalSectionId = @id AND CompanyId = @companyId AND DatasetId = @datasetId
      `)
    }
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update section."
    res.status(500).json({ error: message })
  }
}

export async function deleteModalSection(req: Request, res: Response) {
  try {
    const datasetId = datasetIdFromRequest(req)
    const sectionId = Number(req.params.sectionId)
    if (!Number.isFinite(sectionId)) {
      res.status(400).json({ error: "Invalid sectionId" })
      return
    }
    const companyId = numParam(
      req.query as Record<string, unknown>,
      "companyId",
      "TRACKING_DEFAULT_COMPANY_ID"
    )
    if (companyId === null) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const pool = await getTrackingPool()
    const r = pool.request()
    r.input("id", sql.Int, sectionId)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    await r.query(`
      DELETE FROM dbo.ModalSection
      WHERE ModalSectionId = @id AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete section."
    res.status(500).json({ error: message })
  }
}

const conditionalRuleSchema = z.object({
  companyId: z.coerce.number(),
  datasetId: z.string().min(1).optional(),
  reportKey: z.string().nullable().optional(),
  targetFieldKey: z.string().nullable().optional(),
  applyTo: z.enum(["row", "field"]),
  backgroundColor: z.string().min(1),
  textColor: z.string().nullable().optional(),
  conditionFormula: z.string().min(1).max(4000),
  conditionTree: z.unknown().optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
})

function ruleFromDbRow(row: Record<string, unknown>) {
  let parsedTree: ConditionNode | null = null
  try {
    if (row.ConditionJson != null) {
      parsedTree = JSON.parse(String(row.ConditionJson)) as ConditionNode
    }
  } catch {
    parsedTree = null
  }
  return {
    id: String(row.Id),
    datasetId: String(row.DatasetId),
    reportKey: row.ReportKey == null ? null : String(row.ReportKey),
    targetFieldKey:
      row.TargetFieldKey == null ? null : String(row.TargetFieldKey),
    applyTo: String(row.ApplyTo).toLowerCase() === "field" ? "field" : "row",
    backgroundColor: String(row.BackgroundColor),
    textColor: row.TextColor == null ? null : String(row.TextColor),
    conditionFormula: String(row.ConditionFormula ?? ""),
    conditionTree: parsedTree,
    isEnabled: Boolean(row.IsEnabled),
    sortOrder: Number(row.SortOrder ?? 0),
  }
}

async function ensureConditionalFormattingRulesTable(
  pool: Awaited<ReturnType<typeof getTrackingPool>>
) {
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.ConditionalFormattingRules', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.ConditionalFormattingRules (
        Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
        CompanyId INT NOT NULL,
        DatasetId NVARCHAR(64) NOT NULL,
        ReportKey NVARCHAR(200) NULL,
        TargetFieldKey NVARCHAR(200) NULL,
        ApplyTo NVARCHAR(20) NOT NULL,
        BackgroundColor NVARCHAR(20) NOT NULL,
        TextColor NVARCHAR(20) NULL,
        ConditionFormula NVARCHAR(MAX) NULL,
        ConditionJson NVARCHAR(MAX) NOT NULL,
        IsEnabled BIT NOT NULL DEFAULT (1),
        SortOrder INT NOT NULL DEFAULT (0),
        CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedAt DATETIME2 NULL
      )
    END

    IF COL_LENGTH(N'dbo.ConditionalFormattingRules', N'ConditionFormula') IS NULL
    BEGIN
      ALTER TABLE dbo.ConditionalFormattingRules
      ADD ConditionFormula NVARCHAR(MAX) NULL
    END
  `)
}

export async function getConditionalFormattingRules(req: Request, res: Response) {
  try {
    const companyId = Number(
      req.query.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required", rules: [] })
      return
    }
    const datasetId = datasetIdFromRequest(req)
    const reportKey = (req.query.reportKey as string | undefined)?.trim() || null
    const pool = await getTrackingPool()
    await ensureConditionalFormattingRulesTable(pool)
    const r = pool.request()
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("reportKey", sql.NVarChar(200), reportKey)
    const result = await r.query(`
      SELECT Id, DatasetId, ReportKey, TargetFieldKey, ApplyTo, BackgroundColor, TextColor, ConditionFormula, ConditionJson, IsEnabled, SortOrder, CreatedAt, UpdatedAt
      FROM dbo.ConditionalFormattingRules
      WHERE CompanyId = @companyId
        AND DatasetId = @datasetId
        AND (
          @reportKey IS NULL
          OR ReportKey IS NULL
          OR ReportKey = N'ALL'
          OR ReportKey = @reportKey
        )
      ORDER BY SortOrder ASC, CreatedAt ASC
    `)
    const rules = result.recordset.flatMap((row: Record<string, unknown>) => {
      try {
        return [ruleFromDbRow(row)]
      } catch {
        return []
      }
    })
    res.json({ rules })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load conditional formatting rules."
    res.status(500).json({ error: message, rules: [] })
  }
}

export async function postConditionalFormattingRule(req: Request, res: Response) {
  try {
    const parsed = conditionalRuleSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body" })
      return
    }
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const body = parsed.data
    if (body.applyTo === "field" && !(body.targetFieldKey?.trim())) {
      res.status(400).json({ error: "targetFieldKey is required for applyTo=field" })
      return
    }
    let conditionJson: string | null = "{}"
    if (body.conditionTree !== undefined) {
      const treeErrors = validateConditionTree(body.conditionTree)
      if (treeErrors.length > 0) {
        res.status(400).json({ error: "Invalid conditionTree", details: treeErrors })
        return
      }
      conditionJson = JSON.stringify(body.conditionTree)
    }
    const pool = await getTrackingPool()
    await ensureConditionalFormattingRulesTable(pool)
    const r = pool.request()
    r.input("companyId", sql.Int, body.companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("reportKey", sql.NVarChar(200), body.reportKey?.trim() || null)
    r.input("targetFieldKey", sql.NVarChar(200), body.targetFieldKey?.trim() || null)
    r.input("applyTo", sql.NVarChar(20), body.applyTo)
    r.input("backgroundColor", sql.NVarChar(20), body.backgroundColor.trim())
    r.input("textColor", sql.NVarChar(20), body.textColor?.trim() || null)
    r.input("conditionFormula", sql.NVarChar(sql.MAX), body.conditionFormula.trim())
    r.input("conditionJson", sql.NVarChar(sql.MAX), conditionJson)
    r.input("isEnabled", sql.Bit, body.isEnabled === false ? 0 : 1)
    r.input("sortOrder", sql.Int, body.sortOrder ?? 0)
    const ins = await r.query<{ Id: string }>(`
      INSERT INTO dbo.ConditionalFormattingRules
        (CompanyId, DatasetId, ReportKey, TargetFieldKey, ApplyTo, BackgroundColor, TextColor, ConditionFormula, ConditionJson, IsEnabled, SortOrder)
      OUTPUT INSERTED.Id
      VALUES
        (@companyId, @datasetId, @reportKey, @targetFieldKey, @applyTo, @backgroundColor, @textColor, @conditionFormula, @conditionJson, @isEnabled, @sortOrder)
    `)
    res.json({ ok: true, id: String(ins.recordset[0]?.Id ?? "") })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create conditional formatting rule."
    res.status(500).json({ error: message })
  }
}

export async function patchConditionalFormattingRule(req: Request, res: Response) {
  try {
    const id = (req.params.ruleId ?? "").trim()
    if (!id) {
      res.status(400).json({ error: "Invalid ruleId" })
      return
    }
    const body = req.body as Partial<z.infer<typeof conditionalRuleSchema>>
    const companyId = Number(body.companyId)
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "companyId required" })
      return
    }
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const pool = await getTrackingPool()
    await ensureConditionalFormattingRulesTable(pool)
    const r = pool.request()
    r.input("id", sql.UniqueIdentifier, id)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    const sets: string[] = []
    if (body.reportKey !== undefined) {
      sets.push("ReportKey = @reportKey")
      r.input("reportKey", sql.NVarChar(200), body.reportKey?.trim() || null)
    }
    if (body.targetFieldKey !== undefined) {
      sets.push("TargetFieldKey = @targetFieldKey")
      r.input("targetFieldKey", sql.NVarChar(200), body.targetFieldKey?.trim() || null)
    }
    if (body.applyTo !== undefined) {
      sets.push("ApplyTo = @applyTo")
      r.input("applyTo", sql.NVarChar(20), body.applyTo)
    }
    if (body.backgroundColor !== undefined) {
      sets.push("BackgroundColor = @backgroundColor")
      r.input("backgroundColor", sql.NVarChar(20), body.backgroundColor.trim())
    }
    if (body.textColor !== undefined) {
      sets.push("TextColor = @textColor")
      r.input("textColor", sql.NVarChar(20), body.textColor?.trim() || null)
    }
    if (body.conditionFormula !== undefined) {
      sets.push("ConditionFormula = @conditionFormula")
      r.input("conditionFormula", sql.NVarChar(sql.MAX), body.conditionFormula.trim())
    }
    if (body.conditionTree !== undefined) {
      const treeErrors = validateConditionTree(body.conditionTree)
      if (treeErrors.length > 0) {
        res.status(400).json({ error: "Invalid conditionTree", details: treeErrors })
        return
      }
      sets.push("ConditionJson = @conditionJson")
      r.input("conditionJson", sql.NVarChar(sql.MAX), JSON.stringify(body.conditionTree))
    }
    if (body.sortOrder !== undefined) {
      sets.push("SortOrder = @sortOrder")
      r.input("sortOrder", sql.Int, Math.trunc(body.sortOrder))
    }
    if (body.isEnabled !== undefined) {
      sets.push("IsEnabled = @isEnabled")
      r.input("isEnabled", sql.Bit, body.isEnabled ? 1 : 0)
    }
    if (sets.length === 0) {
      res.status(400).json({ error: "Nothing to update" })
      return
    }
    await r.query(`
      UPDATE dbo.ConditionalFormattingRules
      SET ${sets.join(", ")}, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update conditional formatting rule."
    res.status(500).json({ error: message })
  }
}

export async function deleteConditionalFormattingRule(req: Request, res: Response) {
  try {
    const id = (req.params.ruleId ?? "").trim()
    const companyId = Number(
      req.query.companyId ?? process.env.TRACKING_DEFAULT_COMPANY_ID
    )
    if (!id || !Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid params" })
      return
    }
    const datasetId = datasetIdFromRequest(req)
    const pool = await getTrackingPool()
    await ensureConditionalFormattingRulesTable(pool)
    const r = pool.request()
    r.input("id", sql.UniqueIdentifier, id)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    await r.query(`
      DELETE FROM dbo.ConditionalFormattingRules
      WHERE Id = @id AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to delete conditional formatting rule."
    res.status(500).json({ error: message })
  }
}

export const getConditionalFormatting = getConditionalFormattingRules
export const postConditionalFormatting = postConditionalFormattingRule

export async function putConditionalFormatting(req: Request, res: Response) {
  req.params.ruleId = req.params.id
  return patchConditionalFormattingRule(req, res)
}

export async function deleteConditionalFormatting(req: Request, res: Response) {
  req.params.ruleId = req.params.id
  return deleteConditionalFormattingRule(req, res)
}

export async function patchConditionalFormattingEnabled(req: Request, res: Response) {
  const id = (req.params.id ?? "").trim()
  const companyId = Number(req.body?.companyId)
  const isEnabled = Boolean(req.body?.isEnabled)
  if (!id || !Number.isFinite(companyId)) {
    res.status(400).json({ error: "Invalid params" })
    return
  }
  try {
    const datasetId = datasetIdFromRequest(req, req.body as Record<string, unknown>)
    const pool = await getTrackingPool()
    await ensureConditionalFormattingRulesTable(pool)
    const r = pool.request()
    r.input("id", sql.UniqueIdentifier, id)
    r.input("companyId", sql.Int, companyId)
    r.input("datasetId", sql.NVarChar(64), datasetId)
    r.input("isEnabled", sql.Bit, isEnabled ? 1 : 0)
    await r.query(`
      UPDATE dbo.ConditionalFormattingRules
      SET IsEnabled = @isEnabled, UpdatedAt = SYSUTCDATETIME()
      WHERE Id = @id AND CompanyId = @companyId AND DatasetId = @datasetId
    `)
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Update failed" })
  }
}

const postPowerBiCensusSchema = z.object({
  residentId: z.string().min(1).max(500),
})

/** Proxy: runs census DAX on Power BI dataset (secret server-side only). */
export async function postPowerBiCensus(req: Request, res: Response) {
  try {
    const parsed = postPowerBiCensusSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: "residentId is required.", rows: [] })
      return
    }
    const secret = process.env.POWERBI_EXECUTE_DAX_SECRET?.trim()
    if (!secret) {
      res.status(503).json({
        error:
          "POWERBI_EXECUTE_DAX_SECRET is not set. Add it to backend or repo-root .env.local.",
        rows: [],
      })
      return
    }
    const datasetId = process.env.POWERBI_DATASET_ID?.trim()
    const executeUrl = process.env.POWERBI_EXECUTE_DAX_URL?.trim()
    const { rows } = await executeCensusDaxForResident(parsed.data.residentId, {
      secret,
      datasetId: datasetId || undefined,
      executeUrl: executeUrl || undefined,
    })
    res.json({ rows, empty: rows.length === 0 })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Census query failed."
    console.error("postPowerBiCensus:", error)
    res.status(502).json({ error: message, rows: [] })
  }
}
