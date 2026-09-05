---
id: T4
title: "Create card_lifecycle_event table"
layer: "migration"
deps: ["T1"]
acs: []
files_hint: ["docs/features/life-area-card/migrations/04_create_card_lifecycle_event.up.sql", "docs/features/life-area-card/migrations/04_create_card_lifecycle_event.down.sql"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T4 — Create card_lifecycle_event table

## Why

Журнал переходів стану картки — [`data-model.md` §card_lifecycle_event](../data-model.md#card_lifecycle_event), design-review Блок 4.

## What

Промотувати staged-міграцію `04_create_card_lifecycle_event`. `transition` CHECK (`created`/`filled`/`in_use`/`archived`).

## Definition of Done

- [x] Міграція застосовується й відкатується без помилок
- [x] Індекс `(card_id, occurred_at)` перевірено
- [x] lint + vet clean

## Notes

Жодного `acs` — підтримує медіанний час переходу зі `spec.md §7` KPI, не окремий acceptance criterion.
