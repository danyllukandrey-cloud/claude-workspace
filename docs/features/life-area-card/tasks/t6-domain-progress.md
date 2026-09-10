---
id: T6
title: "Domain: progress calculation from raw events"
layer: "domain"
deps: []
acs: ["AC-05", "AC-09", "AC-09b"]
files_hint: ["plan/app/src/cards/life-area-card/domain/progress.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T6 — Domain: progress calculation from raw events

## Why

Спільний код клієнт+бекенд — [ADR-0001](../adr/0001-recompute-progress-from-raw-events.md), [`sad.md §5`](../sad.md#5-building-block-view) `domain/progress.ts`.

## What

Частка виконання цілі з масиву сирих подій (`entry` зі статусом `confirmed`). Capping при перевищенні (AC-09b) — окреме поле надлишку. `is_ongoing` блоки повертають накопичену кількість, не відсоток (AC-05). Ніякого I/O — чиста функція, підключається і бекендом, і PWA.

## Definition of Done

- [x] Unit test: частка = сума confirmed-записів / ціль
- [x] Unit test: перевищення цілі обмежується 1.0, надлишок повертається окремим полем
- [x] Unit test: `is_ongoing` без `target_count` повертає лише накопичену суму
- [x] lint + vet clean

## Notes

Жоден виклик цієї функції не повинен кешувати результат у БД чи локальному сховищі як «джерело правди» — лише похідне значення на льоту.

**2026-09-06 ([ISS-34](../../../ISSUES.md), закрито):** критик хвилі 5 батч B (рев'ю T20) знайшов — функція кидала `ProgressValidationError` для `targetCount=null`+`isOngoing=false`, хоча `data-model.md` документує цю комбінацію як валідний стан («чисто частотна ціль без фіксованого підсумку»). Andrii підтвердив: комбінація потрібна. Виправлено — `targetCount=null` сам по собі (незалежно від `isOngoing`) веде до `{kind:'ongoing', accumulated}`; помилка лишається лише для дійсно некоректного числа (0 чи від'ємне).
