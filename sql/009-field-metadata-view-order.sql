-- Create the FieldMetadataViewOrder table for per-ViewType display order overrides
-- This allows fields to be ordered differently in different payer program tabs

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF OBJECT_ID(N'dbo.FieldMetadataViewOrder', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.FieldMetadataViewOrder (
    FieldMetadataViewOrderId INT IDENTITY(1,1) NOT NULL,
    FieldMetadataId INT NOT NULL,
    ViewType NVARCHAR(100) NOT NULL,
    DisplayOrder INT NOT NULL,
    CONSTRAINT PK_FieldMetadataViewOrder PRIMARY KEY CLUSTERED (FieldMetadataViewOrderId),
    CONSTRAINT FK_FieldMetadataViewOrder_FieldMetadata
      FOREIGN KEY (FieldMetadataId) REFERENCES dbo.FieldMetadata (FieldMetadataId) ON DELETE CASCADE,
    CONSTRAINT UQ_FieldMetadataViewOrder UNIQUE (FieldMetadataId, ViewType)
  );
  CREATE NONCLUSTERED INDEX IX_FieldMetadataViewOrder_Field
    ON dbo.FieldMetadataViewOrder (FieldMetadataId);

  PRINT 'FieldMetadataViewOrder table created successfully.';
END
ELSE
BEGIN
  PRINT 'FieldMetadataViewOrder table already exists.';
END;
