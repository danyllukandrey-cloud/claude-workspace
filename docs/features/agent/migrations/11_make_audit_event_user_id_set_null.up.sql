-- agent: agent_audit_event.user_id -- CASCADE to SET NULL (review-2026-09-12 finding)
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.
-- ON DELETE CASCADE silently destroyed the `account_deleted` row in the very same
-- transaction that wrote it (delete-account.ts writes audit-then-delete, but CASCADE
-- deletes it right back) -- the deletion trail (AC-17) was unachievable as designed.
-- Same fix already applied to developer_report.user_id for the identical reason
-- ("a bug report must outlive the account that triggered it" -- here, "a deletion
-- record must outlive the deletion it records").

ALTER TABLE agent_audit_event
    DROP CONSTRAINT IF EXISTS agent_audit_event_user_id_fkey;

ALTER TABLE agent_audit_event
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE agent_audit_event
    ADD CONSTRAINT agent_audit_event_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE SET NULL;
