-- structure: create structure (singleton per user)
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Target DB: main backend (D-59), same instance as life-area-card's migrations.

CREATE TABLE IF NOT EXISTS structure (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    -- FK to users(id) intentionally omitted: the users/auth table is owned by a future
    -- feature (D-33 Google login), not structure. Same situation as life-area-card.card.
    declaration TEXT NULL,
    layout_mode TEXT NULL
        CHECK (layout_mode IN ('single', 'free', 'logic')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_structure_owner ON structure (owner_user_id);
