---
id: T35
title: "Ports: restoreCard + archived listCards handlers"
layer: "ports"
deps: ["T33", "T34"]
acs: ["AC-17", "AC-18"]
files_hint: ["plan/app/src/cards/life-area-card/ports/card-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T35 — Ports: restoreCard + archived listCards handlers

## Why

HTTP-шар для T33/T34 — [contracts/openapi.yaml `restoreCard`, `listCards`](../contracts/openapi.yaml).

## What

`POST /cards/{cardId}/restore` і `GET /cards?status=archived` — той самий файл, що вже містить `card-handlers.ts` (T21), нові методи, не новий файл.

## Definition of Done

- [ ] Handler-тест: `restore` повертає 200/404/409 точно за контрактом
- [ ] Handler-тест: `GET /cards?status=archived` повертає `CardPage` точно за контрактом
- [ ] lint + vet clean
