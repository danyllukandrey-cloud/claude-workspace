---
id: T41
title: "App (agent-worker): daily-sync use-case"
layer: "app"
deps: ["T35", "T38"]
acs: ["AC-18", "AC-18b"]
files_hint: ["plan/app/src/agent-worker/app/daily-sync.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T41 — App (agent-worker): daily-sync use-case

## Why

[spec.md AC-18/AC-18b](../spec.md#5-acceptance-criteria).

## What

Щоденний прохід `agent-worker`'а (ADR-0002, той самий патерн, що звіти активності): для кожного ресурсу, що потребує синхронізації (T35), пише туди свіжу копію карток/записів/декларацій користувача (T38). Збій — `status: error` + `last_error` на ресурсі, `resource_sync_failed` в аудит-лог; не мовчазний нескінченний retry.

## Definition of Done

- [ ] Integration test: кожен активний ресурс, що потребує синхронізації, отримує свіжу копію
- [ ] Integration test: збій запису позначає ресурс `error` і пише подію в аудит-лог
- [ ] lint + vet clean
