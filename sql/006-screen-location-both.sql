/*
  Allow FieldMetadata.ScreenLocation = 'Both' so a field appears on the grid and detail drawer.
  Safe to run multiple times. Run against the same database as TRACKING_DB_CONNECTION_STRING.
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.FieldMetadata', N'U') IS NOT NULL
BEGIN
  IF EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_FieldMetadata_ScreenLocation'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
    ALTER TABLE dbo.FieldMetadata DROP CONSTRAINT CK_FieldMetadata_ScreenLocation;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_FieldMetadata_ScreenLocation'
      AND parent_object_id = OBJECT_ID(N'dbo.FieldMetadata')
  )
    ALTER TABLE dbo.FieldMetadata WITH NOCHECK
      ADD CONSTRAINT CK_FieldMetadata_ScreenLocation
      CHECK (ScreenLocation IN (N'Main', N'Detail', N'Both'));
END;
GO
