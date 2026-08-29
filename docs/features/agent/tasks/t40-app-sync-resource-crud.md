---
id: T40
title: "App: sync-resource CRUD use-cases"
layer: "app"
deps: ["T35", "T13"]
acs: ["AC-18"]
files_hint: ["plan/backend/src/agent/app/sync-resources.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T40 — App: sync-resource CRUD use-cases

## Why

[spec.md AC-18](../spec.md#5-acceptance-criteria).

## What

Додати/прочитати список/прибрати ресурс синхронізації для користувача.

## Definition of Done

- [ ] Integration test: додавання, читання списку, видалення ресурсу
- [ ] Integration test: некоректне посилання відхиляється до будь-якого запису
- [ ] lint + vet clean
