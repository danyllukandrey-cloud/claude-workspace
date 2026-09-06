---
id: T23
title: "Ports: entries handlers"
layer: "ports"
deps: ["T18", "T19"]
acs: ["AC-01", "AC-06", "AC-11", "AC-12", "AC-13"]
files_hint: ["plan/app/src/cards/life-area-card/ports/entry-handlers.ts"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T23 — Ports: entries handlers

## Why

HTTP-хендлери записів і історії — [`contracts/openapi.yaml` `/api/v1/.../entries*`](../contracts/openapi.yaml).

## What

`POST .../entries` → T18, `PATCH /entries/{id}` → T19, `GET /cards/{id}/entries` → T10 (історія, cursor-пагінована, найновіші зверху, AC-13).

## Definition of Done

- [x] Handler-test: створення запису відповідає контракту (`confirmed`/`pending`)
- [x] Handler-test: `PATCH` вирішує конфлікт/виправляє за контрактом
- [x] Handler-test: історія повертається найновішими зверху
- [x] lint + vet clean
