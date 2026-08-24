---
id: T22
title: "UI: SCR-03 Літопис-Аналітика screen"
layer: "ui"
deps: ["T19", "T16"]
acs: ["AC-01", "AC-04", "AC-05", "AC-06", "AC-06b", "AC-07", "AC-13"]
files_hint: ["plan/app/src/structure/ui/AnalyticsScreen.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T22 — UI: SCR-03 Літопис-Аналітика screen

## Why

[screens.md SCR-03](../screens.md#scr-03--літопис-аналітика), [ux-flows.md Flow US-04/05/06](../ux-flows.md#flow-us-04--побачити-зведений-прогрес).

## What

`AnalyticsScreen.tsx` — `NEW: ProgressBar`, `NEW: GapList` (два режими показу — ранг / прапорець). Читає `GET /structure/layout` + `GET /structure/layout/history` (T16). Стани: default-logic / default-no-scheme / empty / loading / trend-unavailable.

## Definition of Done

- [ ] Component test на кожен із 5 станів
- [ ] NFR: відкриття екрана ≤300ms з кешу (spec.md §6, клієнтський таймер-тест)
- [ ] Жоден стан не показує вердикт «добре/погано» чи колірний індикатор (D-60)
- [ ] lint + vet clean

## Notes

`trend-unavailable` — навмисно м'яка деградація (сервіс літопису недоступний, `sad.md §11` TBD) — екран не падає повністю.
