-- structure: revert the logic_variant column
-- Staged migration — NOT live.

ALTER TABLE structure
    DROP COLUMN IF EXISTS logic_variant;
