---
id: T32
title: "Migration: create developer_report table"
layer: "migration"
deps: ["T1"]
acs: ["AC-20", "AC-20b"]
files_hint: ["docs/features/agent/migrations/09_create_developer_report.up.sql", "docs/features/agent/migrations/09_create_developer_report.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T32 — Migration: create developer_report table

## Why

Звіт про проблему розробнику — [D-89](../../../DECISIONS.md#d-89), Крок 3 опитувальника, 2026-08-29.

## What

Append-only лог надісланих поштою звітів про баги — агентом чи за проханням користувача. `user_id` — `ON DELETE SET NULL`, не `CASCADE`: звіт не повинен зникнути разом з акаунтом.

## Definition of Done

- [ ] Staged migration 09 promoted to live `migrations/`, applies and reverts cleanly
- [ ] lint + vet clean
