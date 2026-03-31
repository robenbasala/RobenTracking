/*
  Merge dbo.PendingFieldDefinition into dbo.FieldMetadata + dbo.FieldMetadataPayerType.

  Rules:
  - One FieldMetadata row per (CompanyId, FieldName). If multiple ViewTypes define the same
    field, the row with lowest FieldDefinitionId wins for DisplayName / DisplayOrder / etc.
  - Each (FieldDefinitionId) ViewType becomes a row in FieldMetadataPayerType(PayerType = ViewType).
  - Extension fields are stored as SourceType = Custom (not columns on PendingTrackingItem).
  - ScreenLocation: Grid -> Main, Detail stays Detail (legacy "Base" -> Detail).

  Prerequisites: 003-field-metadata-schema.sql applied. Safe to re-run: skips existing FieldMetadata
  (CompanyId, FieldName). Payer rows are inserted only if missing.

  Does NOT migrate PendingFieldValue / PendingFieldOption — run a separate data migration if needed.
*/

SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.PendingFieldDefinition', N'U') IS NULL
BEGIN
  RAISERROR('PendingFieldDefinition not found — nothing to migrate.', 16, 1);
  RETURN;
END

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NULL
BEGIN
  RAISERROR('FieldMetadata not found — run 003-field-metadata-schema.sql first.', 16, 1);
  RETURN;
END

BEGIN TRY
  BEGIN TRAN;

  ;WITH ranked AS (
    SELECT
      pfd.FieldDefinitionId,
      pfd.CompanyId,
      pfd.ViewType,
      pfd.FieldName,
      pfd.DisplayName,
      pfd.DataType,
      pfd.ScreenLocation,
      pfd.DisplayOrder,
      pfd.IsRequired,
      pfd.IsActive,
      ROW_NUMBER() OVER (
        PARTITION BY pfd.CompanyId, pfd.FieldName
        ORDER BY pfd.FieldDefinitionId
      ) AS rn
    FROM dbo.PendingFieldDefinition pfd
  ),
  normalized AS (
    SELECT
      FieldDefinitionId,
      CompanyId,
      ViewType,
      FieldName,
      DisplayName,
      DisplayOrder,
      IsRequired,
      IsActive,
      /* Map to FieldMetadata CK_FieldMetadata_DataType */
      DataType = CASE LOWER(LTRIM(RTRIM(DataType)))
        WHEN N'bit' THEN N'boolean'
        WHEN N'select' THEN N'dropdown'
        WHEN N'dropdown' THEN N'dropdown'
        WHEN N'date' THEN N'date'
        WHEN N'datetime' THEN N'date'
        WHEN N'datetime2' THEN N'date'
        WHEN N'int' THEN N'number'
        WHEN N'bigint' THEN N'number'
        WHEN N'decimal' THEN N'number'
        WHEN N'numeric' THEN N'number'
        WHEN N'float' THEN N'number'
        WHEN N'money' THEN N'currency'
        WHEN N'smallmoney' THEN N'currency'
        WHEN N'number' THEN N'number'
        WHEN N'textarea' THEN N'textarea'
        WHEN N'text' THEN N'text'
        WHEN N'nvarchar' THEN N'text'
        WHEN N'varchar' THEN N'text'
        ELSE N'text'
      END,
      ScreenLocation = CASE
        WHEN LOWER(LTRIM(RTRIM(ScreenLocation))) IN (N'grid', N'main') THEN N'Main'
        WHEN LOWER(LTRIM(RTRIM(ScreenLocation))) = N'detail' THEN N'Detail'
        WHEN LOWER(LTRIM(RTRIM(ScreenLocation))) = N'base' THEN N'Detail'
        ELSE N'Detail'
      END
    FROM ranked
    WHERE rn = 1
  )
  INSERT INTO dbo.FieldMetadata (
    CompanyId,
    FieldName,
    DisplayName,
    DataType,
    ScreenLocation,
    DisplayOrder,
    IsActive,
    IsRequired,
    IsEditable,
    IsSystemField,
    SourceType,
    SourceColumnName
  )
  SELECT
    n.CompanyId,
    n.FieldName,
    n.DisplayName,
    n.DataType,
    n.ScreenLocation,
    n.DisplayOrder,
    CAST(n.IsActive AS bit),
    CAST(n.IsRequired AS bit),
    1, /* IsEditable */
    0, /* IsSystemField — extension / legacy definition */
    N'Custom',
    NULL
  FROM normalized n
  WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.FieldMetadata fm
    WHERE fm.CompanyId = n.CompanyId
      AND fm.FieldName = n.FieldName
  );

  /* Map every ViewType row to payer applicability */
  IF OBJECT_ID(N'dbo.FieldMetadataPayerType', N'U') IS NOT NULL
  BEGIN
    INSERT INTO dbo.FieldMetadataPayerType (FieldMetadataId, PayerType)
    SELECT DISTINCT
      fm.FieldMetadataId,
      LTRIM(RTRIM(pfd.ViewType)) AS PayerType
    FROM dbo.PendingFieldDefinition pfd
    INNER JOIN dbo.FieldMetadata fm
      ON fm.CompanyId = pfd.CompanyId
      AND fm.FieldName = pfd.FieldName
    WHERE LTRIM(RTRIM(pfd.ViewType)) <> N''
      AND NOT EXISTS (
        SELECT 1
        FROM dbo.FieldMetadataPayerType pt
        WHERE pt.FieldMetadataId = fm.FieldMetadataId
          AND pt.PayerType = LTRIM(RTRIM(pfd.ViewType))
      );
  END

  COMMIT TRAN;

  PRINT N'Migration 005: PendingFieldDefinition merged into FieldMetadata + FieldMetadataPayerType.';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH
GO
