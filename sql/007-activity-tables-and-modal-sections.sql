/*
  007 – Modal sections and activity tables.

  Creates (if missing):
    dbo.ModalSection
    dbo.ResidentTask
    dbo.ResidentNote
    dbo.ResidentEmail       (includes Body, CcEmails columns)
    dbo.ResidentAttachment

  Adds (if missing):
    dbo.FieldMetadata.ModalSectionId  FK → dbo.ModalSection
    dbo.ResidentEmail.Body            (existing installs pre-007)
    dbo.ResidentEmail.CcEmails        (existing installs pre-007)

  Prerequisites : 003-field-metadata-schema.sql applied.
  Safe to re-run: every block is guarded with IF OBJECT_ID / IF NOT EXISTS.

  Run against the same database as TRACKING_DB_CONNECTION_STRING, e.g.:
    sqlcmd -S yourServer -d YourDbName -i 007-activity-tables-and-modal-sections.sql
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ── ModalSection ──────────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ModalSection', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ModalSection (
    ModalSectionId INT IDENTITY(1,1) NOT NULL,
    CompanyId      INT          NOT NULL,
    SectionName    NVARCHAR(128) NOT NULL,
    SectionType    NVARCHAR(50)  NOT NULL
      CONSTRAINT DF_ModalSection_SectionType DEFAULT (N'Standard'),
    DisplayOrder   INT           NOT NULL
      CONSTRAINT DF_ModalSection_DisplayOrder DEFAULT (0),
    IsActive       BIT           NOT NULL
      CONSTRAINT DF_ModalSection_IsActive DEFAULT (1),
    CONSTRAINT PK_ModalSection PRIMARY KEY CLUSTERED (ModalSectionId),
    CONSTRAINT UQ_ModalSection_Company_Name UNIQUE (CompanyId, SectionName),
    CONSTRAINT CK_ModalSection_SectionType
      CHECK (SectionType IN (N'Standard', N'LOCTracking'))
  );
  PRINT N'Created dbo.ModalSection.';
END
ELSE
  PRINT N'dbo.ModalSection already exists — skipped.';
GO

-- ── FieldMetadata.ModalSectionId ──────────────────────────────────────────────
IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata')
      AND name = N'ModalSectionId'
  )
BEGIN
  ALTER TABLE dbo.FieldMetadata ADD ModalSectionId INT NULL;
  PRINT N'Added dbo.FieldMetadata.ModalSectionId column.';
END
GO

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.ModalSection', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_FieldMetadata_ModalSection'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
BEGIN
  ALTER TABLE dbo.FieldMetadata
    ADD CONSTRAINT FK_FieldMetadata_ModalSection
    FOREIGN KEY (ModalSectionId) REFERENCES dbo.ModalSection (ModalSectionId)
    ON DELETE SET NULL;
  PRINT N'Added FK_FieldMetadata_ModalSection.';
END
GO

-- ── ResidentTask ──────────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentTask', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ResidentTask (
    TaskId         INT IDENTITY(1,1) NOT NULL,
    TrackingItemId BIGINT        NOT NULL,
    CompanyId      INT           NOT NULL,
    Title          NVARCHAR(256) NOT NULL,
    DueDate        DATE          NULL,
    Status         NVARCHAR(50)  NOT NULL
      CONSTRAINT DF_ResidentTask_Status DEFAULT (N'Open'),
    Assignee       NVARCHAR(256) NULL,
    Notes          NVARCHAR(MAX) NULL,
    CreatedAt      DATETIME2     NOT NULL
      CONSTRAINT DF_ResidentTask_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedAt      DATETIME2     NULL,
    CreatedBy      NVARCHAR(256) NULL,
    CONSTRAINT PK_ResidentTask PRIMARY KEY CLUSTERED (TaskId),
    CONSTRAINT CK_ResidentTask_Status
      CHECK (Status IN (N'Open', N'InProgress', N'Completed', N'Cancelled')),
    CONSTRAINT FK_ResidentTask_TrackingItem
      FOREIGN KEY (TrackingItemId)
      REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentTask_TrackingItem
    ON dbo.ResidentTask (TrackingItemId, Status);
  PRINT N'Created dbo.ResidentTask.';
END
ELSE
  PRINT N'dbo.ResidentTask already exists — skipped.';
GO

-- ── ResidentNote ──────────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentNote', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ResidentNote (
    NoteId         INT IDENTITY(1,1) NOT NULL,
    TrackingItemId BIGINT        NOT NULL,
    CompanyId      INT           NOT NULL,
    NoteType       NVARCHAR(50)  NOT NULL
      CONSTRAINT DF_ResidentNote_NoteType DEFAULT (N'CaseNote'),
    Body           NVARCHAR(MAX) NOT NULL,
    CreatedAt      DATETIME2     NOT NULL
      CONSTRAINT DF_ResidentNote_CreatedAt DEFAULT SYSUTCDATETIME(),
    CreatedBy      NVARCHAR(256) NULL,
    CONSTRAINT PK_ResidentNote PRIMARY KEY CLUSTERED (NoteId),
    CONSTRAINT CK_ResidentNote_NoteType
      CHECK (NoteType IN (N'CaseNote', N'Internal', N'External')),
    CONSTRAINT FK_ResidentNote_TrackingItem
      FOREIGN KEY (TrackingItemId)
      REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentNote_TrackingItem
    ON dbo.ResidentNote (TrackingItemId, CreatedAt);
  PRINT N'Created dbo.ResidentNote.';
END
ELSE
  PRINT N'dbo.ResidentNote already exists — skipped.';
GO

-- ── ResidentEmail ─────────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NULL
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
    SentAt            DATETIME2      NOT NULL
      CONSTRAINT DF_ResidentEmail_SentAt DEFAULT SYSUTCDATETIME(),
    SentBy            NVARCHAR(256)  NULL,
    Status            NVARCHAR(50)   NOT NULL
      CONSTRAINT DF_ResidentEmail_Status DEFAULT (N'Queued'),
    ExternalMessageId NVARCHAR(500)  NULL,
    CONSTRAINT PK_ResidentEmail PRIMARY KEY CLUSTERED (EmailId),
    CONSTRAINT CK_ResidentEmail_Status
      CHECK (Status IN (N'Sent', N'Failed', N'Queued')),
    CONSTRAINT FK_ResidentEmail_TrackingItem
      FOREIGN KEY (TrackingItemId)
      REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentEmail_TrackingItem
    ON dbo.ResidentEmail (TrackingItemId, SentAt);
  PRINT N'Created dbo.ResidentEmail.';
END
ELSE
  PRINT N'dbo.ResidentEmail already exists — adding missing columns if needed.';
GO

-- Add Body column to existing installs (created by ensure-field-metadata-schema before 007)
IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name = N'Body'
  )
BEGIN
  ALTER TABLE dbo.ResidentEmail ADD Body NVARCHAR(MAX) NULL;
  PRINT N'Added dbo.ResidentEmail.Body column.';
END
GO

-- Add CcEmails column to existing installs
IF OBJECT_ID(N'dbo.ResidentEmail', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.ResidentEmail') AND name = N'CcEmails'
  )
BEGIN
  ALTER TABLE dbo.ResidentEmail ADD CcEmails NVARCHAR(MAX) NULL;
  PRINT N'Added dbo.ResidentEmail.CcEmails column.';
END
GO

-- ── ResidentAttachment ────────────────────────────────────────────────────────
IF OBJECT_ID(N'dbo.ResidentAttachment', N'U') IS NULL
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
    UploadedAt     DATETIME2      NOT NULL
      CONSTRAINT DF_ResidentAttachment_UploadedAt DEFAULT SYSUTCDATETIME(),
    UploadedBy     NVARCHAR(256)  NULL,
    Description    NVARCHAR(1000) NULL,
    IsDeleted      BIT            NOT NULL
      CONSTRAINT DF_ResidentAttachment_IsDeleted DEFAULT (0),
    CONSTRAINT PK_ResidentAttachment PRIMARY KEY CLUSTERED (AttachmentId),
    CONSTRAINT FK_ResidentAttachment_TrackingItem
      FOREIGN KEY (TrackingItemId)
      REFERENCES dbo.TrackingItemsTbl (TrackingItemId) ON DELETE CASCADE
  );
  CREATE NONCLUSTERED INDEX IX_ResidentAttachment_TrackingItem
    ON dbo.ResidentAttachment (TrackingItemId, IsDeleted, UploadedAt);
  PRINT N'Created dbo.ResidentAttachment.';
END
ELSE
  PRINT N'dbo.ResidentAttachment already exists — skipped.';
GO

PRINT N'Migration 007 complete.';
GO
