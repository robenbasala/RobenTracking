/*
  Report row filter for Pending Tracking grid / exports.

  Rules (ReportType = tab / view key from UI, normalized: lower, trim, spaces/dashes removed):
  - Income              -> PayerType = N'Income'
  - Managed Care        -> PayerType = N'Income' (same as Income per business rule)
  - Medicaid Pending    -> PayerName LIKE N'%Pending%'
  - Medicare            -> PayerType = N'Medicare'
  - Private             -> PayerType = N'Private'
  - Recerts             -> PayerType = N'Medicaid'
  - Other               -> PayerType = N'Other'
  Unknown keys fall back to legacy behavior: TrackingItemsTbl.ViewType equals report key (case-insensitive).

  Run against the same database as TRACKING_DB_CONNECTION_STRING.
*/

SET NOCOUNT ON;
GO

CREATE OR ALTER FUNCTION dbo.fn_PendingTracking_MatchesReport (
  @ReportKey NVARCHAR(120),
  @PayerType NVARCHAR(200),
  @PayerName NVARCHAR(500),
  @ItemViewType NVARCHAR(100)
)
RETURNS BIT
AS
BEGIN
  DECLARE @raw NVARCHAR(120) = LOWER(LTRIM(RTRIM(ISNULL(@ReportKey, N''))));
  IF @raw = N'' RETURN CAST(0 AS BIT);

  DECLARE @k NVARCHAR(120) = REPLACE(REPLACE(@raw, N' ', N''), N'-', N'');

  DECLARE @pt NVARCHAR(200) = LTRIM(RTRIM(ISNULL(@PayerType, N'')));
  DECLARE @pn NVARCHAR(500) = LTRIM(RTRIM(ISNULL(@PayerName, N'')));
  DECLARE @vt NVARCHAR(100) = LOWER(LTRIM(RTRIM(ISNULL(@ItemViewType, N''))));

  /* Income */
  IF @k = N'income'
    RETURN CASE WHEN @pt = N'Income' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;

  /* Managed Care -> Income (per spec) */
  IF @k = N'managedcare'
    RETURN CASE WHEN @pt = N'Income' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;

  /* Medicaid Pending: PayerName contains Pending */
  IF @k IN (N'pending', N'medicaidpending')
    RETURN CASE WHEN @pn LIKE N'%Pending%' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;

  /* Medicare */
  IF @k = N'medicare'
    RETURN CASE WHEN @pt = N'Medicare' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;

  /* Private */
  IF @k = N'private'
    RETURN CASE WHEN @pt = N'Private' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;

  /* Recerts -> Medicaid */
  IF @k IN (N'recerts', N'recertifications', N'recertification')
    RETURN CASE WHEN @pt = N'Medicaid' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;

  /* Other */
  IF @k = N'other'
    RETURN CASE WHEN @pt = N'Other' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END;

  /* Legacy: exact ViewType match */
  IF @vt = @raw OR @vt = @k
    RETURN CAST(1 AS BIT);

  RETURN CAST(0 AS BIT);
END
GO

/*
  TVF + stored procedure for the same report filter live in:
  sql/012-pending-tracking-report-eligible-items.sql
  Run that script after this one (required for API grid JOIN to dbo.fn_PendingTracking_ReportEligibleItems).
*/
PRINT N'010: fn_PendingTracking_MatchesReport created. Next: run sql/012-pending-tracking-report-eligible-items.sql';
