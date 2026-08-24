-- structure: drop structure_history_event
-- Staged migration — NOT live. Target DB: history service store.

DROP INDEX IF EXISTS idx_history_structure_time;
DROP INDEX IF EXISTS idx_history_card_time;
DROP TABLE IF EXISTS structure_history_event;
