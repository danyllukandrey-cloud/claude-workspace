---
id: T6
title: "Domain: progress calculation from raw events"
layer: "domain"
deps: []
acs: ["AC-05", "AC-09", "AC-09b"]
files_hint: ["plan/app/src/cards/life-area-card/domain/progress.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T6 — Domain: progress calculation from raw events

## Why

Спільний код клієнт+бекенд — [ADR-0001](../adr/0001-recompute-progress-from-raw-events.md), [`sad.md §5`](../sad.md#5-building-block-view) `domain/progress.ts`.

## What

Частка виконання цілі з масиву сирих подій (`entry` зі статусом `confirmed`). Capping при перевищенні (AC-09b) — окреме поле надлишку. `is_ongoing` блоки повертають накопичену кількість, не відсоток (AC-05). Ніякого I/O — чиста функція, підключається і бекендом, і PWA.

## Definition of Done

- [ ] Unit test: частка = сума confirmed-записів / ціль
- [ ] Unit test: перевищення цілі обмежується 1.0, надлишок повертається окремим полем
- [ ] Unit test: `is_ongoing` без `target_count` повертає лише накопичену суму
- [ ] lint + vet clean

## Notes

Жоден виклик цієї функції не повинен кешувати результат у БД чи локальному сховищі як «джерело правди» — лише похідне значення на льоту.
