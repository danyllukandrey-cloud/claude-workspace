-- agent: extend agent_audit_event.event_type/subject_type for account deletion
-- and resource-sync failure (US-11/US-12, AC-17/AC-18b, D-89, 2026-08-29)
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Must be promoted BEFORE the deleteAccount handler ever runs — account_deleted is written
-- before the app_user row is deleted (otherwise the audit row cascades away with it).

ALTER TABLE agent_audit_event
    DROP CONSTRAINT IF EXISTS agent_audit_event_event_type_check;

ALTER TABLE agent_audit_event
    ADD CONSTRAINT agent_audit_event_event_type_check
        CHECK (event_type IN (
            'proposal_created', 'proposal_updated', 'proposal_confirmed', 'proposal_dropped',
            'guard_passed', 'guard_failed',
            'memory_fact_edited', 'memory_fact_deleted',
            'account_deleted', 'resource_sync_failed'
        ));

ALTER TABLE agent_audit_event
    DROP CONSTRAINT IF EXISTS agent_audit_event_subject_type_check;

ALTER TABLE agent_audit_event
    ADD CONSTRAINT agent_audit_event_subject_type_check
        CHECK (subject_type IN ('proposal', 'guard', 'memory_fact', 'account', 'sync_resource'));
