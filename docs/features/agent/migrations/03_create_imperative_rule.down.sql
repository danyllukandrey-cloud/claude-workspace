-- agent: drop imperative_rule
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_imperative_rule_scope_card;
DROP INDEX IF EXISTS idx_imperative_rule_user_scope;
DROP TABLE IF EXISTS imperative_rule;
