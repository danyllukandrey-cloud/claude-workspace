-- agent: create chat_message
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

CREATE TABLE IF NOT EXISTS chat_message (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role TEXT NOT NULL
        CHECK (role IN ('user', 'agent')),
    content TEXT NOT NULL,
    session_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_message_user_session
    ON chat_message (user_id, session_date, created_at);
