---
id: T1
title: "Create app_user table"
layer: "migration"
deps: []
acs: ["AC-06"]
files_hint: ["docs/features/agent/migrations/01_create_app_user.up.sql", "docs/features/agent/migrations/01_create_app_user.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T1 — Create app_user table

## Why

Перша фіча продукту, що реально створює таблицю користувачів/автентифікації (Google-вхід, D-33) — [`data-model.md` §app_user](../data-model.md#app_user), рішення ухвалене з Андрієм 2026-08-27.

## What

Промотувати staged-міграцію `01_create_app_user` у живе дерево `migrations/`. Схема: `id UUID PK`, `google_sub TEXT UNIQUE`, `email`, `display_name`, `created_at`/`updated_at`.

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок на локальному PostgreSQL
- [ ] `UNIQUE` на `google_sub` перевірено тестом (дублікат `google_sub` відхиляється)
- [ ] lint + vet clean

## Notes

Ця таблиця закриває відкладений FK у `card.owner_user_id`/`structure.owner_user_id` — саме FK-обмеження в тих таблицях лишається окремою міграцією тих фіч, не тут.
