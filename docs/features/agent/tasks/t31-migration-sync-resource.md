---
id: T31
title: "Migration: create sync_resource table"
layer: "migration"
deps: ["T1"]
acs: ["AC-18", "AC-18b"]
files_hint: ["docs/features/agent/migrations/08_create_sync_resource.up.sql", "docs/features/agent/migrations/08_create_sync_resource.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T31 — Migration: create sync_resource table

## Why

Синхронізація в зовнішній ресурс — [D-89](../../../DECISIONS.md#d-89), Крок 3 опитувальника, 2026-08-29.

## What

Список посилань користувача (Google Doc/Sheet тощо), куди `agent-worker` щодня пише копію даних. Той самий патерн, що `activity_report` (ADR-0002), інша періодичність.

## Definition of Done

- [ ] Staged migration 08 promoted to live `migrations/`, applies and reverts cleanly
- [ ] lint + vet clean
