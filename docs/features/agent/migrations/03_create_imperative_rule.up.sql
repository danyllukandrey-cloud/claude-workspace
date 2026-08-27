-- agent: create imperative_rule
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Promotion-order dependency: scope_card_id FK targets card(id), owned by life-area-card —
-- same note as 02_create_agent_proposal.

CREATE TABLE IF NOT EXISTS imperative_rule (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    scope_card_id UUID NULL REFERENCES card (id) ON DELETE SET NULL,
    category TEXT NULL
        CHECK (category IN ('data', 'correction', 'survey', 'context_clarification', 'owner_impact', 'reminder')),
    rule_text TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (category IS NOT NULL OR rule_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_imperative_rule_user_scope
    ON imperative_rule (user_id, scope_card_id);

-- FK-covering index for scope_card_id (mostly NULL — global rules; partial index skips those).
CREATE INDEX IF NOT EXISTS idx_imperative_rule_scope_card
    ON imperative_rule (scope_card_id)
    WHERE scope_card_id IS NOT NULL;
