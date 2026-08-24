-- structure: create structure_history_event
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Target DB: SEPARATE database/schema — the history service's own store (ADR-0004, D-67),
-- NOT the main backend. structure_id / card_id are logical references only — no DB-level
-- FK is possible across this database boundary; the app passes already-validated ids.

CREATE TABLE IF NOT EXISTS structure_history_event (
    id UUID PRIMARY KEY,
    structure_id UUID NOT NULL,
    card_id UUID NOT NULL,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('renamed', 'moved', 'closed')),
    detail TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_history_card_time
    ON structure_history_event (card_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_history_structure_time
    ON structure_history_event (structure_id, occurred_at);
