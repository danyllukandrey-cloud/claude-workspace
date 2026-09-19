-- life-area-card: revert card.tracking_mode / card.health_state (CH-02)
-- Staged migration — NOT live.
--
-- No data-loss guard needed here, unlike 05_add_card_status.down.sql /
-- 06_add_card_restore.down.sql: those narrow a CHECK on the append-only
-- card_lifecycle_event log (existing rows can violate a narrower set).
-- These two columns being removed ARE the data, so there is nothing left
-- over to violate a re-narrowed constraint elsewhere.

ALTER TABLE card
    DROP CONSTRAINT IF EXISTS card_health_state_requires_state_tracking;

ALTER TABLE card
    DROP COLUMN IF EXISTS health_state;

ALTER TABLE card
    DROP COLUMN IF EXISTS tracking_mode;
