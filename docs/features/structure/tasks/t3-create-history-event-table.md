---
id: T3
title: "Create structure_history_event table (backend DB)"
layer: "migration"
deps: ["T1"]
acs: ["AC-15"]
files_hint: ["docs/features/structure/migrations/backend/05_create_structure_history_event.up.sql", "docs/features/structure/migrations/backend/05_create_structure_history_event.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T3 — Create structure_history_event table (backend DB)

## Why

Журнал подій Структури — [data-model.md](../data-model.md#structure_history_event), [D-113](../../../DECISIONS.md#d-113).

## What

Промоутнути staged-міграцію `backend/05_create_structure_history_event` (уже написана) у ту саму живу `migrations/` бекенда, куди вже промоутнуті T1/T2/T26/T27 — не окрему послідовність окремого сервісу (D-113). `structure_id`/`card_id` — реальні FK (`ON DELETE CASCADE`) на `structure.id`/`card.id`, та сама база (D-59).

## Definition of Done

- [ ] Staged migration `backend/05` промотована в живу `migrations/` (після T1/T27), застосовується (`up`) і відкочується (`down`) без помилок
- [ ] `structure_id`/`card_id` — реальні FK (`ON DELETE CASCADE`) на `structure.id`/`card.id`
- [ ] lint + vet clean

## Notes

`structure_id`/`card_id` тут — реальні DB FK (та сама база), той самий підхід, що вже використовує `structure_layout_position`.
