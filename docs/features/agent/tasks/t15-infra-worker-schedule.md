---
id: T15
title: "Infra (agent-worker): schedule + report persistence"
layer: "infra"
deps: ["T7", "T13"]
acs: ["AC-11"]
files_hint: ["plan/app/src/agent-worker/infra/schedule.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T15 — Infra (agent-worker): schedule + report persistence

## Why

Власний розклад worker, без окремої черги/брокера — [ADR-0002](../adr/0002-shared-database-plus-schedule-for-worker.md), [`sad.md §6` Flow 14](../sad.md#6-runtime-view).

## What

Розклад (тижневий/місячний/квартальний тригер), читання активності користувача за період і запис у `activity_report`. Ідемпотентність — перевірка унікального ключа перед записом; retry з backoff; після вичерпання спроб — `status: dead_letter`.

## Definition of Done

- [ ] Integration test: два запуски для того самого періоду пишуть рівно один рядок
- [ ] Integration test: провал запису після retry позначає рядок `dead_letter`, не втрачає дані
- [ ] lint + vet clean

## Notes

**Крос-фічеве читання (поза цим DAG):** «активність за період по кожній картці» означає читання `entry` з `life-area-card` — окремий репозиторій/клієнт, не частина T13 (яке покриває лише власні таблиці агента). Точний контракт цього читання — деталь реалізації, не вирішена жодним upstream-документом; позначити як TBD при написанні коду.
