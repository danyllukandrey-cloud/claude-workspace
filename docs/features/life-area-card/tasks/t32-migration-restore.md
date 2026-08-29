---
id: T32
title: "Migration: restore transition + archived-cards index"
layer: "migration"
deps: ["T5"]
acs: ["AC-17", "AC-18"]
files_hint: ["docs/features/life-area-card/migrations/06_add_card_restore.up.sql", "docs/features/life-area-card/migrations/06_add_card_restore.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T32 — Migration: restore transition + archived-cards index

## Why

Розархівація (AC-17) і перегляд архіву (AC-18) — [Крок 3 опитувальника, 2026-08-29, D-89](../../../DECISIONS.md#d-89).

## What

Розширює `card_lifecycle_event.transition` CHECK значенням `restored`, додає частковий індекс на `owner_user_id` де `status = 'archived'` для швидкого списку архіву.

## Definition of Done

- [ ] Staged migration 06 promoted to live `migrations/`, applies and reverts cleanly
- [ ] lint + vet clean

## Notes

Дзеркало migration 05 (`add_card_status`) — той самий підхід, ALTER + CHECK-заміна.
