---
id: T9
title: "Domain: card lifecycle states"
layer: "domain"
deps: []
acs: ["AC-02", "AC-03", "AC-08", "AC-16"]
files_hint: ["plan/app/src/cards/life-area-card/domain/card.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T9 — Domain: card lifecycle states

## Why

Стани картки — `created`/`filled`/`in_use`/`archived` — [`sad.md §5`](../sad.md#5-building-block-view) `domain/card.ts`, design-review Блок 4.

## What

Валідація створення (назва обов'язкова, AC-02), переходу в `filled` (Опис обов'язковий, AC-03), декларативний стан без блоків-метрик (AC-08 — ніколи не досягає `in_use`), архівація (AC-16 — м'яка, ніколи фізичне видалення).

## Definition of Done

- [ ] Unit test: створення без назви відхиляється
- [ ] Unit test: перехід у `filled` без Опису відхиляється
- [ ] Unit test: картка без блоків-метрик лишається декларативною, не переходить у `in_use`
- [ ] Unit test: архівація позначає статус, не видаляє
- [ ] lint + vet clean

## Notes

«Некоректні дані» (AC-10) — не стан життєвого циклу, тимчасовий прапорець з `getCardWithProgress` (T20), тут не рахується.
