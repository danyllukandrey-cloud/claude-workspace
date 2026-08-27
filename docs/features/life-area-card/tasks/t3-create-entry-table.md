---
id: T3
title: "Create entry table"
layer: "migration"
deps: ["T1", "T2"]
acs: ["AC-01", "AC-06", "AC-11", "AC-12"]
files_hint: ["docs/features/life-area-card/migrations/03_create_entry.up.sql", "docs/features/life-area-card/migrations/03_create_entry.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T3 — Create entry table

## Why

Запис події — [`data-model.md` §entry](../data-model.md#entry), ADR-0002 (`pending`/`confirmed`/`rejected`).

## What

Промотувати staged-міграцію `03_create_entry`. `status` CHECK-enum; `source_device_id` для виявлення конфлікту (AC-06).

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] Частковий індекс на `pending`-записи перевірено (AC-11 — пошук неперевірених при поверненні агента)
- [ ] lint + vet clean

## Notes

Ніколи фізичне видалення — виправлення/відкат (AC-12) позначає `rejected`, не `DELETE`.
