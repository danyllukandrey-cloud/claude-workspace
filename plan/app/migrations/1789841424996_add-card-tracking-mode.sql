-- Up Migration

-- life-area-card: CH-02 (docs/features/life-area-card/changes.md) --
-- "картка: стан без вимірювань" -- adds card.tracking_mode ('metrics' | 'state')
-- and card.health_state ('active' | 'critical' | 'paused', nullable -- only
-- meaningful when tracking_mode = 'state'). Mirrors 05_add_card_status.up.sql's
-- approach: constant DEFAULT means this is a fast metadata-only change on
-- Postgres 11+, no full table rewrite -- a single ALTER per column is safe
-- here, no expand/backfill/contract needed.
-- Staged migration — NOT live. Promoted (real sequence number assigned) by db:promote.

ALTER TABLE card
    ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'metrics'
        CHECK (tracking_mode IN ('metrics', 'state'));

ALTER TABLE card
    ADD COLUMN IF NOT EXISTS health_state TEXT
        CHECK (health_state IN ('active', 'critical', 'paused'));

-- Data-integrity guard: health_state must be non-NULL exactly when
-- tracking_mode = 'state', never the reverse combination.
ALTER TABLE card
    ADD CONSTRAINT card_health_state_requires_state_tracking
        CHECK (
            (tracking_mode = 'state' AND health_state IS NOT NULL)
            OR (tracking_mode = 'metrics' AND health_state IS NULL)
        );

-- Down Migration

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
