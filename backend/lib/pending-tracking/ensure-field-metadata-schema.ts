/**
 * Creates dbo.FieldMetadata and related tables if missing (same DDL as sql/003).
 * Runs once per process after connect; safe for parallel calls.
 */
import type { ConnectionPool } from "mssql"

let ensurePromise: Promise<void> | null = null

function resetEnsurePromise(): void {
  ensurePromise = null
}

const BATCH = `
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FieldMetadata (
    FieldMetadataId INT IDENTITY(1, 1) NOT NULL,
    CompanyId INT NOT NULL,
    FieldName NVARCHAR(128) NOT NULL,
    DisplayName NVARCHAR(256) NOT NULL,
    DataType NVARCHAR(50) NOT NULL,
    ScreenLocation NVARCHAR(20) NOT NULL,
    DisplayOrder INT NOT NULL CONSTRAINT DF_FieldMetadata_DisplayOrder DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_FieldMetadata_IsActive DEFAULT (1),
    IsRequired BIT NOT NULL CONSTRAINT DF_FieldMetadata_IsRequired DEFAULT (0),
    IsEditable BIT NOT NULL CONSTRAINT DF_FieldMetadata_IsEditable DEFAULT (1),
    IsSystemField BIT NOT NULL CONSTRAINT DF_FieldMetadata_IsSystemField DEFAULT (0),
    SourceType NVARCHAR(20) NOT NULL,
    SourceColumnName NVARCHAR(128) NULL,
    FieldKind NVARCHAR(20) NOT NULL CONSTRAINT DF_FieldMetadata_FieldKind DEFAULT (N'regular'),
    FormulaDefinitionJson NVARCHAR(MAX) NULL,
    CONSTRAINT PK_FieldMetadata PRIMARY KEY CLUSTERED (FieldMetadataId),
    CONSTRAINT CK_FieldMetadata_ScreenLocation CHECK (ScreenLocation IN (N'Main', N'Detail', N'Both')),
    CONSTRAINT CK_FieldMetadata_SourceType CHECK (SourceType IN (N'BaseTable', N'Custom')),
    CONSTRAINT CK_FieldMetadata_FieldKind CHECK (FieldKind IN (N'regular', N'calculated')),
    CONSTRAINT CK_FieldMetadata_DataType CHECK (
      DataType IN (
        N'text', N'number', N'date', N'boolean', N'dropdown', N'textarea', N'currency'
      )
    ),
    CONSTRAINT UQ_FieldMetadata_Company_FieldName UNIQUE (CompanyId, FieldName)
  );
  CREATE NONCLUSTERED INDEX IX_FieldMetadata_Company_Screen
    ON dbo.FieldMetadata (CompanyId, ScreenLocation, IsActive)
    INCLUDE (DisplayOrder);
END;

IF OBJECT_ID(N'dbo.FieldMetadataPayerType', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FieldMetadataPayerType (
    FieldMetadataPayerTypeId INT IDENTITY(1, 1) NOT NULL,
    FieldMetadataId INT NOT NULL,
    PayerType NVARCHAR(100) NOT NULL,
    CONSTRAINT PK_FieldMetadataPayerType PRIMARY KEY CLUSTERED (FieldMetadataPayerTypeId),
    CONSTRAINT FK_FieldMetadataPayerType_FieldMetadata
      FOREIGN KEY (FieldMetadataId) REFERENCES dbo.FieldMetadata (FieldMetadataId) ON DELETE CASCADE,
    CONSTRAINT UQ_FieldMetadataPayerType UNIQUE (FieldMetadataId, PayerType)
  );
  CREATE NONCLUSTERED INDEX IX_FieldMetadataPayerType_Field ON dbo.FieldMetadataPayerType (FieldMetadataId);
END;

IF OBJECT_ID(N'dbo.FieldMetadataViewOrder', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FieldMetadataViewOrder (
    FieldMetadataViewOrderId INT IDENTITY(1, 1) NOT NULL,
    FieldMetadataId INT NOT NULL,
    ViewType NVARCHAR(100) NOT NULL,
    DisplayOrder INT NOT NULL,
    CONSTRAINT PK_FieldMetadataViewOrder PRIMARY KEY CLUSTERED (FieldMetadataViewOrderId),
    CONSTRAINT FK_FieldMetadataViewOrder_FieldMetadata
      FOREIGN KEY (FieldMetadataId) REFERENCES dbo.FieldMetadata (FieldMetadataId) ON DELETE CASCADE,
    CONSTRAINT UQ_FieldMetadataViewOrder UNIQUE (FieldMetadataId, ViewType)
  );
  CREATE NONCLUSTERED INDEX IX_FieldMetadataViewOrder_Field ON dbo.FieldMetadataViewOrder (FieldMetadataId);
END;

IF OBJECT_ID(N'dbo.FieldMetadataState', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FieldMetadataState (
    FieldMetadataStateId INT IDENTITY(1, 1) NOT NULL,
    FieldMetadataId INT NOT NULL,
    State CHAR(2) NOT NULL,
    CONSTRAINT PK_FieldMetadataState PRIMARY KEY CLUSTERED (FieldMetadataStateId),
    CONSTRAINT FK_FieldMetadataState_FieldMetadata
      FOREIGN KEY (FieldMetadataId) REFERENCES dbo.FieldMetadata (FieldMetadataId) ON DELETE CASCADE,
    CONSTRAINT UQ_FieldMetadataState UNIQUE (FieldMetadataId, State)
  );
  CREATE NONCLUSTERED INDEX IX_FieldMetadataState_Field ON dbo.FieldMetadataState (FieldMetadataId);
END;

IF OBJECT_ID(N'dbo.FieldMetadataOption', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FieldMetadataOption (
    FieldOptionId INT IDENTITY(1, 1) NOT NULL,
    FieldMetadataId INT NOT NULL,
    OptionValue NVARCHAR(500) NOT NULL,
    OptionLabel NVARCHAR(500) NULL,
    DisplayOrder INT NOT NULL CONSTRAINT DF_FieldMetadataOption_DisplayOrder DEFAULT (0),
    IsActive BIT NOT NULL CONSTRAINT DF_FieldMetadataOption_IsActive DEFAULT (1),
    CONSTRAINT PK_FieldMetadataOption PRIMARY KEY CLUSTERED (FieldOptionId),
    CONSTRAINT FK_FieldMetadataOption_FieldMetadata
      FOREIGN KEY (FieldMetadataId) REFERENCES dbo.FieldMetadata (FieldMetadataId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_FieldMetadataOption_Field ON dbo.FieldMetadataOption (FieldMetadataId, IsActive);
END;

IF OBJECT_ID(N'dbo.TrackingItemFieldValues', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TrackingItemFieldValues (
    Id INT IDENTITY(1, 1) NOT NULL,
    TrackingItemId INT NOT NULL,
    FieldMetadataId INT NOT NULL,
    TextValue NVARCHAR(MAX) NULL,
    NumberValue FLOAT NULL,
    DateValue DATE NULL,
    BooleanValue BIT NULL,
    DropdownOptionId INT NULL,
    CONSTRAINT PK_TrackingItemFieldValues PRIMARY KEY CLUSTERED (Id),
    CONSTRAINT FK_TrackingItemFieldValues_FieldMetadata
      FOREIGN KEY (FieldMetadataId) REFERENCES dbo.FieldMetadata (FieldMetadataId),
    CONSTRAINT FK_TrackingItemFieldValues_FieldOption
      FOREIGN KEY (DropdownOptionId) REFERENCES dbo.FieldMetadataOption (FieldOptionId),
    CONSTRAINT UQ_TrackingItemFieldValues_ItemField UNIQUE (TrackingItemId, FieldMetadataId)
  );
  CREATE NONCLUSTERED INDEX IX_TrackingItemFieldValues_Item ON dbo.TrackingItemFieldValues (TrackingItemId);
END;

-- Add FK from TrackingItemFieldValues to TrackingItemsTbl when both tables exist.
-- Guarded separately because TrackingItemsTbl may not exist on first schema init.
IF OBJECT_ID(N'dbo.TrackingItemFieldValues', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.TrackingItemsTbl', N'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_TrackingItemFieldValues_TrackingItem'
      AND parent_object_id = OBJECT_ID(N'dbo.TrackingItemFieldValues')
  )
  BEGIN
    ALTER TABLE dbo.TrackingItemFieldValues WITH NOCHECK
      ADD CONSTRAINT FK_TrackingItemFieldValues_TrackingItem
      FOREIGN KEY (TrackingItemId) REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE;
  END
END;

-- Existing DBs: allow ScreenLocation = Both (grid + detail)
IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
BEGIN
  IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_FieldMetadata_ScreenLocation'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
  BEGIN
    ALTER TABLE dbo.FieldMetadata DROP CONSTRAINT CK_FieldMetadata_ScreenLocation;
  END
  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_FieldMetadata_ScreenLocation'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
  BEGIN
    ALTER TABLE dbo.FieldMetadata WITH NOCHECK
      ADD CONSTRAINT CK_FieldMetadata_ScreenLocation
      CHECK (ScreenLocation IN (N'Main', N'Detail', N'Both'));
  END
END;

-- ── Modal Sections ──────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ModalSection', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ModalSection (
    ModalSectionId INT IDENTITY(1,1) NOT NULL,
    CompanyId      INT NOT NULL,
    SectionName    NVARCHAR(128) NOT NULL,
    SectionType    NVARCHAR(50)  NOT NULL CONSTRAINT DF_ModalSection_SectionType DEFAULT (N'Standard'),
    DisplayOrder   INT           NOT NULL CONSTRAINT DF_ModalSection_DisplayOrder DEFAULT (0),
    IsActive       BIT           NOT NULL CONSTRAINT DF_ModalSection_IsActive DEFAULT (1),
    CONSTRAINT PK_ModalSection PRIMARY KEY CLUSTERED (ModalSectionId),
    CONSTRAINT UQ_ModalSection_Company_Name UNIQUE (CompanyId, SectionName),
    CONSTRAINT CK_ModalSection_SectionType CHECK (SectionType IN (N'Standard', N'LOCTracking'))
  );
END;

-- ModalSectionId column + FK are applied via ALTER_BATCH below (separate request, sp_executesql)
-- so that the FK referencing a freshly-added column does not cause a same-batch compile error.

-- ── ResidentTask ─────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentTask', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ResidentTask (
    TaskId         INT IDENTITY(1,1) NOT NULL,
    TrackingItemId INT NOT NULL,
    CompanyId      INT NOT NULL,
    Title          NVARCHAR(256) NOT NULL,
    DueDate        DATE NULL,
    Status         NVARCHAR(50)  NOT NULL CONSTRAINT DF_ResidentTask_Status DEFAULT (N'Open'),
    Assignee       NVARCHAR(256) NULL,
    Notes          NVARCHAR(MAX) NULL,
    CreatedAt      DATETIME2     NOT NULL CONSTRAINT DF_ResidentTask_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt      DATETIME2     NULL,
    CreatedBy      NVARCHAR(256) NULL,
    CONSTRAINT PK_ResidentTask PRIMARY KEY CLUSTERED (TaskId),
    CONSTRAINT CK_ResidentTask_Status CHECK (Status IN (N'Open', N'InProgress', N'Completed', N'Cancelled')),
    CONSTRAINT FK_ResidentTask_TrackingItem
      FOREIGN KEY (TrackingItemId) REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentTask_TrackingItem
    ON dbo.ResidentTask (TrackingItemId, Status);
END;

-- ── ResidentNote ──────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentNote', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ResidentNote (
    NoteId         INT IDENTITY(1,1) NOT NULL,
    TrackingItemId INT NOT NULL,
    CompanyId      INT NOT NULL,
    NoteType       NVARCHAR(50)  NOT NULL CONSTRAINT DF_ResidentNote_NoteType DEFAULT (N'CaseNote'),
    Body           NVARCHAR(MAX) NOT NULL,
    CreatedAt      DATETIME2     NOT NULL CONSTRAINT DF_ResidentNote_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedBy      NVARCHAR(256) NULL,
    CONSTRAINT PK_ResidentNote PRIMARY KEY CLUSTERED (NoteId),
    CONSTRAINT CK_ResidentNote_NoteType CHECK (NoteType IN (N'CaseNote', N'Internal', N'External')),
    CONSTRAINT FK_ResidentNote_TrackingItem
      FOREIGN KEY (TrackingItemId) REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentNote_TrackingItem
    ON dbo.ResidentNote (TrackingItemId, CreatedAt);
END;

-- ── ResidentEmail ─────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ResidentEmail (
    EmailId           INT IDENTITY(1,1) NOT NULL,
    TrackingItemId    INT NOT NULL,
    CompanyId         INT NOT NULL,
    Subject           NVARCHAR(500) NOT NULL,
    Body              NVARCHAR(MAX) NULL,
    RecipientEmail    NVARCHAR(500) NOT NULL,
    RecipientName     NVARCHAR(256) NULL,
    CcEmails          NVARCHAR(MAX) NULL,
    SentAt            DATETIME2     NOT NULL CONSTRAINT DF_ResidentEmail_SentAt DEFAULT SYSUTCDATETIME(),
    SentBy            NVARCHAR(256) NULL,
    Status            NVARCHAR(50)  NOT NULL CONSTRAINT DF_ResidentEmail_Status DEFAULT (N'Queued'),
    ExternalMessageId NVARCHAR(500) NULL,
    CONSTRAINT PK_ResidentEmail PRIMARY KEY CLUSTERED (EmailId),
    CONSTRAINT CK_ResidentEmail_Status CHECK (Status IN (N'Sent', N'Failed', N'Queued')),
    CONSTRAINT FK_ResidentEmail_TrackingItem
      FOREIGN KEY (TrackingItemId) REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentEmail_TrackingItem
    ON dbo.ResidentEmail (TrackingItemId, SentAt);
END;

-- Body + CcEmails are applied via ALTER_BATCH below (separate request).

-- ── ResidentAttachment ────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentAttachment', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ResidentAttachment (
    AttachmentId   INT IDENTITY(1,1) NOT NULL,
    TrackingItemId INT NOT NULL,
    CompanyId      INT NOT NULL,
    FileName       NVARCHAR(500)  NOT NULL,
    ContentType    NVARCHAR(200)  NOT NULL,
    FileSizeBytes  BIGINT         NULL,
    BlobUrl        NVARCHAR(2000) NOT NULL,
    BlobContainer  NVARCHAR(256)  NOT NULL,
    BlobName       NVARCHAR(1000) NOT NULL,
    UploadedAt     DATETIME2      NOT NULL CONSTRAINT DF_ResidentAttachment_UploadedAt DEFAULT SYSUTCDATETIME(),
    UploadedBy     NVARCHAR(256)  NULL,
    Description    NVARCHAR(1000) NULL,
    IsDeleted      BIT            NOT NULL CONSTRAINT DF_ResidentAttachment_IsDeleted DEFAULT (0),
    CONSTRAINT PK_ResidentAttachment PRIMARY KEY CLUSTERED (AttachmentId),
    CONSTRAINT FK_ResidentAttachment_TrackingItem
      FOREIGN KEY (TrackingItemId) REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentAttachment_TrackingItem
    ON dbo.ResidentAttachment (TrackingItemId, IsDeleted, UploadedAt);
END;
`

