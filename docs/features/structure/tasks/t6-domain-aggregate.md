---
id: T6
title: "Domain: aggregate progress calculation"
layer: "domain"
deps: []
acs: ["AC-01", "AC-04", "AC-13"]
files_hint: ["plan/app/src/structure/domain/aggregate.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T6 — Domain: aggregate progress calculation

## Why

[ADR-0001](../adr/0001-recompute-structure-aggregate-client-side.md) — перерахунок з сирих подій, ніколи не кешоване число. [sad.md Потік 1/9](../sad.md#6-runtime-view).

## What

Чиста функція: дано перелік прогресів карток (кожен уже порахований `life-area-card`'s `domain/progress.ts` — не дублювати формулу тут) → середнє серед карток з обчислюваним відсотком, виключаючи картки без відсотка, з окремим лічильником виключених (AC-13). Позиція в розкладці НЕ є вхідним параметром цієї функції взагалі (AC-04 — структурна гарантія, не просто «ігнорується»).

## Definition of Done

- [ ] Unit test: середнє коректне для суміші карток з відсотком і без
- [ ] Unit test: 0 карток з відсотком → середнє відсутнє (не 0), лічильник виключених = усі
- [ ] Unit test: сигнатура функції не приймає жодного параметра позиції/пріоритету (AC-04 перевіряється на рівні типів, не лише поведінки)
- [ ] lint + vet clean

## Notes

Прогрес однієї картки рахує `life-area-card`, не ця задача — тут лише зведення вже готових чисел.
