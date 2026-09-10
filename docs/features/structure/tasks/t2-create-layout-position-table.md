---
id: T2
title: "Create structure_layout_position table (backend DB)"
layer: "migration"
deps: ["T1"]
acs: ["AC-02", "AC-08", "AC-12"]
files_hint: ["docs/features/structure/migrations/backend/02_create_structure_layout_position.up.sql", "docs/features/structure/migrations/backend/02_create_structure_layout_position.down.sql"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T2 — Create structure_layout_position table (backend DB)

## Why

Позиції карток у розкладці — [data-model.md](../data-model.md#structure_layout_position). Справжній cross-feature FK на `card(id)` з `life-area-card` (та сама база).

## What

Промоутнути staged-міграцію 02 в живу `migrations/`, після T1 (FK-залежність). Файли вже готові.

## Definition of Done

- [x] Міграція застосовується/відкочується чисто, ПІСЛЯ T1
- [x] Частковий унікальний індекс `(structure_id, cell_index) WHERE status='active'` підтверджений вручну — друга активна картка в ту саму клітинку падає (AC-02 на рівні БД)
- [x] lint + vet clean

## Notes

`card_id` FK ON DELETE CASCADE — очікує, що таблиця `card` (`life-area-card` міграція 01) вже жива в тій самій базі.

**Промоучено позачергово 2026-09-05 ([D-103](../../../DECISIONS.md#d-103))** — та сама причина, що й T1: закриває [ISS-26](../../../ISSUES.md) для `life-area-card`'s T15. Крім часткового унікального індексу, тестами проти реальної Neon підтверджено й FK ON DELETE CASCADE від `card` (видалення картки прибирає її позицію). Функція `closeActiveLayoutPositionForCard`, яку одразу отримав `structure/infra/postgres-repo.ts`, — навмисно мінімальний зріз, НЕ весь T9; T9 при своїй черзі розширить цей файл.
