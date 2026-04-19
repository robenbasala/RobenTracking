-- 008: Add IsHotCase column to TrackingItemsTbl
-- Allows cases to be flagged as hot cases with a visual indicator

IF NOT EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME = 'TrackingItemsTbl'
    AND COLUMN_NAME = 'IsHotCase'
)
BEGIN
  ALTER TABLE dbo.TrackingItemsTbl
    ADD IsHotCase BIT NOT NULL DEFAULT 0;

  -- Backfill: flag existing hot cases based on balance or status
  UPDATE dbo.TrackingItemsTbl
  SET IsHotCase = 1
  WHERE ISNULL(Balance, 0) >= 5000
     OR UPPER(ISNULL(Status, '')) LIKE '%HOT%';
END
GO
