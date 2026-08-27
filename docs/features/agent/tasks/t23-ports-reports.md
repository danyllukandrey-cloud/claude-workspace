---
id: T23
title: "Ports: GET /reports handler"
layer: "ports"
deps: ["T13"]
acs: ["AC-11"]
files_hint: ["plan/backend/src/agent/ports/reports-handler.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T23 — Ports: GET /reports handler

## Why

Лише читання вже сформованих звітів — [`contracts/openapi.yaml` `/api/v1/reports`](../contracts/openapi.yaml).

## What

Cursor-пагінований список, фільтр `periodType`. Жодного тригера формування тут — worker (T15/T19) формує звіти незалежно.

## Definition of Done

- [ ] Handler-test: `ReportPage` за контрактом, включно з `status: dead_letter` у видимому полі
- [ ] Handler-test: фільтр `periodType` звужує вибірку
- [ ] lint + vet clean

## Notes

Немає `POST`-операції за задумом (spec.md AC-11: генерує worker, не користувач).
