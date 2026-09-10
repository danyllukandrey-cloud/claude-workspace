-- Up Migration

-- life-area-card: extend card_lifecycle_event.transition to record the
-- restore/unarchive transition (AC-17) + index for the archived-list view (AC-18)
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

ALTER TABLE card_lifecycle_event
    DROP CONSTRAINT IF EXISTS card_lifecycle_event_transition_check;

ALTER TABLE card_lifecycle_event
    ADD CONSTRAINT card_lifecycle_event_transition_check
        CHECK (transition IN ('created', 'filled', 'in_use', 'archived', 'restored'));

CREATE INDEX IF NOT EXISTS idx_card_owner_archived
    ON card (owner_user_id)
    WHERE status = 'archived';

-- Down Migration

-- life-area-card: revert restore transition + archived-list index
-- Staged migration — NOT live.
--
-- DATA LOSS (T51, review 2026-09-07 group D): re-adding the narrower CHECK below
-- fails outright if any row already has transition='restored' -- same pattern as
-- 05_add_card_status's down-migration (card_lifecycle_event is append-only,
-- deleting is the only way to satisfy the narrower CHECK). Rolling back past this
-- migration on a database with real restore history permanently loses the audit
-- record of those restore events. Deliberate trade-off, not an oversight.

DROP INDEX IF EXISTS idx_card_owner_archived;

ALTER TABLE card_lifecycle_event
    DROP CONSTRAINT IF EXISTS card_lifecycle_event_transition_check;

-- Must run BEFORE the narrower CHECK below, or ADD CONSTRAINT itself fails
-- against any pre-existing 'restored' row (NOT IN, not a literal `= 'restored'`,
-- for the same defense-in-depth reason as 05_add_card_status's down-migration --
-- catches any value outside the narrower set, not only the one this file retires).
DELETE FROM card_lifecycle_event WHERE transition NOT IN ('created', 'filled', 'in_use', 'archived');

ALTER TABLE card_lifecycle_event
    ADD CONSTRAINT card_lifecycle_event_transition_check
        CHECK (transition IN ('created', 'filled', 'in_use', 'archived'));
