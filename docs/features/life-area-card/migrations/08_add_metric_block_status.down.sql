-- life-area-card: revert metric_block.status (D-127)
-- Staged migration — NOT live.
--
-- No data-loss guard needed here, unlike 05_add_card_status.down.sql /
-- 06_add_card_restore.down.sql: those narrow a CHECK on the append-only
-- card_lifecycle_event log (existing rows can violate a narrower set).
-- This migration only drops metric_block.status itself -- the column being
-- removed IS the data, so there is nothing left over to violate a
-- re-narrowed constraint elsewhere.

ALTER TABLE metric_block
    DROP COLUMN IF EXISTS status;
