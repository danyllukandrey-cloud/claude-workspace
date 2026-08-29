-- life-area-card: revert restore transition + archived-list index
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_card_owner_archived;

ALTER TABLE card_lifecycle_event
    DROP CONSTRAINT IF EXISTS card_lifecycle_event_transition_check;

ALTER TABLE card_lifecycle_event
    ADD CONSTRAINT card_lifecycle_event_transition_check
        CHECK (transition IN ('created', 'filled', 'in_use', 'archived'));
