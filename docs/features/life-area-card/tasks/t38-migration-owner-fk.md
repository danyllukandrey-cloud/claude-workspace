---
id: T38
title: "Migration: add owner_user_id FK to app_user"
layer: "migration"
deps: ["T1"]
acs: []
files_hint: ["docs/features/life-area-card/migrations/07_add_owner_fk.up.sql", "docs/features/life-area-card/migrations/07_add_owner_fk.down.sql"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T38 — Migration: add owner_user_id FK to app_user

## Why

Закриває TBD від 2026-08-23 — [data-model.md](../data-model.md) `card.owner_user_id`. `agent`'s `app_user` (migration 01) тепер існує, тож FK можна додати. Вмикає каскадне видалення акаунта — `agent` AC-17, [D-89](../../../DECISIONS.md#d-89).

## What

`ALTER TABLE card ADD CONSTRAINT ... FOREIGN KEY (owner_user_id) REFERENCES app_user(id) ON DELETE CASCADE`.

## Definition of Done

- [x] Staged migration 07 promoted to live `migrations/`, applies and reverts cleanly
- [x] lint + vet clean

## Notes

**Порядок промоції:** `agent` migration 01 (`app_user`) → це migration 07. Не тіє прив'язки до цієї фічі — сам DAG тут не бачить `agent`, тому черговість — відповідальність `implement` між фічами, не між задачами.
