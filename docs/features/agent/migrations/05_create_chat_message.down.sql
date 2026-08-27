-- agent: drop chat_message
-- Staged migration — NOT live.

DROP INDEX IF EXISTS idx_chat_message_user_session;
DROP TABLE IF EXISTS chat_message;
