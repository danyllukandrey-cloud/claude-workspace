-- agent: create activity_report
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Owned by the agent-worker container (ADR-0002) — same database, own schedule.

CREATE TABLE IF NOT EXISTS activity_report (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    period_type TEXT NOT NULL
        CHECK (period_type IN ('weekly', 'monthly', 'quarterly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'generated'
        CHECK (status IN ('generated', 'dead_letter')),
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency guard (AC-11, sad.md §6 Flow 14): worker checks this before generating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_activity_report_period
    ON activity_report (user_id, period_type, period_start);

CREATE INDEX IF NOT EXISTS idx_activity_report_user_time
    ON activity_report (user_id, generated_at DESC);
