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
