-- Up Migration

-- agent: create action_log (Лог дій -- заміна UI "Звіти активності", 2026-09-15)
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Проста, ДОДАТКОВА таблиця -- один рядок на кожну значущу дію користувача
-- (короткий людяний опис + час). Не чіпає activity_report (agent-worker
-- механізм періодичних звітів лишається як є, backend-only, D-70) -- окрема,
-- незалежна таблиця. Жодної категоризації/фільтрів у v1 (свідоме обмеження
-- обсягу, узгоджено з Андрієм) -- лише append-only хронологічний список.

CREATE TABLE IF NOT EXISTS action_log (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_log_owner_time
    ON action_log (owner_user_id, occurred_at DESC);

-- Down Migration

-- agent: revert action_log
-- Staged migration — NOT live.

DROP TABLE IF EXISTS action_log;
