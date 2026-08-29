-- agent: create developer_report (US-14, AC-20/AC-20b, D-89, 2026-08-29)
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- user_id is SET NULL, not CASCADE: a bug report must outlive the account that triggered it.

CREATE TABLE IF NOT EXISTS developer_report (
    id UUID PRIMARY KEY,
    user_id UUID NULL REFERENCES app_user (id) ON DELETE SET NULL,
    trigger_type TEXT NOT NULL
        CHECK (trigger_type IN ('agent_detected', 'user_requested')),
    description TEXT NOT NULL,
    delivery_status TEXT NOT NULL DEFAULT 'sent'
        CHECK (delivery_status IN ('sent', 'failed')),
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_developer_report_sent
    ON developer_report (sent_at DESC);
