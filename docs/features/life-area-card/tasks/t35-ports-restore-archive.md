---
id: T35
title: "Ports: restoreCard + archived listCards handlers"
layer: "ports"
deps: ["T33", "T34", "T21"]
acs: ["AC-17", "AC-18"]
files_hint: ["plan/app/src/cards/life-area-card/ports/card-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T35 — Ports: restoreCard + archived listCards handlers

## Why

HTTP-шар для T33/T34 — [contracts/openapi.yaml `restoreCard`, `listCards`](../contracts/openapi.yaml).

## What

`POST /cards/{cardId}/restore` і `GET /cards?status=archived` — той самий файл, що вже містить `card-handlers.ts` (T21), нові методи, не новий файл.

## Definition of Done

- [x] Handler-тест: `restore` повертає 200/404/409 точно за контрактом
- [x] Handler-тест: `GET /cards?status=archived` повертає `CardPage` точно за контрактом
- [x] lint + vet clean

## Notes

`deps` доповнено `T21` (ISS-38, 2026-09-06) — file-level залежність, не була видна в tracker.md до хвилі 6: обидві задачі пишуть у той самий `card-handlers.ts`. `GET /cards?status=archived` (AC-18) виявився вже реалізованим і протестованим у T21 (той самий `listCards`, параметр `status`) — тут додано лише `restoreCard` (AC-17).
