---
id: T3
title: "Create structure_history_event table (history-service DB)"
layer: "migration"
deps: []
acs: ["AC-15"]
files_hint: ["docs/features/structure/migrations/history-service/01_create_structure_history_event.up.sql", "docs/features/structure/migrations/history-service/01_create_structure_history_event.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T3 — Create structure_history_event table (history-service DB)

## Why

Журнал подій Структури — [data-model.md §База 2](../data-model.md#база-2--сховище-літопису-структури-окрема-схемаінстанс-postgresql-adr-0004--d-67), [ADR-0004](../adr/0004-separate-service-for-structure-history-log.md).

## What

Промоутнути staged-міграцію в живу `migrations/` **окремого** сервісу літопису — фізично інша база/інстанс PostgreSQL (D-67), власна незалежна послідовність номерів, не пов'язана з T1/T2.

## Definition of Done

- [ ] Міграція застосовується/відкочується чисто в базі сервісу літопису
- [ ] lint + vet clean

## Notes

`structure_id`/`card_id` тут — **логічні** посилання, без DB FK (окрема фізична база). Незалежна від T1/T2, можна робити паралельно.
