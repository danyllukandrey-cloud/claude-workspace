-- Up Migration

-- structure: create structure_history_event
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Target DB: main backend (D-24/D-59), same instance as structure's own tables (backend/01-04) and
-- life-area-card's card table. D-113 supersedes ADR-0004's original "separate service" choice —
-- structure_id/card_id are real cross-feature FKs now that everything lives in one database (the
-- same pattern structure_layout_position already uses, backend/02).

CREATE TABLE IF NOT EXISTS structure_history_event (
    id UUID PRIMARY KEY,
    structure_id UUID NOT NULL REFERENCES structure (id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('renamed', 'moved', 'closed')),
    detail TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_history_card_time
    ON structure_history_event (card_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_history_structure_time
    ON structure_history_event (structure_id, occurred_at);

-- Down Migration

-- structure: drop structure_history_event
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_history_structure_time;
DROP INDEX IF EXISTS idx_history_card_time;
DROP TABLE IF EXISTS structure_history_event;
