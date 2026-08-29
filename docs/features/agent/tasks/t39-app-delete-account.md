---
id: T39
title: "App: deleteAccount use-case"
layer: "app"
deps: ["T34", "T13"]
acs: ["AC-17", "AC-17b"]
files_hint: ["plan/backend/src/agent/app/delete-account.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T39 — App: deleteAccount use-case

## Why

[spec.md AC-17/AC-17b](../spec.md#5-acceptance-criteria).

## What

Виконує план з T34: пише `account_deleted` в `agent_audit_event`, потім видаляє `app_user`. Каскад покриває власні 6 таблиць агента (FK CASCADE, наявні з початку) **плюс** `life-area-card.card` і `structure.structure` — FK CASCADE додано 2026-08-29 саме заради цього (`life-area-card/migrations/07_add_owner_fk`, `structure/migrations/backend/03_add_owner_fk`). Без прапорця підтвердження — відмова до будь-якого запису.

## Definition of Done

- [ ] Integration test: підтверджене видалення лишає 0 рядків для цього `user_id` у всіх 6 таблицях агента
- [ ] Integration test: без прапорця підтвердження — 401/403, нічого не записано
- [ ] lint + vet clean

## Notes

Потребує, щоб T33 (розширення `agent_audit_event`) і обидві крос-фічеві FK-міграції (`life-area-card` 07, `structure` 03) були промотовані раніше.
