/*
  Field metadata (per company) + custom values + payer/state applicability.
  ScreenLocation: Main = grid, Detail = drawer/detail.
  Run after PendingTrackingItem exists.

  ---------------------------------------------------------------------------
  REQUIRED: Run this script in the SAME database as your app connection string.
  In .env.local, TRACKING_DB_CONNECTION_STRING must include that database, e.g.:
    Database=YourDbName   or   Initial Catalog=YourDbName

  In SSMS / Azure Data Studio: select that database in the dropdown, then execute.
  Or uncomment USE below (replace YourDbName), then run the whole file.

  sqlcmd example:
    sqlcmd -S yourServer -d YourDbName -i 003-field-metadata-schema.sql
  ---------------------------------------------------------------------------
*/

-- USE [YourDbName];
-- GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

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
    CONSTRAINT PK_FieldMetadata PRIMARY KEY CLUSTERED (FieldMetadataId),
    CONSTRAINT CK_FieldMetadata_ScreenLocation CHECK (ScreenLocation IN (N'Main', N'Detail', N'Both')),
    CONSTRAINT CK_FieldMetadata_SourceType CHECK (SourceType IN (N'BaseTable', N'Custom')),
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
END
GO

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
END
GO

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
END
GO

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
END
GO

IF OBJECT_ID(N'dbo.TrackingItemFieldValues', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.TrackingItemFieldValues (
    Id INT IDENTITY(1, 1) NOT NULL,
    TrackingItemId BIGINT NOT NULL,
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
END
GO

/* Migration: alter TrackingItemId to BIGINT for existing tables and add FK to PendingTrackingItem. */
IF OBJECT_ID(N'dbo.TrackingItemFieldValues', N'U') IS NOT NULL
BEGIN
  -- Check if column exists and is INT, then alter to BIGINT
  IF EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.TrackingItemFieldValues')
      AND name = N'TrackingItemId'
      AND system_type_id = 56  -- 56 = INT
  )
  BEGIN
    ALTER TABLE dbo.TrackingItemFieldValues ALTER COLUMN TrackingItemId BIGINT NOT NULL;
    PRINT N'Altered dbo.TrackingItemFieldValues.TrackingItemId to BIGINT.';
  END
END
GO

-- Now add FK if it doesn't exist
IF OBJECT_ID(N'dbo.TrackingItemFieldValues', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.PendingTrackingItem', N'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_TrackingItemFieldValues_TrackingItem'
      AND parent_object_id = OBJECT_ID(N'dbo.TrackingItemFieldValues')
  )
  BEGIN
    ALTER TABLE dbo.TrackingItemFieldValues WITH NOCHECK
      ADD CONSTRAINT FK_TrackingItemFieldValues_TrackingItem
      FOREIGN KEY (TrackingItemId) REFERENCES dbo.PendingTrackingItem (TrackingItemId) ON DELETE CASCADE;
    PRINT N'Added FK_TrackingItemFieldValues_TrackingItem (WITH NOCHECK — existing orphans not validated).';
  END
END
GO

PRINT N'Field metadata schema ensured.';
GO
