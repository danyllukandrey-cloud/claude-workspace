-- agent: drop long_term_memory_fact
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_long_term_memory_fact_user;
DROP INDEX IF EXISTS idx_long_term_memory_fact_user_topic;
DROP TABLE IF EXISTS long_term_memory_fact;
