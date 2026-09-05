-- Up Migration

-- life-area-card: create card
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

CREATE TABLE IF NOT EXISTS card (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL,
    -- FK to users(id) intentionally omitted: the users/auth table is owned by a future
    -- feature (D-33 Google login), not life-area-card. Add the FK constraint when that
    -- table exists (see data-model.md `card` entity note).
    name TEXT NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_owner ON card (owner_user_id);

-- Down Migration

-- life-area-card: drop card

DROP INDEX IF EXISTS idx_card_owner;
DROP TABLE IF EXISTS card;
