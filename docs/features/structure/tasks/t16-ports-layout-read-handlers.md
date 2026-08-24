---
id: T16
title: "Ports: GET /structure/layout + /structure/layout/history handlers"
layer: "ports"
deps: ["T9", "T14"]
acs: ["AC-01", "AC-07"]
files_hint: ["plan/app/src/structure/ports/layout-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T16 — Ports: GET /structure/layout + /structure/layout/history handlers

## Why

[contracts/openapi.yaml](../contracts/openapi.yaml) `listLayoutPositions` / `getLayoutHistoryAsOf`.

## What

`GET /structure/layout` → T9, курсорна пагінація (`after`/`limit`). `GET /structure/layout/history?asOf=` → T14 (частина, що читає T10), валідує `asOf` — минула дата, ISO 8601.

## Definition of Done

- [ ] Handler-тест: список позицій обгорнутий у `LayoutPositionPage` точно за схемою контракту
- [ ] Handler-тест: `asOf` у майбутньому → 422 `structure.invalid_as_of`
- [ ] lint + vet clean

## Notes

Ці два ендпоінти лише читають — жодного побічного ефекту.
