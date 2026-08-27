---
id: T1
title: "Create card table"
layer: "migration"
deps: []
acs: ["AC-02", "AC-04", "AC-16"]
files_hint: ["docs/features/life-area-card/migrations/01_create_card.up.sql", "docs/features/life-area-card/migrations/01_create_card.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T1 — Create card table

## Why

Основна сутність — [`data-model.md` §card](../data-model.md#card).

## What

Промотувати staged-міграцію `01_create_card`. `owner_user_id NOT NULL`, без DB-рівня FK навмисно (таблиця `app_user` належить `agent`); `status` CHECK (`active`/`archived`) з міграції 05.

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] `NOT NULL` на `name` перевірено тестом
- [ ] lint + vet clean

## Notes

**Крос-фічева залежність (нове для проєкту):** `agent`'s `agent_proposal`/`imperative_rule` мають FK на `card(id)` — ця міграція має промотуватись **раніше** за відповідні міграції `agent` ([`data-model.md _audit`](../_audit/data-model-2026-08-23.md)).
