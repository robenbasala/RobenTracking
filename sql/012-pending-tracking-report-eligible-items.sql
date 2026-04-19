/*
  Pending Tracking — eligible rows (TVF) + report stored procedure.

  Prerequisite: run sql/010-pending-tracking-report-filter.sql first
  (creates dbo.fn_PendingTracking_MatchesReport).

  This script adds:
  - dbo.fn_PendingTracking_ReportEligibleItems — same filters as the API grid / export
    (company, optional facility CSV, status, search, active flag, report tab rules).
  - dbo.trk_PendingTracking_ReportSelectItemIds — returns only TrackingItemId (for INSERT…EXEC from the API).
  - dbo.trk_PendingTracking_ReportSelect — returns TrackingItemsTbl.* for matching rows.

  Run against the same database as TRACKING_DB_CONNECTION_STRING.
*/

SET NOCOUNT ON;
GO

/*
  Eligible TrackingItemId rows for a report tab (same rules as fn_PendingTracking_MatchesReport).
  Used by the app grid/export (JOIN) and by trk_PendingTracking_ReportSelect.
  @FacilityIdList: comma-separated FacilityId values; NULL or empty = all facilities.
*/
CREATE OR ALTER FUNCTION dbo.fn_PendingTracking_ReportEligibleItems (
  @ReportType NVARCHAR(120),
  @CompanyId INT,
  @FacilityIdList NVARCHAR(MAX),
  @Status NVARCHAR(100),
  @Search NVARCHAR(200),
  @IncludeInactive BIT
)
RETURNS TABLE
AS
RETURN (
  SELECT ti.TrackingItemId
  FROM dbo.TrackingItemsTbl ti
  WHERE (@IncludeInactive = 1 OR ISNULL(ti.IsActive, 1) = 1)
    AND ti.CompanyId = @CompanyId
    AND (
      @FacilityIdList IS NULL
      OR LTRIM(RTRIM(@FacilityIdList)) = N''
      OR EXISTS (
        SELECT 1
        FROM STRING_SPLIT(@FacilityIdList, N',') AS s
        WHERE LTRIM(RTRIM(s.value)) <> N''
          AND ti.FacilityId = LTRIM(RTRIM(s.value))
      )
    )
    AND (@Status IS NULL OR @Status = N'' OR ti.Status = @Status)
    AND (
      @Search IS NULL
      OR @Search = N''
      OR ti.ResidentName LIKE N'%' + @Search + N'%'
    )
    AND dbo.fn_PendingTracking_MatchesReport(
      @ReportType,
      ti.PayerType,
      ti.PayerName,
      ti.ViewType
    ) = 1
);
GO

/*
  Single-column result set for INSERT…EXEC — same filter as trk_PendingTracking_ReportSelect.
  The Node grid loads eligible ids via this procedure, then aggregates FieldMetadata in a second CTE.
*/
CREATE OR ALTER PROCEDURE dbo.trk_PendingTracking_ReportSelectItemIds
  @ReportType NVARCHAR(120),
  @CompanyId INT,
  @FacilityId NVARCHAR(50) = NULL,
  @FacilityIdList NVARCHAR(MAX) = NULL,
  @Status NVARCHAR(100) = NULL,
  @Search NVARCHAR(200) = NULL,
  @IncludeInactive BIT = 0
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @facList NVARCHAR(MAX) = NULLIF(LTRIM(RTRIM(@FacilityIdList)), N'');
  IF @facList IS NULL
    AND @FacilityId IS NOT NULL
    AND LTRIM(RTRIM(@FacilityId)) <> N''
    SET @facList = LTRIM(RTRIM(@FacilityId));

  SELECT ti.TrackingItemId
  FROM dbo.TrackingItemsTbl ti
  INNER JOIN dbo.fn_PendingTracking_ReportEligibleItems(
    @ReportType,
    @CompanyId,
    @facList,
    @Status,
    @Search,
    @IncludeInactive
  ) e ON e.TrackingItemId = ti.TrackingItemId
  ORDER BY ti.TrackingItemId;
END
GO

/*
  Full row set for a report (SSMS / integrations). Same filter as the app grid.
  @FacilityIdList: CSV of FacilityId; NULL = all. Legacy @FacilityId when list is empty.
*/
CREATE OR ALTER PROCEDURE dbo.trk_PendingTracking_ReportSelect
  @ReportType NVARCHAR(120),
  @CompanyId INT,
  @FacilityId NVARCHAR(50) = NULL,
  @FacilityIdList NVARCHAR(MAX) = NULL,
  @Status NVARCHAR(100) = NULL,
  @Search NVARCHAR(200) = NULL,
  @IncludeInactive BIT = 0
AS
BEGIN
  SET NOCOUNT ON;

  DECLARE @facList NVARCHAR(MAX) = NULLIF(LTRIM(RTRIM(@FacilityIdList)), N'');
  IF @facList IS NULL
    AND @FacilityId IS NOT NULL
    AND LTRIM(RTRIM(@FacilityId)) <> N''
    SET @facList = LTRIM(RTRIM(@FacilityId));

  SELECT ti.*
  FROM dbo.TrackingItemsTbl ti
  INNER JOIN dbo.fn_PendingTracking_ReportEligibleItems(
    @ReportType,
    @CompanyId,
    @facList,
    @Status,
    @Search,
    @IncludeInactive
  ) e ON e.TrackingItemId = ti.TrackingItemId
  ORDER BY ti.TrackingItemId;
END
GO

PRINT N'012: fn_PendingTracking_ReportEligibleItems + trk_PendingTracking_ReportSelectItemIds + trk_PendingTracking_ReportSelect created.';
