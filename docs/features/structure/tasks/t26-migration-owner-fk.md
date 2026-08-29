---
id: T26
title: "Migration: add owner_user_id FK to app_user"
layer: "migration"
deps: ["T1"]
acs: []
files_hint: ["docs/features/structure/migrations/backend/03_add_owner_fk.up.sql", "docs/features/structure/migrations/backend/03_add_owner_fk.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T26 — Migration: add owner_user_id FK to app_user

## Why

Закриває TBD від 2026-08-24 — [data-model.md](../data-model.md) `structure.owner_user_id`. `agent`'s `app_user` (migration 01) тепер існує, тож FK можна додати. Вмикає каскадне видалення акаунта — `agent` AC-17, [D-89](../../../DECISIONS.md#d-89).

## What

`ALTER TABLE structure ADD CONSTRAINT ... FOREIGN KEY (owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE`.

## Definition of Done

- [ ] Staged migration `backend/03` promoted to live `migrations/`, applies and reverts cleanly
- [ ] lint + vet clean

## Notes

**Порядок промоції:** `agent` migration 01 (`app_user`) → цей migration. Черговість між фічами — відповідальність `implement`, не цього DAG.
