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
| `TRACKING_DEFAULT_COMPANY_ID` | Default company id when query omits `companyId` |
| `PORT` | API port (default **3001**) |

Optional: `TRACKING_DEFAULT_FACILITY_NAME`, `TRACKING_AUTO_SEED_FIELD_METADATA`, `TRACKING_SKIP_AUTO_FIELD_METADATA_SCHEMA` (same semantics as before).

### Frontend (`frontend/.env.local`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Base URL of the API (default `http://localhost:3001`) |
| `NEXT_PUBLIC_TRACKING_DEFAULT_COMPANY_ID` | Shown defaults in UI |
| `NEXT_PUBLIC_DEFAULT_FACILITY_ID`, `NEXT_PUBLIC_DEFAULT_STATE` | Optional filters |

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

## Production build

```bash
npm run build
npm run start:frontend
npm run start:backend
```

Ensure `NEXT_PUBLIC_API_BASE_URL` in the frontend build points at the deployed API URL.
