---
id: T20
title: "Ports: GET/POST /messages handlers"
layer: "ports"
deps: ["T16"]
acs: ["AC-01", "AC-02b", "AC-03", "AC-04", "AC-05", "AC-09", "AC-10", "AC-10b", "AC-15"]
files_hint: ["plan/app/src/agent/ports/chat-handler.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T20 — Ports: GET/POST /messages handlers

## Why

HTTP-хендлер чату — [`sad.md §5`](../sad.md#5-building-block-view) `ports/chat-handler.ts`, [`contracts/openapi.yaml` `/api/v1/messages`](../contracts/openapi.yaml).

## What

`GET /messages` — cursor-пагінована історія (T13). `POST /messages` — multipart (текст і/або вкладення) → T16, мапить результат у `MessageTurn` (`reply` + опційна `proposal`). Помилки точно за контрактом: `422 agent.attachment_unrecognized`, `429 agent.rate_limited` (§8 SAD, 60/год), `503 agent.llm_unavailable` (Flow 2).

## Definition of Done

- [ ] Handler-test: кожен код відповіді (`201`/`401`/`422`/`429`/`503`) відтворює приклад із `contracts/openapi.yaml`
- [ ] Handler-test: rate-limit рахується на користувача, не глобально
- [ ] lint + vet clean

## Notes

Байти вкладення транзитні (не зберігаються) — контракт і `data-model.md` вже це фіксують; хендлер лише передає файл у T16, не пише його в БД чи файлове сховище.
