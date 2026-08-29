-- structure: add the deferred FK on structure.owner_user_id -> app_user(id)
-- Closes the TBD noted in data-model.md since 2026-08-24 — `agent`'s migration 01
-- (create_app_user) now exists, so this FK can finally be added.
-- Enables cascading account deletion (agent AC-17, D-89, 2026-08-29): deleting
-- app_user now cascades into structure (and, via ON DELETE CASCADE, into
-- structure_layout_position) instead of needing a manual cross-feature purge.
-- Staged migration — NOT live. Promoted by /sdd:implement, AFTER agent's migration 01.

ALTER TABLE structure
    ADD CONSTRAINT fk_structure_owner_user
        FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE;
