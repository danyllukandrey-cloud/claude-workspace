---
id: T20
title: "App: getCardWithProgress use-case"
layer: "app"
deps: ["T6", "T10", "T12"]
acs: ["AC-09", "AC-09b", "AC-10"]
files_hint: ["plan/app/src/cards/life-area-card/app/get-card.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T20 — App: getCardWithProgress use-case

## Why

Оркеструє T6 (прогрес) + T10 (читання) + T12 (перевірка на суперечність) — [`sad.md §6` Flow 4/5](../sad.md#6-runtime-view).

## What

Читає картку й усі блоки-метрики, рахує прогрес кожного через T6 (capped, AC-09b), звертається до T12 для `dataWarning` (AC-10, лише коли справді щось виявлено — не на кожен виклик, щоб не бити по латентності без потреби).

## Definition of Done

- [x] Integration test: відповідь містить прогрес по кожному блоку + агрегат (AC-09)
- [x] Integration test: перевищення цілі — capped + окремий надлишок (AC-09b)
- [x] Integration test: `dataWarning` заповнено лише коли T12 щось знайшов
- [x] lint + vet clean

## Notes

Критик: PASS. [ISS-33](../../../ISSUES.md) (формула агрегату — рішення з альтернативами, ніде поза кодом не зафіксоване) закрито того ж дня: Andrii підтвердив просте середнє (D-105), формулу зафіксовано в `spec.md` §5 AC-09.

[ISS-34](../../../ISSUES.md) (пре-існуюча прогалина T6, `computeProgress` кидав виняток для `targetCount=null`+`isOngoing=false`, хоча `data-model.md` документує це як валідний стан) закрито того ж дня — Andrii підтвердив, що комбінація потрібна: `computeProgress` тепер повертає `ongoing`-прогрес для будь-якого `targetCount=null`, не лише для явного `isOngoing`.
