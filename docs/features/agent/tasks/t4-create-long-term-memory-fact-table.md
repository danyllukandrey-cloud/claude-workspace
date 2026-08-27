---
id: T4
title: "Create long_term_memory_fact table"
layer: "migration"
deps: ["T1"]
acs: ["AC-09"]
files_hint: ["docs/features/agent/migrations/04_create_long_term_memory_fact.up.sql", "docs/features/agent/migrations/04_create_long_term_memory_fact.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T4 — Create long_term_memory_fact table

## Why

Довгострокова пам'ять агента — нова чутлива поверхня даних, security review Required — [`data-model.md` §long_term_memory_fact](../data-model.md#long_term_memory_fact).

## What

Промотувати staged-міграцію `04_create_long_term_memory_fact`. `status` CHECK-enum (`active`/`deleted`) — м'яке видалення, підтверджено з Андрієм 2026-08-27.

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] Частковий індекс `(user_id, topic) WHERE status = 'active'` перевірено — видалені факти не потрапляють у вибірку
- [ ] lint + vet clean

## Notes

Немає FK на `card`/`metric_block` — незалежна від крос-фічевого порядку промоції.
