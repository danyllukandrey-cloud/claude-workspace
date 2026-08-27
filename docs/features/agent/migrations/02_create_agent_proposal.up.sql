-- agent: create agent_proposal
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Promotion-order dependency: FKs below target card(id)/metric_block(id), owned by
-- life-area-card. /sdd:implement must promote life-area-card's migrations before agent's,
-- or these constraints fail on an empty base. Both FKs are nullable, so the reference
-- itself is optional at write time — the table still must exist at migration-apply time.

CREATE TABLE IF NOT EXISTS agent_proposal (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    card_id UUID NULL REFERENCES card (id) ON DELETE SET NULL,
    metric_block_id UUID NULL REFERENCES metric_block (id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'confirmed', 'dropped')),
    source_type TEXT NOT NULL
        CHECK (source_type IN ('text', 'attachment')),
    raw_input TEXT NOT NULL,
    proposed_amount NUMERIC NULL,
    proposed_summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Domain invariant (§4 SAD, AC-03): one active proposal per user. Enforced at DB level,
-- not just app logic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_proposal_active_user
    ON agent_proposal (user_id)
    WHERE status = 'active';

-- FK-covering indexes (partial index above only covers active rows, not the FK as a whole).
CREATE INDEX IF NOT EXISTS idx_agent_proposal_user ON agent_proposal (user_id);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_card ON agent_proposal (card_id);
CREATE INDEX IF NOT EXISTS idx_agent_proposal_metric_block ON agent_proposal (metric_block_id);
