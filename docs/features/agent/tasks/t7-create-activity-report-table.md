---
id: T7
title: "Create activity_report table"
layer: "migration"
deps: ["T1"]
acs: ["AC-11"]
files_hint: ["docs/features/agent/migrations/07_create_activity_report.up.sql", "docs/features/agent/migrations/07_create_activity_report.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T7 — Create activity_report table

## Why

Тижневі/місячні/квартальні звіти активності — [`data-model.md` §activity_report](../data-model.md#activity_report), D-70.

## What

Промотувати staged-міграцію `07_create_activity_report`. `status` CHECK-enum (`generated`/`dead_letter`); унікальний індекс `(user_id, period_type, period_start)` — ідемпотентність формування.

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] Унікальний індекс перевірено тестом: повторна вставка того самого періоду відхиляється
- [ ] lint + vet clean

## Notes

Власність `agent-worker` (окремий C4-контейнер, ADR-0002) — та сама база, що й `backend-service`.
