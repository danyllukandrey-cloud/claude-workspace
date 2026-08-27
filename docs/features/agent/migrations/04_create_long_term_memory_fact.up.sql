-- agent: create long_term_memory_fact
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

CREATE TABLE IF NOT EXISTS long_term_memory_fact (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    fact_text TEXT NOT NULL,
    topic TEXT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_long_term_memory_fact_user_topic
    ON long_term_memory_fact (user_id, topic)
    WHERE status = 'active';

-- FK-covering index (partial index above only covers active rows, not the FK as a whole).
CREATE INDEX IF NOT EXISTS idx_long_term_memory_fact_user
    ON long_term_memory_fact (user_id);
