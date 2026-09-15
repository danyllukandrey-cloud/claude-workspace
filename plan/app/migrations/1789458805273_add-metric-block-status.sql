-- Up Migration

-- life-area-card: add metric_block.status (soft archival of a single
-- metric-block, US-17/AC-20, D-127) -- mirrors 05_add_card_status.up.sql's
-- approach for card.status: same shape (TEXT NOT NULL DEFAULT 'active',
-- CHECK IN ('active','archived')), same "never physically delete" rule.
-- Staged migration — NOT live. Promoted (real sequence number assigned) by db:promote.

-- Constant DEFAULT means this is a fast metadata-only change on Postgres 11+,
-- no full table rewrite — a single ALTER is safe here, no expand/backfill/contract needed.
ALTER TABLE metric_block
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived'));

-- Down Migration

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
