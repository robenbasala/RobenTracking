/**
 * Tracking API — all HTTP route registrations live in this file.
 * Handler implementations are in route-handlers.ts (database, validation, JSON shapes).
 */
import cors from "cors"
import dotenv from "dotenv"
import express from "express"
import multer from "multer"
import path from "path"
import { fileURLToPath } from "url"
import * as h from "./route-handlers.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
/** Parent of `backend/` — same place the Next.js app used to load `.env.local` from. */
const repoRoot = path.join(__dirname, "..")

/**
 * Load env like the old single-app setup: repo-root `.env.local` / `.env` first,
 * then `backend/` overrides, then cwd (npm -w sometimes uses monorepo root).
 */
/** `.env.local` wins over pre-set env (e.g. Windows user/system `TRACKING_DB_*`). */
const envPaths: { path: string; override?: boolean }[] = [
  { path: path.join(repoRoot, ".env.local"), override: true },
  { path: path.join(repoRoot, ".env") },
  { path: path.join(__dirname, ".env.local"), override: true },
  { path: path.join(__dirname, ".env") },
  { path: path.join(process.cwd(), ".env.local"), override: true },
  { path: path.join(process.cwd(), ".env") },
]
for (const { path: envPath, override } of envPaths) {
  dotenv.config({ path: envPath, ...(override ? { override: true } : {}) })
}

const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: "10mb" }))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })
const uploadSingleFile = upload.single("file") as unknown as express.RequestHandler

// ---------------------------------------------------------------------------
// Tracking lists & dashboard
// ---------------------------------------------------------------------------
app.get("/api/tracking-items", h.getTrackingItems)
app.get("/api/hot-cases", h.getHotCases)
app.get("/api/tasks", h.getTasks)

// ---------------------------------------------------------------------------
// Census (Power BI DAX proxy — secret stays on server)
// ---------------------------------------------------------------------------
app.post("/api/census/power-bi", h.postPowerBiCensus)

// ---------------------------------------------------------------------------
// Pending tracking — grid, filters, export
// ---------------------------------------------------------------------------
app.get("/api/pending-tracking/view-types", h.getViewTypes)
app.get("/api/pending-tracking/facilities", h.getFacilities)
app.get("/api/pending-tracking/fields", h.getFields)
app.get("/api/pending-tracking/grid", h.getGrid)
app.get("/api/pending-tracking/export", h.getExport)
app.get("/api/pending-tracking/export-pdf", h.getExportPdf)

// ---------------------------------------------------------------------------
// Pending tracking — single item & values
// ---------------------------------------------------------------------------
app.get("/api/pending-tracking/:trackingItemId", h.getPendingDetail)
app.delete("/api/pending-tracking/:trackingItemId", h.deletePendingItem)
app.put("/api/pending-tracking/:trackingItemId/values", h.putPendingValues)
app.patch("/api/pending-tracking/:trackingItemId/hot-case", h.patchHotCase)

// ---------------------------------------------------------------------------
// Resident notes
// ---------------------------------------------------------------------------
app.get("/api/pending-tracking/:trackingItemId/notes", h.getNotes)
app.post("/api/pending-tracking/:trackingItemId/notes", h.postNote)
app.patch(
  "/api/pending-tracking/:trackingItemId/notes/:noteId",
  h.patchNote
)
app.delete(
  "/api/pending-tracking/:trackingItemId/notes/:noteId",
  h.deleteNote
)

// ---------------------------------------------------------------------------
// Resident emails
// ---------------------------------------------------------------------------
app.get("/api/pending-tracking/:trackingItemId/emails", h.getEmails)
app.post("/api/pending-tracking/:trackingItemId/emails", h.postEmail)

// ---------------------------------------------------------------------------
// Resident tasks (per tracking item)
// ---------------------------------------------------------------------------
app.get("/api/pending-tracking/:trackingItemId/tasks", h.getResidentTasks)
app.post("/api/pending-tracking/:trackingItemId/tasks", h.postResidentTask)
app.patch(
  "/api/pending-tracking/:trackingItemId/tasks/:taskId",
  h.patchResidentTask
)
app.delete(
  "/api/pending-tracking/:trackingItemId/tasks/:taskId",
  h.deleteResidentTask
)

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
app.get(
  "/api/pending-tracking/:trackingItemId/attachments",
  h.getAttachments
)
app.post(
  "/api/pending-tracking/:trackingItemId/attachments",
  h.postAttachment
)
app.post(
  "/api/pending-tracking/:trackingItemId/attachments/upload",
  uploadSingleFile,
  h.postAttachmentUpload
)
app.get(
  "/api/pending-tracking/:trackingItemId/attachments/:attachmentId/download",
  h.getAttachmentDownload
)
app.delete(
  "/api/pending-tracking/:trackingItemId/attachments/:attachmentId",
  h.deleteAttachment
)

// ---------------------------------------------------------------------------
// Admin — field metadata & options
// ---------------------------------------------------------------------------
app.get(
  "/api/admin/field-metadata/tracking-columns",
  h.getAdminTrackingItemColumns
)
app.get("/api/admin/field-metadata", h.getAdminFieldMetadata)
app.post("/api/admin/field-metadata", h.postAdminFieldMetadata)
app.patch(
  "/api/admin/field-metadata/:fieldMetadataId",
  h.patchAdminFieldMetadata
)
app.delete(
  "/api/admin/field-metadata/:fieldMetadataId",
  h.deleteAdminFieldMetadata
)
app.get(
  "/api/admin/field-metadata/:fieldMetadataId/options",
  h.getFieldOptions
)
app.post(
  "/api/admin/field-metadata/:fieldMetadataId/options",
  h.postFieldOption
)
app.patch(
  "/api/admin/field-metadata/:fieldMetadataId/options/:optionId",
  h.patchFieldOption
)
app.delete(
  "/api/admin/field-metadata/:fieldMetadataId/options/:optionId",
  h.deleteFieldOption
)

// ---------------------------------------------------------------------------
// Admin — field order & modal sections
// ---------------------------------------------------------------------------
app.get("/api/admin/field-order", h.getFieldOrder)
app.put("/api/admin/field-order", h.putFieldOrder)
app.delete("/api/admin/field-order", h.deleteFieldOrder)
app.get("/api/admin/modal-sections", h.getModalSections)
app.post("/api/admin/modal-sections", h.postModalSection)
app.patch("/api/admin/modal-sections/:sectionId", h.patchModalSection)
app.delete("/api/admin/modal-sections/:sectionId", h.deleteModalSection)

const port = Number(process.env.PORT ?? 3001)
const server = app.listen(port, () => {
  console.log(`Tracking API listening on http://localhost:${port}`)
})
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the other API process or set PORT to a free port (e.g. PORT=3002).`
    )
  } else {
    console.error(err)
  }
  process.exit(1)
})
