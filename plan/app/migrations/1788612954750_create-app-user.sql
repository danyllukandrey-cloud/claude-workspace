-- Up Migration

-- agent: create app_user
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- First feature to own the users/auth table (D-33) — life-area-card and structure both
-- deferred this FK, expecting "ймовірно agent" to create it (see their data-model.md notes).
-- Adding the FK constraint in card.owner_user_id / structure.owner_user_id is those features'
-- own follow-up migration, not written here.

CREATE TABLE IF NOT EXISTS app_user (
    id UUID PRIMARY KEY,
    google_sub TEXT NOT NULL,
    email TEXT NOT NULL,
    display_name TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_google_sub ON app_user (google_sub);

-- Down Migration

-- agent: drop app_user
-- Staged migration — NOT live.

DROP INDEX IF EXISTS uq_app_user_google_sub;
DROP TABLE IF EXISTS app_user;
