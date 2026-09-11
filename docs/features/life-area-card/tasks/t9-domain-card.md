---
id: T9
title: "Domain: card lifecycle states"
layer: "domain"
deps: []
acs: ["AC-02", "AC-03", "AC-08", "AC-16"]
files_hint: ["plan/app/src/cards/life-area-card/domain/card.ts"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T9 — Domain: card lifecycle states

## Why

Стани картки — `created`/`filled`/`in_use`/`archived` — [`sad.md §5`](../sad.md#5-building-block-view) `domain/card.ts`, design-review Блок 4.

## What

Валідація створення (назва обов'язкова, AC-02), переходу в `filled` (Опис обов'язковий, AC-03), декларативний стан без блоків-метрик (AC-08 — ніколи не досягає `in_use`), архівація (AC-16 — м'яка, ніколи фізичне видалення).

## Definition of Done

- [x] Unit test: створення без назви відхиляється
- [x] Unit test: перехід у `filled` без Опису відхиляється
- [x] Unit test: картка без блоків-метрик лишається декларативною, не переходить у `in_use`
- [x] Unit test: архівація позначає статус, не видаляє
- [x] lint + vet clean

## Notes

«Некоректні дані» (AC-10) — не стан життєвого циклу, тимчасовий прапорець з `getCardWithProgress` (T20), тут не рахується.

2026-09-11 ([ISS-20](../../../ISSUES.md)): frontmatter/DoD оновлено заднім числом — код реалізує весь DoD ще з комітів `58ad01a`/`16220a9`, лишень сам файл задачі про це не знав. Перевірено наживо перед позначенням: `vitest run domain/card.test.ts` (12/12 ✓) і `npm run lint` (чисто) в `plan/app`.