/**
 * Column-addition DDL runs as a SEPARATE request using sp_executesql so every
 * ALTER TABLE is compiled in its own scope.  This avoids the SQL Server same-batch
 * compile-time error where a FK references a column that was added earlier in the
 * same batch but isn't yet in the cached schema.
 *
 * Each IF ... EXEC sp_executesql line is idempotent (guarded by sys.columns checks).
 */
const ALTER_BATCH = `
-- FieldMetadata.ModalSectionId
IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'ModalSectionId'
  )
  EXEC sp_executesql N'ALTER TABLE dbo.FieldMetadata ADD ModalSectionId INT NULL';

-- FK: FieldMetadata.ModalSectionId → ModalSection  (only once ModalSectionId exists)
IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.ModalSection', N'U') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'ModalSectionId'
  )
  AND NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_FieldMetadata_ModalSection'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
  EXEC sp_executesql N'ALTER TABLE dbo.FieldMetadata ADD CONSTRAINT FK_FieldMetadata_ModalSection FOREIGN KEY (ModalSectionId) REFERENCES dbo.ModalSection (ModalSectionId) ON DELETE SET NULL';

-- ResidentEmail.Body
IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name = N'Body'
  )
  EXEC sp_executesql N'ALTER TABLE dbo.ResidentEmail ADD Body NVARCHAR(MAX) NULL';

-- ResidentEmail.CcEmails
IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name = N'CcEmails'
  )
  EXEC sp_executesql N'ALTER TABLE dbo.ResidentEmail ADD CcEmails NVARCHAR(MAX) NULL';

-- FieldMetadata.FieldKind
IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'FieldKind'
  )
  EXEC sp_executesql N'ALTER TABLE dbo.FieldMetadata ADD FieldKind NVARCHAR(20) NOT NULL CONSTRAINT DF_FieldMetadata_FieldKind_Mig DEFAULT (N''regular'')';

-- FieldMetadata.FormulaDefinitionJson
IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'FormulaDefinitionJson'
  )
  EXEC sp_executesql N'ALTER TABLE dbo.FieldMetadata ADD FormulaDefinitionJson NVARCHAR(MAX) NULL';

-- CK_FieldMetadata_FieldKind (existing DBs migrated with DEFAULT only)
IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_FieldMetadata_FieldKind'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
  EXEC sp_executesql N'ALTER TABLE dbo.FieldMetadata WITH NOCHECK ADD CONSTRAINT CK_FieldMetadata_FieldKind CHECK (FieldKind IN (N''regular'', N''calculated''))';
`

export async function ensureFieldMetadataSchema(
  pool: ConnectionPool
): Promise<void> {
  if (process.env.TRACKING_SKIP_AUTO_FIELD_METADATA_SCHEMA === "1") {
    return
  }
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await pool.request().query(BATCH)
      await pool.request().query(ALTER_BATCH)
    })()
      .then(() => undefined)
      .catch((e) => {
        resetEnsurePromise()
        throw e
      })
  }
  await ensurePromise
}
