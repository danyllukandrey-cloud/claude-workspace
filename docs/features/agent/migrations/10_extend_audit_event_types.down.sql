-- agent: revert agent_audit_event event_type/subject_type extension
-- Staged migration — NOT live.

ALTER TABLE agent_audit_event
    DROP CONSTRAINT IF EXISTS agent_audit_event_subject_type_check;

ALTER TABLE agent_audit_event
    ADD CONSTRAINT agent_audit_event_subject_type_check
        CHECK (subject_type IN ('proposal', 'guard', 'memory_fact'));

ALTER TABLE agent_audit_event
    DROP CONSTRAINT IF EXISTS agent_audit_event_event_type_check;

ALTER TABLE agent_audit_event
    ADD CONSTRAINT agent_audit_event_event_type_check
        CHECK (event_type IN (
            'proposal_created', 'proposal_updated', 'proposal_confirmed', 'proposal_dropped',
            'guard_passed', 'guard_failed',
            'memory_fact_edited', 'memory_fact_deleted'
        ));
