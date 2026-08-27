-- agent: drop agent_audit_event
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_agent_audit_event_subject;
DROP INDEX IF EXISTS idx_agent_audit_event_user_time;
DROP TABLE IF EXISTS agent_audit_event;
