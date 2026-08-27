-- agent: drop agent_proposal
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_agent_proposal_metric_block;
DROP INDEX IF EXISTS idx_agent_proposal_card;
DROP INDEX IF EXISTS idx_agent_proposal_user;
DROP INDEX IF EXISTS uq_agent_proposal_active_user;
DROP TABLE IF EXISTS agent_proposal;
