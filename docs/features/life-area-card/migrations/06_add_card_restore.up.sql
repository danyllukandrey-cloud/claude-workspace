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
