---
id: T5
title: "Add card.status column (soft archival)"
layer: "migration"
deps: ["T1", "T4"]
acs: ["AC-16"]
files_hint: ["docs/features/life-area-card/migrations/05_add_card_status.up.sql", "docs/features/life-area-card/migrations/05_add_card_status.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T5 — Add card.status column (soft archival)

## Why

М'яка архівація картки (AC-16) — [`data-model.md` §card](../data-model.md#card).

## What

Промотувати staged-міграцію `05_add_card_status`. `status TEXT NOT NULL DEFAULT 'active' CHECK IN ('active','archived')`; розширює CHECK на `card_lifecycle_event.transition` (додає `archived`).

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] Частковий індекс `WHERE status = 'active'` перевірено — архівовані картки не потрапляють у список активних
- [ ] lint + vet clean

## Notes

Швидка metadata-only зміна (constant DEFAULT, Postgres 11+) — без expand/backfill/contract.
