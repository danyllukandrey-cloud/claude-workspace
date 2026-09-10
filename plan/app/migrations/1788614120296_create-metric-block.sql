-- Up Migration

-- life-area-card: create metric_block
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

CREATE TABLE IF NOT EXISTS metric_block (
    id UUID PRIMARY KEY,
    card_id UUID NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    unit TEXT NOT NULL,
    frequency TEXT NULL,
    target_count NUMERIC NULL,
    is_ongoing BOOLEAN NOT NULL DEFAULT false,
    target_date DATE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metric_block_card ON metric_block (card_id);

-- Down Migration

-- life-area-card: drop metric_block

DROP INDEX IF EXISTS idx_metric_block_card;
DROP TABLE IF EXISTS metric_block;
