-- Up Migration

-- life-area-card: create card_lifecycle_event
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

CREATE TABLE IF NOT EXISTS card_lifecycle_event (
    id UUID PRIMARY KEY,
    card_id UUID NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    transition TEXT NOT NULL
        CHECK (transition IN ('created', 'filled', 'in_use')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_card_time ON card_lifecycle_event (card_id, occurred_at);

-- Down Migration

-- life-area-card: drop card_lifecycle_event

DROP INDEX IF EXISTS idx_lifecycle_card_time;
DROP TABLE IF EXISTS card_lifecycle_event;
