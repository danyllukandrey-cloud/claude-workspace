-- structure: drop structure_layout_position
-- Staged migration — NOT live.

DROP INDEX IF EXISTS uq_layout_position_active_cell;
DROP INDEX IF EXISTS uq_layout_position_card;
DROP INDEX IF EXISTS idx_layout_position_card;
DROP INDEX IF EXISTS idx_layout_position_structure;
DROP TABLE IF EXISTS structure_layout_position;
