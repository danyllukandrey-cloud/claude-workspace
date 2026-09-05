-- Up Migration

-- life-area-card: create entry
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

CREATE TABLE IF NOT EXISTS entry (
    id UUID PRIMARY KEY,
    metric_block_id UUID NOT NULL REFERENCES metric_block (id) ON DELETE CASCADE,
    card_id UUID NOT NULL REFERENCES card (id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    raw_text TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'rejected')),
    source_device_id TEXT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entry_metric_block ON entry (metric_block_id);
CREATE INDEX IF NOT EXISTS idx_entry_card_recorded ON entry (card_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_entry_card_pending ON entry (card_id, status) WHERE status = 'pending';

-- Down Migration

-- life-area-card: drop entry

DROP INDEX IF EXISTS idx_entry_card_pending;
DROP INDEX IF EXISTS idx_entry_card_recorded;
DROP INDEX IF EXISTS idx_entry_metric_block;
DROP TABLE IF EXISTS entry;
