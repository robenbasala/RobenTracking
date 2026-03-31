/*
  Fix: Alter TrackingItemFieldValues.TrackingItemId to match PendingTrackingItem.TrackingItemId type (BIGINT)
  and properly add the foreign key constraint.

  This script:
  1. Drops dependent constraints and indexes
  2. Alters the TrackingItemId column to BIGINT
  3. Recreates the indexes and foreign key
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- Drop dependent objects
IF OBJECT_ID(N'dbo.TrackingItemFieldValues', N'U') IS NOT NULL
BEGIN
  -- Drop FK if it exists
  IF EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_TrackingItemFieldValues_TrackingItem'
      AND parent_object_id = OBJECT_ID(N'dbo.TrackingItemFieldValues')
  )
  BEGIN
    ALTER TABLE dbo.TrackingItemFieldValues DROP CONSTRAINT FK_TrackingItemFieldValues_TrackingItem;
    PRINT N'Dropped FK_TrackingItemFieldValues_TrackingItem.';
  END

  -- Drop unique constraint if it exists
  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'UQ_TrackingItemFieldValues_ItemField'
      AND object_id = OBJECT_ID(N'dbo.TrackingItemFieldValues')
  )
  BEGIN
    ALTER TABLE dbo.TrackingItemFieldValues DROP CONSTRAINT UQ_TrackingItemFieldValues_ItemField;
    PRINT N'Dropped UQ_TrackingItemFieldValues_ItemField.';
  END

  -- Drop nonclustered index if it exists
  IF EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = N'IX_TrackingItemFieldValues_Item'
      AND object_id = OBJECT_ID(N'dbo.TrackingItemFieldValues')
  )
  BEGIN
    DROP INDEX IX_TrackingItemFieldValues_Item ON dbo.TrackingItemFieldValues;
    PRINT N'Dropped IX_TrackingItemFieldValues_Item.';
  END

  -- Now alter the column if it's INT
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

  -- Recreate the unique constraint
  ALTER TABLE dbo.TrackingItemFieldValues
    ADD CONSTRAINT UQ_TrackingItemFieldValues_ItemField UNIQUE (TrackingItemId, FieldMetadataId);
  PRINT N'Recreated UQ_TrackingItemFieldValues_ItemField.';

  -- Recreate the nonclustered index
  CREATE NONCLUSTERED INDEX IX_TrackingItemFieldValues_Item
    ON dbo.TrackingItemFieldValues (TrackingItemId);
  PRINT N'Recreated IX_TrackingItemFieldValues_Item.';
END
GO

-- Now add the foreign key if it doesn't exist
IF OBJECT_ID(N'dbo.TrackingItemFieldValues', N'U') IS NOT NULL
  AND OBJECT_ID(N'dbo.PendingTrackingItem', N'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = N'FK_TrackingItemFieldValues_TrackingItem'
      AND parent_object_id = OBJECT_ID(N'dbo.TrackingItemFieldValues')
  )
  BEGIN
    ALTER TABLE dbo.TrackingItemFieldValues
      ADD CONSTRAINT FK_TrackingItemFieldValues_TrackingItem
      FOREIGN KEY (TrackingItemId) REFERENCES dbo.PendingTrackingItem (TrackingItemId) ON DELETE CASCADE;
    PRINT N'Added FK_TrackingItemFieldValues_TrackingItem.';
  END
END
GO

PRINT N'TrackingItemFieldValues schema migration complete.';
GO
