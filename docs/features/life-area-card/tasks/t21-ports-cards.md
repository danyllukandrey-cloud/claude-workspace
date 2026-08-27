---
id: T21
title: "Ports: cards handlers"
layer: "ports"
deps: ["T13", "T14", "T15", "T20"]
acs: ["AC-02", "AC-03", "AC-04", "AC-09", "AC-09b", "AC-10", "AC-16"]
files_hint: ["plan/app/src/cards/life-area-card/ports/card-handlers.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T21 — Ports: cards handlers

## Why

HTTP-хендлери картки — [`contracts/openapi.yaml` `/api/v1/cards*`](../contracts/openapi.yaml).

## What

`GET/POST /cards`, `GET/PATCH/DELETE /cards/{id}` → T13/T14/T15/T20. Помилки точно за контрактом: `422 card.name_required`, `422 card.description_required`, `404 card.not_found` (non-disclosure для чужих карток, AC-04).

## Definition of Done

- [ ] Handler-test: кожен код відповіді відтворює приклад із `contracts/openapi.yaml`
- [ ] Handler-test: `404` однаковий для «не існує» й «чуже»
- [ ] lint + vet clean
