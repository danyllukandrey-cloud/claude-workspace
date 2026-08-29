-- life-area-card: add the deferred FK on card.owner_user_id -> app_user(id)
-- Closes the TBD noted in data-model.md since 2026-08-23 — `agent`'s migration 01
-- (create_app_user) now exists, so this FK can finally be added.
-- Enables cascading account deletion (agent AC-17, D-89, 2026-08-29): deleting
-- app_user now cascades into card (and, via card's own ON DELETE CASCADE, into
-- metric_block/entry/card_lifecycle_event) instead of needing a manual cross-feature purge.
-- Staged migration — NOT live. Promoted by /sdd:implement, AFTER agent's migration 01.

ALTER TABLE card
    ADD CONSTRAINT fk_card_owner_user
        FOREIGN KEY (owner_user_id) REFERENCES app_user (id) ON DELETE CASCADE;
