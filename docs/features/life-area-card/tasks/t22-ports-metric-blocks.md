---
id: T22
title: "Ports: metric-blocks handlers"
layer: "ports"
deps: ["T16", "T17"]
acs: ["AC-05", "AC-07", "AC-08", "AC-14", "AC-15"]
files_hint: ["plan/app/src/cards/life-area-card/ports/metric-block-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T22 — Ports: metric-blocks handlers

## Why

HTTP-хендлери блоків-метрик — [`contracts/openapi.yaml` `/api/v1/cards/{cardId}/metric-blocks*`](../contracts/openapi.yaml).

## What

`POST /cards/{id}/metric-blocks` → T16, `POST .../metric-blocks/transfer` → T17. Помилки: `404 card.not_found`, `409 metric_block.name_collision`.

## Definition of Done

- [ ] Handler-test: створення блоку відповідає контракту
- [ ] Handler-test: `409` на колізію назви при перенесенні, точно за прикладом
- [ ] lint + vet clean
