---
id: T18
title: "Ports: POST /structure/layout/{cardId}/close handler"
layer: "ports"
deps: ["T13"]
acs: ["AC-03", "AC-12"]
files_hint: ["plan/app/src/structure/ports/layout-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T18 — Ports: POST /structure/layout/{cardId}/close handler

## Why

[contracts/openapi.yaml](../contracts/openapi.yaml) `closeCard`.

## What

Обробник, викликає T13, мапує результат на 200/404/422 точно за контрактом. `metricTransfers` — опційне тіло, дефолт — порожній масив.

## Definition of Done

- [ ] Handler-тест: закриття без тіла (без `metricTransfers`) працює
- [ ] Handler-тест: невалідна цільова картка → 422 `structure.metric_transfer_target_invalid`
- [ ] Handler-тест: чужа/неіснуюча `cardId` → 404 `structure.card_not_found`
- [ ] lint + vet clean
