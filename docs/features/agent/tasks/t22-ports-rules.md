---
id: T22
title: "Ports: GET/POST /rules handlers"
layer: "ports"
deps: ["T9", "T13"]
acs: ["AC-07", "AC-08", "AC-12", "AC-14"]
files_hint: ["plan/backend/src/agent/ports/rules-handler.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T22 — Ports: GET/POST /rules handlers

## Why

Читання й збереження правил — [`contracts/openapi.yaml` `/api/v1/rules`](../contracts/openapi.yaml).

## What

`GET /rules` — cursor-пагіновано, фільтр `scopeCardId` (відсутній = лише глобальні). `POST /rules` → T9 conflict-check, помилки точно за контрактом: `409 agent.rule_conflict`, `422 agent.rule_empty`.

## Definition of Done

- [ ] Handler-test: фільтр `scopeCardId` розділяє глобальні й card-override правила
- [ ] Handler-test: `409`/`422` точно за прикладами контракту
- [ ] lint + vet clean

## Notes

Крос-польова умова «category або ruleText» перевіряється рантайм-валідацією (`422`), не JSON Schema — задокументовано в `api-sync-report.md` §Section B.
