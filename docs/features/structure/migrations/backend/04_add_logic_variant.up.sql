-- structure: add logic_variant column (subvariant of the "за логікою" layout mode)
-- Closes the D-83 drift (ISS-7): three subvariants of layout_mode = 'logic' —
-- balance / focus / cause_effect — were decided 2026-08-29 but never reached the schema.
-- Staged migration — NOT live. Promoted (real sequence number assigned) by /sdd:implement.

ALTER TABLE structure
    ADD COLUMN logic_variant TEXT NULL
        CHECK (logic_variant IN ('balance', 'focus', 'cause_effect'));
