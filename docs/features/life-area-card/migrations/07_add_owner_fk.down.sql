-- life-area-card: revert the owner_user_id -> app_user(id) FK
-- Staged migration — NOT live.

ALTER TABLE card
    DROP CONSTRAINT IF EXISTS fk_card_owner_user;
