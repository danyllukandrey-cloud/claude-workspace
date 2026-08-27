-- agent: drop activity_report
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_activity_report_user_time;
DROP INDEX IF EXISTS uq_activity_report_period;
DROP TABLE IF EXISTS activity_report;
