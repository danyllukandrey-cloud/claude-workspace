---
id: T6
title: "Create agent_audit_event table"
layer: "migration"
deps: ["T1"]
acs: []
files_hint: ["docs/features/agent/migrations/06_create_agent_audit_event.up.sql", "docs/features/agent/migrations/06_create_agent_audit_event.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T6 — Create agent_audit_event table

## Why

Аудит-лог агента — обґрунтований чутливою поверхнею даних (security review Required), не покриттям конкретного AC — [`sad.md §8` Events](../sad.md#8-crosscutting-concepts), [`data-model.md` §agent_audit_event](../data-model.md#agent_audit_event).

## What

Промотувати staged-міграцію `06_create_agent_audit_event`. `event_type`/`subject_type` CHECK-enum; `subject_id` — поліморфне посилання без DB-рівня FK (навмисно, документовано).

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] Індекс `(user_id, occurred_at DESC)` перевірено на хронологічній вибірці
- [ ] lint + vet clean

## Notes

Жодного `acs` — ця таблиця підтримує QG-1-перевірку (`sad.md §10`: «аудит-лог перевіряється на відсутність запису без відповідної події підтвердження»), не окремий acceptance criterion.
