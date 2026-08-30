---
id: T27
title: "Migration: add logic_variant column to structure"
layer: "migration"
deps: ["T1"]
acs: ["AC-16"]
files_hint: ["docs/features/structure/migrations/backend/04_add_logic_variant.up.sql", "docs/features/structure/migrations/backend/04_add_logic_variant.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T27 — Migration: add logic_variant column to structure

## Why

Закриває дрейф [ISS-7](../../../ISSUES.md) — [D-83](../../../DECISIONS.md#d-83) (2026-08-29) визначив три підвиди варіанта «за логікою» як реальні опції продукту, але жодне похідне місце (`data-model.md`, міграції, задачі, тести) цього не відображало.

## What

`ALTER TABLE structure ADD COLUMN logic_variant TEXT NULL CHECK (logic_variant IN ('balance', 'focus', 'cause_effect'))`.

## Definition of Done

- [ ] Staged migration `backend/04` промотована до живих `migrations/`, застосовується й відкочується без помилок
- [ ] CHECK-обмеження блокує будь-яке значення поза трьома дозволеними (і `NULL` дозволений)
- [ ] lint + vet clean

## Notes

Узгодженість `logic_variant IS NULL` при `layout_mode != 'logic'` — на рівні app-шару (T4/T11), не CHECK у БД ([data-model.md](../data-model.md) Constraints).
