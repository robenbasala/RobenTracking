# Tracking (SNF Tracker)

Monorepo with a **separate Express API** and **Next.js frontend**.

## Structure

- `backend/` — Node.js + Express, SQL Server (`mssql`), all `/api/*` routes (see `backend/server.ts`).
- `frontend/` — Next.js 16 + React (UI only); calls the API over HTTP via `frontend/src/services/api.ts` (import as `@/services/api`).
- `sql/` — database scripts (shared reference).

## Prerequisites

- Node.js 20+ recommended  
- SQL Server connection string for the backend

## Environment variables

### Backend (`TRACKING_DB_CONNECTION_STRING`)

The API process reads env from, in order: **`backend/.env.local`**, **`backend/.env`**, then **repo-root** `.env.local` / `.env` (same folder as `package.json`), then current working directory.

Put **`TRACKING_DB_CONNECTION_STRING` here** — not only inside `frontend/.env.local` (the browser never sees server secrets; Next used to inject server env when API lived in Next).

| Variable | Purpose |
|----------|---------|
| `TRACKING_DB_CONNECTION_STRING` | SQL Server connection string (required) |
| `AZURE_STORAGE_ACCOUNT` | Azure Blob storage account name (required for attachments upload/download) |
| `AZURE_STORAGE_KEY` | Azure Blob storage account key (required for attachments upload/download) |
| `AZURE_STORAGE_CONTAINER` | Azure Blob container name (required for attachments upload/download) |
| `TRACKING_DEFAULT_COMPANY_ID` | Default company id when query omits `companyId` |
| `TRACKING_GRID_USE_REPORT_ITEM_IDS_PROC` | When `1` (default), pending-tracking **grid** loads eligible `TrackingItemId` rows via **`dbo.trk_PendingTracking_ReportSelectItemIds`** (`INSERT…EXEC`) then aggregates `FieldMetadata` in SQL. Set to `0` to use a direct `JOIN` to **`fn_PendingTracking_ReportEligibleItems`** instead (same filter, no proc). Requires **`sql/012`** on the database. |
| `PORT` | API port (default **3001**) |

Optional: `TRACKING_DEFAULT_FACILITY_NAME`, `TRACKING_AUTO_SEED_FIELD_METADATA`, `TRACKING_SKIP_AUTO_FIELD_METADATA_SCHEMA` (same semantics as before).

### Frontend (`frontend/.env.local`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Base URL of the API (default `http://localhost:3001`) |
| `NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID` | Shown defaults in UI |
| `NEXT_PUBLIC_DEFAULT_FACILITY_ID`, `NEXT_PUBLIC_DEFAULT_STATE` | Optional filters |
| `NEXT_PUBLIC_ACTING_USER` | Optional display name recorded as **Stopped by** when using Stop tracking |

## Run locally

From the **repository root**:

```bash
npm install
```

**Terminal 1 — API**

```bash
npm run dev:backend
```

**Terminal 2 — UI**

```bash
npm run dev:frontend
```

- Frontend: http://localhost:3000  
- Backend: http://localhost:3001  

The UI sends all requests to `NEXT_PUBLIC_API_BASE_URL` (CORS is enabled on the API).

## Pending Tracking report filter (SQL)

Run these on your tracking database **in order**:

1. **`sql/010-pending-tracking-report-filter.sql`** — **`dbo.fn_PendingTracking_MatchesReport`** (tab → payer rules: Income, Managed Care, Medicaid Pending, Medicare, Private, Recerts, Other, plus legacy `ViewType` match).
2. **`sql/012-pending-tracking-report-eligible-items.sql`** — **`dbo.fn_PendingTracking_ReportEligibleItems`** (full row filter: company, facility CSV, status, search, active flag + report rules) and **`dbo.trk_PendingTracking_ReportSelect`**.
3. **`sql/014-resident-attachment-identifiers.sql`** — adds `UniqueId` and `ResidentId` columns on `dbo.ResidentAttachment` to store resident-level identifiers with each attachment.

The grid and Excel export **JOIN** the TVF from **012** when it exists (same filter as the SP). If the TVF is missing, the API falls back to an inline `WHERE` using **`fn_PendingTracking_MatchesReport`** plus facility/status/search so the UI still works. Detection of the TVF / `ReportSelectItemIds` proc is **not cached**, so after you run **012** the next request picks them up without restarting the API.

The UI still passes the selected tab name as `viewType` / report key.

For ad hoc reporting, **`dbo.trk_PendingTracking_ReportSelect`** returns full `TrackingItemsTbl` rows (same filter). The **grid API** (when `TRACKING_GRID_USE_REPORT_ITEM_IDS_PROC` is on) loads eligible ids via **`dbo.trk_PendingTracking_ReportSelectItemIds`** (`INSERT…EXEC`), not by calling `trk_PendingTracking_ReportSelect` directly.

Run **`sql/011-tracking-stop-audit.sql`** to add `StoppedAt` / `StoppedBy` on `TrackingItemsTbl` and the **`dbo.TrackingItemStopAudit`** log table (required for stop-tracking and grid exports of active/stopped columns).

The UI sends **`NEXT_PUBLIC_ACTING_USER`** (optional) as the `stoppedBy` query parameter when stopping tracking. Excel and PDF exports include **Active**, **Stopped at**, and **Stopped by** columns.

## Production build

```bash
npm run build
npm run start:frontend
npm run start:backend
```

Ensure `NEXT_PUBLIC_API_BASE_URL` in the frontend build points at the deployed API URL.
