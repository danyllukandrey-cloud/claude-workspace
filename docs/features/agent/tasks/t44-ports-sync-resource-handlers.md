---
id: T44
title: "Ports: GET/POST/DELETE /sync-resources handlers"
layer: "ports"
deps: ["T40"]
acs: ["AC-18"]
files_hint: ["plan/app/src/agent/ports/sync-resource-handler.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T44 — Ports: GET/POST/DELETE /sync-resources handlers

## Why

HTTP-шар для T40 — [contracts/openapi.yaml `listSyncResources`/`createSyncResource`/`deleteSyncResource`](../contracts/openapi.yaml).

## Definition of Done

- [ ] Handler-тест: 200/201/204/404/422 точно за контрактом (`sync_resource.url_invalid` на 422)
- [ ] lint + vet clean
