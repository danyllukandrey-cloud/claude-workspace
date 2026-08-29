---
id: T33
title: "Migration: extend agent_audit_event event_type/subject_type"
layer: "migration"
deps: ["T6"]
acs: ["AC-17", "AC-18b"]
files_hint: ["docs/features/agent/migrations/10_extend_audit_event_types.up.sql", "docs/features/agent/migrations/10_extend_audit_event_types.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T33 — Migration: extend agent_audit_event event_type/subject_type

## Why

Аудит-слід для видалення акаунта й помилок синхронізації — [D-89](../../../DECISIONS.md#d-89), 2026-08-29.

## What

Додає `account_deleted`/`resource_sync_failed` до `event_type` CHECK і `account`/`sync_resource` до `subject_type` CHECK.

## Definition of Done

- [ ] Staged migration 10 promoted to live `migrations/`, applies and reverts cleanly
- [ ] lint + vet clean

## Notes

**Має промотуватись перед T39 (deleteAccount)** — інакше запис `account_deleted` не пройде CHECK.
