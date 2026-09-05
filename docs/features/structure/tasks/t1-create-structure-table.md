---
id: T1
title: "Create structure table (backend DB)"
layer: "migration"
deps: []
acs: ["AC-03", "AC-09", "AC-10", "AC-11"]
files_hint: ["docs/features/structure/migrations/backend/01_create_structure.up.sql", "docs/features/structure/migrations/backend/01_create_structure.down.sql"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T1 — Create structure table (backend DB)

## Why

Джерело правди для singleton Структури на користувача — [data-model.md](../data-model.md#structure), [ADR-0005](../../../adr/0005-backend-datastore.md).

## What

Промоутнути staged-міграцію 01 (уже написана, `docs/features/structure/migrations/backend/`) у живу `migrations/` бекенда з реальним номером послідовності (D-59, PostgreSQL). Жодних змін у SQL не потрібно — файли вже готові з `/sdd:data-model`.

## Definition of Done

- [x] Міграція промоутнута в живу `migrations/`, застосовується (`up`) і відкочується (`down`) без помилок на локальній PostgreSQL
- [x] `UNIQUE` на `owner_user_id` перевірено вручну (спроба вставити другий рядок з тим самим `owner_user_id` падає)
- [x] lint + vet clean

## Notes

`owner_user_id` без DB-рівня FK навмисно (D-33, таблиці users ще нема) — не додавати FK самовільно.

**Промоучено позачергово 2026-09-05 ([D-103](../../../DECISIONS.md#d-103)), ДО того як `structure` як фіча стартувала в `/sdd:implement`** — не з власної черги хвиль `structure`, а тому що `life-area-card`'s T15 (archiveCard) потребував реальної таблиці `structure_layout_position` (яка залежить від цієї) для закриття [ISS-26](../../../ISSUES.md)/D-69. Проти реальної Neon: up → down 3 (разом із T2/T26) → up знову, тест на `UNIQUE (owner_user_id)` у `plan/app/migrations.integration.test.ts`. Решта задач `structure` (T3+) і далі `todo` — це не старт реалізації фічі, лише фундамент, потрібний іншій фічі.
