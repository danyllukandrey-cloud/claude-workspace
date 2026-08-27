---
id: T10
title: "Infra: Postgres repo"
layer: "infra"
deps: ["T2", "T3", "T4", "T5"]
acs: ["AC-01", "AC-04", "AC-09", "AC-13"]
files_hint: ["plan/app/src/cards/life-area-card/infra/postgres-repo.ts"]
owner: "TBD"
estimate: "L"
status: "todo"
---

# T10 — Infra: Postgres repo

## Why

Читання/запис карток, блоків-метрик, записів, журналу переходів — [`sad.md §5`](../sad.md#5-building-block-view).

## What

Репозиторій над 4 таблицями: `card`, `metric_block`, `entry`, `card_lifecycle_event`. Кожен запит скерований на `owner_user_id` (AC-04). Один запит на кожен зафіксований `data-model.md` індекс.

## Definition of Done

- [ ] Integration test: кожна з 4 таблиць — читання й запис через репо
- [ ] Integration test: запит із `owner_user_id` іншого користувача не повертає жодного рядка
- [ ] Integration test: усі індекси з `data-model.md §Indexes` справді використовуються (EXPLAIN)
- [ ] lint + vet clean

## Notes

`card_lifecycle_event` — лише запис (append-only), жодного `UPDATE`/`DELETE` в репо.
