---
id: T38
title: "Infra (agent-worker): external resource writer"
layer: "infra"
deps: []
acs: ["AC-18", "AC-18b"]
files_hint: ["plan/app/src/agent-worker/infra/resource-writer.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T38 — Infra (agent-worker): external resource writer

## Why

Запис копії даних у зовнішній ресурс — [spec.md AC-18](../spec.md#5-acceptance-criteria).

## What

Клієнт, що пише в ресурс за посиланням користувача (Google Doc/Sheet тощо — конкретний протокол/OAuth деталь реалізації). Ізольований шар, як T37/T12.

## Definition of Done

- [ ] Integration test проти заглушки: успішний запис оновлює `last_synced_at`
- [ ] Integration test проти заглушки: недоступний/відкликаний ресурс повертає типізовану помилку, не кидає необроблений виняток
- [ ] lint + vet clean
