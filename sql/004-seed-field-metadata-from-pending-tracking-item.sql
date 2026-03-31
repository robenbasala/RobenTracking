/*
  Seeds dbo.FieldMetadata from dbo.PendingTrackingItem columns (one row per column per company).
  Maps SQL types to metadata DataType. Sets SourceType = BaseTable, IsSystemField = 1.
  ScreenLocation: first pass sets all to Detail; optionally move Main fields in admin.
  Safe to re-run: skips existing (CompanyId, FieldName).

  Usage: set @CompanyId, then execute.
*/

SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

DECLARE @CompanyId INT = 1; /* <-- change per tenant */

IF OBJECT_ID(N'dbo.PendingTrackingItem', N'U') IS NULL
BEGIN
  RAISERROR('PendingTrackingItem not found.', 16, 1);
  RETURN;
END

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NULL
BEGIN
  RAISERROR('Run 003-field-metadata-schema.sql first.', 16, 1);
  RETURN;
END

DECLARE @sql nvarchar(max) = N'
INSERT INTO dbo.FieldMetadata (
  CompanyId, FieldName, DisplayName, DataType, ScreenLocation, DisplayOrder,
  IsActive, IsRequired, IsEditable, IsSystemField, SourceType, SourceColumnName
)
SELECT
  @CompanyId,
  c.COLUMN_NAME,
  DisplayName = REPLACE(REPLACE(c.COLUMN_NAME, N''_'', N'' ''), N''Id'', N'' ID''),
  DataType = CASE
    WHEN c.DATA_TYPE IN (''varchar'', ''nvarchar'', ''char'', ''nchar'', ''text'', ''ntext'') THEN N''text''
    WHEN c.DATA_TYPE IN (''money'', ''smallmoney'') THEN N''currency''
    WHEN c.DATA_TYPE IN (''decimal'', ''numeric'', ''float'', ''real'', ''int'', ''bigint'', ''smallint'', ''tinyint'') THEN N''number''
    WHEN c.DATA_TYPE IN (''date'', ''datetime'', ''datetime2'', ''smalldatetime'', ''datetimeoffset'') THEN N''date''
    WHEN c.DATA_TYPE = ''bit'' THEN N''boolean''
    ELSE N''text''
  END,
  ScreenLocation = N''Detail'',
  DisplayOrder = c.ORDINAL_POSITION * 10,
  IsActive = 1,
  IsRequired = 0,
  IsEditable = 1,
  IsSystemField = 1,
  SourceType = N''BaseTable'',
  SourceColumnName = c.COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS c
WHERE c.TABLE_SCHEMA = N''dbo''
  AND c.TABLE_NAME = N''PendingTrackingItem''
  AND NOT EXISTS (
    SELECT 1 FROM dbo.FieldMetadata fm
    WHERE fm.CompanyId = @CompanyId AND fm.FieldName = c.COLUMN_NAME
  );
';

EXEC sp_executesql @sql, N'@CompanyId int', @CompanyId = @CompanyId;

/* Optional: surface common grid columns on Main (adjust names to match your DB) */
UPDATE fm
SET ScreenLocation = N'Main', DisplayOrder = o.ord
FROM dbo.FieldMetadata fm
INNER JOIN (
  SELECT N'ResidentName' AS fn, 10 AS ord UNION ALL
  SELECT N'FacilityName', 20 UNION ALL
  SELECT N'ViewType', 30 UNION ALL
  SELECT N'Status', 40 UNION ALL
  SELECT N'Balance', 50 UNION ALL
  SELECT N'AdmitDate', 60
) o ON fm.FieldName = o.fn
WHERE fm.CompanyId = @CompanyId AND fm.IsSystemField = 1;

PRINT N'Seed complete for CompanyId = ' + CAST(@CompanyId AS varchar(11));
GO
