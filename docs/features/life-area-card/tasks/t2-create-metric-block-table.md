---
id: T2
title: "Create metric_block table"
layer: "migration"
deps: ["T1"]
acs: ["AC-05", "AC-07", "AC-08"]
files_hint: ["docs/features/life-area-card/migrations/02_create_metric_block.up.sql", "docs/features/life-area-card/migrations/02_create_metric_block.down.sql"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T2 — Create metric_block table

## Why

Блок-метрика — [`data-model.md` §metric_block](../data-model.md#metric_block).

## What

Промотувати staged-міграцію `02_create_metric_block`. `is_ongoing BOOLEAN DEFAULT false` (AC-05); `target_count`/`target_date` NULL-опційні.

## Definition of Done

- [x] Міграція застосовується й відкатується без помилок
- [x] FK на `card(id) ON DELETE CASCADE` перевірено
- [x] lint + vet clean

## Notes

Той самий крос-фічевий FK-порядок, що й T1: `agent`'s `agent_proposal.metric_block_id` вимагає цю таблицю промотованою раніше.
