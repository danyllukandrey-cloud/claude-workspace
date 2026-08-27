-- agent: drop app_user
-- Staged migration — NOT live.

DROP INDEX IF EXISTS uq_app_user_google_sub;
DROP TABLE IF EXISTS app_user;
