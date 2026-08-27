---
id: T13
title: "Infra: Postgres repo (proposal, rules, memory, chat, audit)"
layer: "infra"
deps: ["T2", "T3", "T4", "T5", "T6"]
acs: ["AC-01", "AC-02", "AC-07", "AC-08", "AC-09", "AC-12", "AC-14", "AC-15"]
files_hint: ["plan/backend/src/agent/infra/postgres-repo.ts"]
owner: "TBD"
estimate: "L"
status: "todo"
---

# T13 — Infra: Postgres repo (proposal, rules, memory, chat, audit)

## Why

Читання/запис карток, правил, пам'яті — [`sad.md §5`](../sad.md#5-building-block-view) `infra/postgres-repo.ts`.

## What

Репозиторій над 5 таблицями backend-service (`agent_proposal`, `imperative_rule`, `long_term_memory_fact`, `chat_message`, `agent_audit_event`) — усі запити скеровані на `user_id` (AC-06). Один запис на кожен зафіксований `data-model.md` індекс (не «про запас»).

## Definition of Done

- [ ] Integration test: кожна з 5 таблиць — читання й запис через репо
- [ ] Integration test: запит із `user_id` іншого користувача не повертає жодного рядка
- [ ] Integration test: усі індекси з `data-model.md §Indexes` справді використовуються (EXPLAIN на типовому запиті)
- [ ] lint + vet clean

## Notes

`agent_audit_event` — лише запис (append-only), жодного `UPDATE`/`DELETE` в репо для цієї таблиці.
