---
id: T2
title: "Create structure_layout_position table (backend DB)"
layer: "migration"
deps: ["T1"]
acs: ["AC-02", "AC-08", "AC-12"]
files_hint: ["docs/features/structure/migrations/backend/02_create_structure_layout_position.up.sql", "docs/features/structure/migrations/backend/02_create_structure_layout_position.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T2 — Create structure_layout_position table (backend DB)

## Why

Позиції карток у розкладці — [data-model.md](../data-model.md#structure_layout_position). Справжній cross-feature FK на `card(id)` з `life-area-card` (та сама база).

## What

Промоутнути staged-міграцію 02 в живу `migrations/`, після T1 (FK-залежність). Файли вже готові.

## Definition of Done

- [ ] Міграція застосовується/відкочується чисто, ПІСЛЯ T1
- [ ] Частковий унікальний індекс `(structure_id, cell_index) WHERE status='active'` підтверджений вручну — друга активна картка в ту саму клітинку падає (AC-02 на рівні БД)
- [ ] lint + vet clean

## Notes

`card_id` FK ON DELETE CASCADE — очікує, що таблиця `card` (`life-area-card` міграція 01) вже жива в тій самій базі.
