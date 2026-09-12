-- agent: revert agent_audit_event.user_id to NOT NULL + ON DELETE CASCADE
-- Staged migration — NOT live.

ALTER TABLE agent_audit_event
    DROP CONSTRAINT IF EXISTS agent_audit_event_user_id_fkey;

ALTER TABLE agent_audit_event
    ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE agent_audit_event
    ADD CONSTRAINT agent_audit_event_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE;
