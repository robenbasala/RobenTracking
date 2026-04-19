/*
  Calculated fields — FieldKind + FormulaDefinitionJson on dbo.FieldMetadata.

  The Node API also applies this migration on connect via ensure-field-metadata-schema.ts.
  Run manually if you manage schema only with SQL scripts.

  Execute against the same database as TRACKING_DB_CONNECTION_STRING.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'FieldKind'
  )
BEGIN
  ALTER TABLE dbo.FieldMetadata ADD FieldKind NVARCHAR(20) NOT NULL
    CONSTRAINT DF_FieldMetadata_FieldKind_Mig DEFAULT (N'regular');
END
GO

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.FieldMetadata') AND name = N'FormulaDefinitionJson'
  )
BEGIN
  ALTER TABLE dbo.FieldMetadata ADD FormulaDefinitionJson NVARCHAR(MAX) NULL;
END
GO

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_FieldMetadata_FieldKind'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
BEGIN
  ALTER TABLE dbo.FieldMetadata WITH NOCHECK
    ADD CONSTRAINT CK_FieldMetadata_FieldKind
    CHECK (FieldKind IN (N'regular', N'calculated'));
END
GO

PRINT N'FieldMetadata calculated-field columns ensured.';
GO
