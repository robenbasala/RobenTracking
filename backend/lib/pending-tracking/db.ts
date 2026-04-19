/**
 * Shared SQL Server pool for pending-tracking APIs.
 * Connection string: set TRACKING_DB_CONNECTION_STRING in .env.local (see repo root).
 *
 * On first connect: creates dbo.FieldMetadata (and related tables) if missing,
 * then seeds FieldMetadata from PendingTrackingItem columns when FieldMetadata is empty
 * (disable with TRACKING_AUTO_SEED_FIELD_METADATA=0).
 * Skip DDL with TRACKING_SKIP_AUTO_FIELD_METADATA_SCHEMA=1 (DBA-managed schema).
 */
import sql from "mssql"
import { ensureFieldMetadataSchema } from "./ensure-field-metadata-schema"
import { seedFieldMetadataIfDatabaseEmpty } from "./seed-field-metadata"

let pool: sql.ConnectionPool | null = null
let connectPromise: Promise<sql.ConnectionPool> | null = null

/** Avoid hanging forever when SQL Server is unreachable (seconds, ODBC-style). */
function withConnectionTimeout(connectionString: string, seconds = 15): string {
  const s = connectionString.trim()
  if (/connect(ion)?\s+timeout\s*=/i.test(s)) return s
  return `${s}${s.endsWith(";") ? "" : ";"}Connection Timeout=${seconds}`
}

/**
 * Create activity tables (ResidentTask, ResidentNote, ResidentEmail,
 * ResidentAttachment, ModalSection) if they don't already exist.
 * Safe to re-run — every CREATE is guarded with IF OBJECT_ID IS NULL.
 */
async function ensureActivityTables(p: sql.ConnectionPool): Promise<void> {
  const tables = [
    // ModalSection
    `IF OBJECT_ID(N'dbo.ModalSection', N'U') IS NULL
     BEGIN
       CREATE TABLE dbo.ModalSection (
         ModalSectionId INT IDENTITY(1,1) NOT NULL,
         CompanyId      INT          NOT NULL,
         SectionName    NVARCHAR(128) NOT NULL,
         SectionType    NVARCHAR(50)  NOT NULL DEFAULT (N'Standard'),
         DisplayOrder   INT           NOT NULL DEFAULT (0),
         IsActive       BIT           NOT NULL DEFAULT (1),
         CONSTRAINT PK_ModalSection PRIMARY KEY CLUSTERED (ModalSectionId)
       )
     END`,
    // ResidentTask
    `IF OBJECT_ID(N'dbo.ResidentTask', N'U') IS NULL
     BEGIN
       CREATE TABLE dbo.ResidentTask (
         TaskId         INT IDENTITY(1,1) NOT NULL,
         TrackingItemId INT           NOT NULL,
         CompanyId      INT           NOT NULL,
         Title          NVARCHAR(256) NOT NULL,
         DueDate        DATE          NULL,
         Status         NVARCHAR(50)  NOT NULL DEFAULT (N'Open'),
         Assignee       NVARCHAR(256) NULL,
         Notes          NVARCHAR(MAX) NULL,
         CreatedAt      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
         UpdatedAt      DATETIME2     NULL,
         CreatedBy      NVARCHAR(256) NULL,
         CONSTRAINT PK_ResidentTask PRIMARY KEY CLUSTERED (TaskId),
         CONSTRAINT CK_ResidentTask_Status
           CHECK (Status IN (N'Open', N'InProgress', N'Completed', N'Cancelled'))
       )
     END`,
    // ResidentNote
    `IF OBJECT_ID(N'dbo.ResidentNote', N'U') IS NULL
     BEGIN
       CREATE TABLE dbo.ResidentNote (
         NoteId         INT IDENTITY(1,1) NOT NULL,
         TrackingItemId INT           NOT NULL,
         CompanyId      INT           NOT NULL,
         NoteType       NVARCHAR(50)  NOT NULL DEFAULT (N'CaseNote'),
         Body           NVARCHAR(MAX) NOT NULL,
         CreatedAt      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
         CreatedBy      NVARCHAR(256) NULL,
         CONSTRAINT PK_ResidentNote PRIMARY KEY CLUSTERED (NoteId),
         CONSTRAINT CK_ResidentNote_NoteType
           CHECK (NoteType IN (N'CaseNote', N'Internal', N'External'))
       )
     END`,
    // ResidentEmail
    `IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NULL
     BEGIN
       CREATE TABLE dbo.ResidentEmail (
         EmailId           INT IDENTITY(1,1) NOT NULL,
         TrackingItemId    INT            NOT NULL,
         CompanyId         INT            NOT NULL,
         Subject           NVARCHAR(500)  NOT NULL,
         Body              NVARCHAR(MAX)  NULL,
         RecipientEmail    NVARCHAR(500)  NOT NULL,
         RecipientName     NVARCHAR(256)  NULL,
         CcEmails          NVARCHAR(MAX)  NULL,
         SentAt            DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
         SentBy            NVARCHAR(256)  NULL,
         Status            NVARCHAR(50)   NOT NULL DEFAULT (N'Queued'),
         ExternalMessageId NVARCHAR(500)  NULL,
         CONSTRAINT PK_ResidentEmail PRIMARY KEY CLUSTERED (EmailId),
         CONSTRAINT CK_ResidentEmail_Status
           CHECK (Status IN (N'Sent', N'Failed', N'Queued'))
       )
     END`,
    // ResidentAttachment
    `IF OBJECT_ID(N'dbo.ResidentAttachment', N'U') IS NULL
     BEGIN
       CREATE TABLE dbo.ResidentAttachment (
         AttachmentId   INT IDENTITY(1,1) NOT NULL,
         TrackingItemId INT            NOT NULL,
         CompanyId      INT            NOT NULL,
         FileName       NVARCHAR(500)  NOT NULL,
         ContentType    NVARCHAR(200)  NOT NULL,
         FileSizeBytes  BIGINT         NULL,
         BlobUrl        NVARCHAR(2000) NOT NULL,
         BlobContainer  NVARCHAR(256)  NOT NULL,
         BlobName       NVARCHAR(1000) NOT NULL,
         UploadedAt     DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
         UploadedBy     NVARCHAR(256)  NULL,
         Description    NVARCHAR(1000) NULL,
         IsDeleted      BIT            NOT NULL DEFAULT (0),
         CONSTRAINT PK_ResidentAttachment PRIMARY KEY CLUSTERED (AttachmentId)
       )
     END`,
  ]

  for (const stmt of tables) {
    try {
      await p.request().query(stmt)
    } catch {
      // Silent — table may already exist.
    }
  }
}

