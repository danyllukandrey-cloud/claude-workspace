-- structure: create structure_layout_position
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Target DB: main backend (D-59). card_id is a real cross-feature FK — the `card`
-- table already exists in this same database (life-area-card's migration 01).

CREATE TABLE IF NOT EXISTS structure_layout_position (
    id UUID PRIMARY KEY,
    structure_id UUID NOT NULL REFERENCES structure (id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    cell_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed')),
    position_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_layout_position_structure
    ON structure_layout_position (structure_id);

CREATE INDEX IF NOT EXISTS idx_layout_position_card
    ON structure_layout_position (card_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_layout_position_card
    ON structure_layout_position (structure_id, card_id);

-- AC-02 / D-62 enforced at the DB level too, not only in the UI (Потік 4):
-- at most one ACTIVE card per cell within one structure.
CREATE UNIQUE INDEX IF NOT EXISTS uq_layout_position_active_cell
    ON structure_layout_position (structure_id, cell_index)
    WHERE status = 'active';
