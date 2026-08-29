-- structure: revert the owner_user_id -> app_user(id) FK
-- Staged migration — NOT live.

ALTER TABLE structure
    DROP CONSTRAINT IF EXISTS fk_structure_owner_user;
