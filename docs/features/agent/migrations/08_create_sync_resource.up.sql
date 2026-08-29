-- agent: create sync_resource (US-12, AC-18/AC-18b, D-89, 2026-08-29)
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

CREATE TABLE IF NOT EXISTS sync_resource (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'error')),
    last_synced_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_resource_user
    ON sync_resource (user_id);

CREATE INDEX IF NOT EXISTS idx_sync_resource_active
    ON sync_resource (status)
    WHERE status = 'active';
