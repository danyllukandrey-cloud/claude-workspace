---
id: T21
title: "Ports: proposal confirm handlers"
layer: "ports"
deps: ["T17"]
acs: ["AC-02", "AC-03"]
files_hint: ["plan/backend/src/agent/ports/proposal-handler.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T21 — Ports: GET /proposals/active + POST /proposals/{id}/confirm handlers

## Why

Відновлення стану екрана й явне підтвердження — [`contracts/openapi.yaml` `/api/v1/proposals*`](../contracts/openapi.yaml).

## What

`GET /proposals/active` — `{ proposal: Proposal | null }`. `POST /proposals/{id}/confirm` → T17, помилки точно за контрактом: `404 agent.proposal_not_found` (та сама відповідь на «не існує» і «чуже» — AC-06 non-disclosure), `409 agent.proposal_not_active`.

## Definition of Done

- [ ] Handler-test: `null` коли немає активної пропозиції
- [ ] Handler-test: `404`/`409` точно за прикладами контракту
- [ ] lint + vet clean

## Notes

`404` для чужої пропозиції — той самий підхід non-disclosure, що вже застосований у `structure`'s `card_not_found`.
