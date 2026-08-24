---
id: T23
title: "UI: SCR-04 Закрити напрямок dialog"
layer: "ui"
deps: ["T19", "T18"]
acs: ["AC-12"]
files_hint: ["plan/app/src/structure/ui/CloseCardDialog.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T23 — UI: SCR-04 Закрити напрямок dialog

## Why

[screens.md SCR-04](../screens.md#scr-04--закрити-напрямок), [ux-flows.md Flow US-08](../ux-flows.md#flow-us-08--закрити-напрямок-замість-обєднання).

## What

`CloseCardDialog.tsx` — `NEW: Toggle` (перенести/ні на кожну метрику), `NEW: CardPicker` (цільова картка). Викликає `POST /structure/layout/{cardId}/close` (T18). Стани: default / empty / rename-needed / validation / error / success.

## Definition of Done

- [ ] Component test на кожен із 6 станів
- [ ] `validation`: кнопка підтвердження заблокована, поки для «перенести» не обрано цільову картку
- [ ] `rename-needed` показує поле для нової назви метрики при колізії (`life-area-card` AC-15)
- [ ] lint + vet clean

## Notes

`success` веде назад на SCR-02 (T21) — переконатись, що навігація після закриття коректна.
