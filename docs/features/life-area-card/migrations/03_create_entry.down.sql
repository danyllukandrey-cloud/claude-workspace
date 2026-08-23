-- life-area-card: drop entry

DROP INDEX IF EXISTS idx_entry_card_pending;
DROP INDEX IF EXISTS idx_entry_card_recorded;
DROP INDEX IF EXISTS idx_entry_metric_block;
DROP TABLE IF EXISTS entry;
