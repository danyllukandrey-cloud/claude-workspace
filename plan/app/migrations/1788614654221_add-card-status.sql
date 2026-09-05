-- Up Migration

-- life-area-card: add card.status (soft archival, AC-16) + extend
-- card_lifecycle_event.transition to record the archived transition
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

-- Constant DEFAULT means this is a fast metadata-only change on Postgres 11+,
-- no full table rewrite — a single ALTER is safe here, no expand/backfill/contract needed.
ALTER TABLE card
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'archived'));

CREATE INDEX IF NOT EXISTS idx_card_owner_active
    ON card (owner_user_id)
    WHERE status = 'active';

-- CHECK constraints can't be ALTERed directly — drop the auto-named one
-- from migration 04 and recreate it with 'archived' added.
ALTER TABLE card_lifecycle_event
    DROP CONSTRAINT IF EXISTS card_lifecycle_event_transition_check;

ALTER TABLE card_lifecycle_event
    ADD CONSTRAINT card_lifecycle_event_transition_check
        CHECK (transition IN ('created', 'filled', 'in_use', 'archived'));

-- Down Migration

-- life-area-card: revert card.status + card_lifecycle_event.transition extension
-- Staged migration — NOT live.

ALTER TABLE card_lifecycle_event
    DROP CONSTRAINT IF EXISTS card_lifecycle_event_transition_check;

ALTER TABLE card_lifecycle_event
    ADD CONSTRAINT card_lifecycle_event_transition_check
        CHECK (transition IN ('created', 'filled', 'in_use'));

DROP INDEX IF EXISTS idx_card_owner_active;

ALTER TABLE card
    DROP COLUMN IF EXISTS status;
