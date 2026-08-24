---
id: T1
title: "Create structure table (backend DB)"
layer: "migration"
deps: []
acs: ["AC-03", "AC-09", "AC-10", "AC-11"]
files_hint: ["docs/features/structure/migrations/backend/01_create_structure.up.sql", "docs/features/structure/migrations/backend/01_create_structure.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T1 — Create structure table (backend DB)

## Why

Джерело правди для singleton Структури на користувача — [data-model.md](../data-model.md#structure), [ADR-0005](../../../adr/0005-backend-datastore.md).

## What

Промоутнути staged-міграцію 01 (уже написана, `docs/features/structure/migrations/backend/`) у живу `migrations/` бекенда з реальним номером послідовності (D-59, PostgreSQL). Жодних змін у SQL не потрібно — файли вже готові з `/sdd:data-model`.

## Definition of Done

- [ ] Міграція промоутнута в живу `migrations/`, застосовується (`up`) і відкочується (`down`) без помилок на локальній PostgreSQL
- [ ] `UNIQUE` на `owner_user_id` перевірено вручну (спроба вставити другий рядок з тим самим `owner_user_id` падає)
- [ ] lint + vet clean

## Notes

`owner_user_id` без DB-рівня FK навмисно (D-33, таблиці users ще нема) — не додавати FK самовільно.
