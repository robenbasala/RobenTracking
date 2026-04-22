SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.ResidentAttachment', N'U') IS NULL
BEGIN
  RAISERROR('Table dbo.ResidentAttachment does not exist.', 16, 1);
  RETURN;
END
GO

IF COL_LENGTH('dbo.ResidentAttachment', 'UniqueId') IS NULL
BEGIN
  ALTER TABLE dbo.ResidentAttachment
    ADD UniqueId NVARCHAR(200) NULL;
  PRINT N'Added dbo.ResidentAttachment.UniqueId';
END
ELSE
  PRINT N'dbo.ResidentAttachment.UniqueId already exists';
GO

IF COL_LENGTH('dbo.ResidentAttachment', 'ResidentId') IS NULL
BEGIN
  ALTER TABLE dbo.ResidentAttachment
    ADD ResidentId NVARCHAR(200) NULL;
  PRINT N'Added dbo.ResidentAttachment.ResidentId';
END
ELSE
  PRINT N'dbo.ResidentAttachment.ResidentId already exists';
GO
