-- life-plan-levels: create plan_item
-- Staged migration -- NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- Target DB: main backend (D-59), same instance as life-area-card/structure/agent's migrations.

CREATE TABLE IF NOT EXISTS plan_item (
    id UUID PRIMARY KEY,
    owner_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    horizon TEXT NOT NULL
        CHECK (horizon IN ('tactical', 'operational', 'strategic')),
    plan_text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'removed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_item_owner_active
    ON plan_item (owner_user_id, horizon, created_at)
    WHERE status = 'active';
