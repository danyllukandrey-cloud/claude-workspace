---
id: T20
title: "UI: SCR-01 Декларація screen"
layer: "ui"
deps: ["T19", "T15"]
acs: ["AC-09", "AC-10", "AC-11", "AC-11b"]
files_hint: ["plan/app/src/structure/ui/DeclarationScreen.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T20 — UI: SCR-01 Декларація screen

## Why

[screens.md SCR-01](../screens.md#scr-01--декларація) — усі 7 станів, [ux-flows.md Flow US-01/US-02](../ux-flows.md#flow-us-01--задекларувати-картину-світу).

## What

`DeclarationScreen.tsx` — `NEW: TextArea`, `NEW: LayoutModePicker` (обидва реєструються тут, якщо ще не написані окремо), викликає `GET/PATCH /structure` (T15). Стани: default / empty / loading / saved / offline-queued / confirm-reset / error — точно за таблицею `screens.md`.

## Definition of Done

- [ ] Component test на кожен із 7 станів
- [ ] `confirm-reset` (AC-11b) показується лише коли `layoutMode` реально змінюється, не при збереженні того самого значення
- [ ] Помилки — інлайн, ніколи `alert`/`confirm` (design-system.md конвенція)
- [ ] lint + vet clean

## Notes

`TextArea`/`LayoutModePicker` — нові компоненти з `screens.md §New components`; писати саме тут, якщо T19 їх не покрив.