/**
 * Belt-and-suspenders column migration.
 * Each ALTER TABLE runs in its own sp_executesql scope so a missing column never
 * causes a compile-time failure in a larger batch, and each is wrapped in
 * BEGIN TRY / END TRY so one failure never blocks the others.
 */
async function runColumnMigrations(p: sql.ConnectionPool): Promise<void> {
  const migrations = [
    // FieldMetadata.ModalSectionId
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'ModalSectionId')
       EXEC sp_executesql N'ALTER TABLE dbo.FieldMetadata ADD ModalSectionId INT NULL'`,
    // FK: FieldMetadata.ModalSectionId → ModalSection
    `IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'ModalSectionId')
       AND OBJECT_ID(N'dbo.ModalSection', N'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_FieldMetadata_ModalSection' AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata'))
       EXEC sp_executesql N'ALTER TABLE dbo.FieldMetadata ADD CONSTRAINT FK_FieldMetadata_ModalSection FOREIGN KEY (ModalSectionId) REFERENCES dbo.ModalSection (ModalSectionId) ON DELETE SET NULL'`,
    // ResidentEmail.Body
    `IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name = N'Body')
       EXEC sp_executesql N'ALTER TABLE dbo.ResidentEmail ADD Body NVARCHAR(MAX) NULL'`,
    // ResidentEmail.CcEmails
    `IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name = N'CcEmails')
       EXEC sp_executesql N'ALTER TABLE dbo.ResidentEmail ADD CcEmails NVARCHAR(MAX) NULL'`,
    // PendingTrackingItem.IsHotCase
    `IF OBJECT_ID(N'dbo.PendingTrackingItem', N'U') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.PendingTrackingItem') AND name = N'IsHotCase')
       EXEC sp_executesql N'ALTER TABLE dbo.PendingTrackingItem ADD IsHotCase BIT NOT NULL DEFAULT 0'`,
  ]

  for (const stmt of migrations) {
    try {
      await p.request().query(stmt)
    } catch {
      // Silent — column may already exist or table not yet created.
    }
  }
}

/** Normalize value from .env / shell (trim, strip wrapping quotes, BOM). */
function normalizeConnectionString(raw: string): string {
  let s = raw.replace(/^\uFEFF/, "").trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim()
  }
  return s
}

export async function getTrackingPool(): Promise<sql.ConnectionPool> {
  if (pool) return pool
  if (!connectPromise) {
    connectPromise = (async () => {
      const raw = process.env.TRACKING_DB_CONNECTION_STRING
      if (!raw) {
        throw new Error("TRACKING_DB_CONNECTION_STRING is not configured.")
      }
      const connectionString = withConnectionTimeout(normalizeConnectionString(raw))
      const p = await sql.connect(connectionString)
      try {
        await ensureFieldMetadataSchema(p)
        await seedFieldMetadataIfDatabaseEmpty(p)
        await ensureActivityTables(p)
        await runColumnMigrations(p)
      } catch (e) {
        try {
          await p.close()
        } catch {
          /* ignore */
        }
        pool = null
        throw e
      }
      pool = p
      return p
    })().finally(() => {
      connectPromise = null
    })
  }
  return connectPromise
}
