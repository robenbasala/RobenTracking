/*
  Conditional formatting rules v2
  - Stores formula expression in ConditionFormula.
  - Keeps ConditionJson for backward compatibility with old rules.
*/
IF OBJECT_ID(N'dbo.ConditionalFormattingRules', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.ConditionalFormattingRules (
    Id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    CompanyId INT NOT NULL,
    DatasetId NVARCHAR(64) NOT NULL,
    ReportKey NVARCHAR(200) NULL,
    TargetFieldKey NVARCHAR(200) NULL,
    ApplyTo NVARCHAR(20) NOT NULL, -- row | field
    BackgroundColor NVARCHAR(20) NOT NULL,
    TextColor NVARCHAR(20) NULL,
    ConditionFormula NVARCHAR(MAX) NULL,
    ConditionJson NVARCHAR(MAX) NULL,
    IsEnabled BIT NOT NULL DEFAULT (1),
    SortOrder INT NOT NULL DEFAULT (0),
    CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt DATETIME2 NULL
  );
END;

IF COL_LENGTH(N'dbo.ConditionalFormattingRules', N'ConditionFormula') IS NULL
BEGIN
  ALTER TABLE dbo.ConditionalFormattingRules
  ADD ConditionFormula NVARCHAR(MAX) NULL;
END;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = N'IX_ConditionalFormattingRules_DatasetReport'
    AND object_id = OBJECT_ID(N'dbo.ConditionalFormattingRules')
)
BEGIN
  CREATE INDEX IX_ConditionalFormattingRules_DatasetReport
  ON dbo.ConditionalFormattingRules (CompanyId, DatasetId, ReportKey, IsEnabled, SortOrder);
END;

