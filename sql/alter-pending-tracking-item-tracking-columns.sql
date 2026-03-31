/*
  Align dbo.PendingTrackingItem with the column set from dbo.TrackingTblNew
  (your SELECT list), using the same data types as TrackingTblNew.

  - Adds any column that does not already exist (case-sensitive name check via sys.columns).
  - Does NOT drop ViewType or any other column.
  - Does NOT rename or remove legacy columns used by the app (e.g. FacilityName, PayerId).

  Review before running on production; backup the table first.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.PendingTrackingItem', N'U') IS NULL
BEGIN
  RAISERROR('Table dbo.PendingTrackingItem does not exist.', 16, 1);
  RETURN;
END;
GO

/* Helper: add column only if missing (exact column name). */
DECLARE @sql nvarchar(max);

-- [Facility] varchar(100)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'Facility'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [Facility] varchar(100) NULL;';
  EXEC sp_executesql @sql;
END;

-- [PayorGroup] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'PayorGroup'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [PayorGroup] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [Payor] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'Payor'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [Payor] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [ResidentName] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'ResidentName'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [ResidentName] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [payorid] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'payorid'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [payorid] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [CID] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'CID'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [CID] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [Balance] float
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'Balance'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [Balance] float NULL;';
  EXEC sp_executesql @sql;
END;

-- [PayerStart] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'PayerStart'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [PayerStart] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [PayerStop] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'PayerStop'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [PayerStop] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [AuthNo] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'AuthNo'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [AuthNo] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [EndofCareDate] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'EndofCareDate'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [EndofCareDate] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [DaysUsed] bigint
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'DaysUsed'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [DaysUsed] bigint NULL;';
  EXEC sp_executesql @sql;
END;

-- [MBI] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'MBI'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [MBI] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [firstmonth] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'firstmonth'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [firstmonth] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [lastpayment] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'lastpayment'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [lastpayment] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [lastpayment_amount] float
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'lastpayment_amount'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [lastpayment_amount] float NULL;';
  EXEC sp_executesql @sql;
END;

-- [HMOID] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'HMOID'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [HMOID] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [DQUALSTART] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'DQUALSTART'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [DQUALSTART] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [DQUALEND] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'DQUALEND'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [DQUALEND] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [EarliestAdmit] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'EarliestAdmit'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [EarliestAdmit] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [LatestAdmit] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'LatestAdmit'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [LatestAdmit] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [CPAYORRATE] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'CPAYORRATE'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [CPAYORRATE] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [CCOINSURER] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'CCOINSURER'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [CCOINSURER] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [DBIRTH] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'DBIRTH'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [DBIRTH] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [CSSN] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'CSSN'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [CSSN] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [CINCIDENTN] varchar(10)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'CINCIDENTN'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [CINCIDENTN] varchar(10) NULL;';
  EXEC sp_executesql @sql;
END;

-- [resstayID] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'resstayID'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [resstayID] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [censusdate] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'censusdate'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [censusdate] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [uniqueid] varchar(max)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'uniqueid'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [uniqueid] varchar(max) NULL;';
  EXEC sp_executesql @sql;
END;

-- [hundrethday] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'hundrethday'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [hundrethday] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [twentiethday] date
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'twentiethday'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [twentiethday] date NULL;';
  EXEC sp_executesql @sql;
END;

-- [paytype] varchar(10)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'paytype'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [paytype] varchar(10) NULL;';
  EXEC sp_executesql @sql;
END;

-- [facilitypk] varchar(100)
IF NOT EXISTS (
  SELECT 1 FROM sys.columns c
  INNER JOIN sys.tables t ON c.object_id = t.object_id
  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
  WHERE s.name = N'dbo' AND t.name = N'PendingTrackingItem' AND c.name = N'facilitypk'
)
BEGIN
  SET @sql = N'ALTER TABLE dbo.PendingTrackingItem ADD [facilitypk] varchar(100) NULL;';
  EXEC sp_executesql @sql;
END;

PRINT N'PendingTrackingItem: added any missing TrackingTblNew-style columns (ViewType unchanged).';
GO