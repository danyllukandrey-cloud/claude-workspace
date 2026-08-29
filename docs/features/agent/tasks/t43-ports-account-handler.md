---
id: T43
title: "Ports: DELETE /account handler"
layer: "ports"
deps: ["T39"]
acs: ["AC-17", "AC-17b"]
files_hint: ["plan/backend/src/agent/ports/account-handler.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T43 — Ports: DELETE /account handler

## Why

HTTP-шар для T39 — [contracts/openapi.yaml `deleteAccount`](../contracts/openapi.yaml).

## Definition of Done

- [ ] Handler-тест: повертає 204/401 точно за контрактом
- [ ] lint + vet clean
