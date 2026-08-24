---
id: T17
title: "Ports: PUT /structure/layout/{cardId} handler"
layer: "ports"
deps: ["T12"]
acs: ["AC-02", "AC-03", "AC-08"]
files_hint: ["plan/app/src/structure/ports/layout-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T17 — Ports: PUT /structure/layout/{cardId} handler

## Why

[contracts/openapi.yaml](../contracts/openapi.yaml) `moveCard`.

## What

Обробник, викликає T12, мапує результат на 200/404/409 точно за контрактом.

## Definition of Done

- [ ] Handler-тест: успішний рух → 200 з `LayoutPosition`
- [ ] Handler-тест: чужа/неіснуюча картка → 404 `structure.card_not_found` (той самий код для обох випадків, AC-03)
- [ ] Handler-тест: зайнята клітинка → 409 `structure.cell_occupied`
- [ ] lint + vet clean

## Notes

Жодного 403 — лише 404, щоб не підтверджувати існування чужої картки (AC-03).
