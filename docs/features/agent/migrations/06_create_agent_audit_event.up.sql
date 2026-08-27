-- agent: create agent_audit_event
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- subject_id is a polymorphic reference (agent_proposal.id or long_term_memory_fact.id) —
-- no DB-level FK by design, integrity checked in the app layer (see data-model.md TBD note).

CREATE TABLE IF NOT EXISTS agent_audit_event (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    event_type TEXT NOT NULL
        CHECK (event_type IN (
            'proposal_created', 'proposal_updated', 'proposal_confirmed', 'proposal_dropped',
            'guard_passed', 'guard_failed',
            'memory_fact_edited', 'memory_fact_deleted'
        )),
    subject_type TEXT NOT NULL
        CHECK (subject_type IN ('proposal', 'guard', 'memory_fact')),
    subject_id UUID NULL,
    detail TEXT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_event_user_time
    ON agent_audit_event (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_audit_event_subject
    ON agent_audit_event (subject_type, subject_id);
