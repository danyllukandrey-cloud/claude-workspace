---
id: T21
title: "UI: SCR-02 Схема screen"
layer: "ui"
deps: ["T19", "T16", "T17"]
acs: ["AC-02", "AC-08", "AC-11b"]
files_hint: ["plan/app/src/structure/ui/LayoutBoard.tsx"]
owner: "TBD"
estimate: "L"
status: "todo"
---

# T21 — UI: SCR-02 Схема screen

## Why

[screens.md SCR-02](../screens.md#scr-02--схема), [ux-flows.md Flow US-03](../ux-flows.md#flow-us-03--перекласти-картки-будь-коли).

## What

`LayoutBoard.tsx` — `NEW: LayoutGrid` (drag-and-drop сітка), `CardShell` (уже в інвентарі). Перетягування викликає `PUT /structure/layout/{cardId}` (T17). Стани: default / empty / loading / reset-basic-order / error-cell-occupied / error.

## Definition of Done

- [ ] Component test на кожен із 6 станів
- [ ] NFR: перетягування → оновлений стан екрана ≤200ms (spec.md §6, клієнтський таймер-тест)
- [ ] `error-cell-occupied` показується inline біля клітинки, не toast/alert
- [ ] lint + vet clean

## Notes

Найбільша UI-задача (L) — drag-and-drop + сітка клітинок ([sad.md §5.2](../sad.md#5-building-block-view), «запас вільних клітинок»); розглянути розбиття, якщо вилізе за день.
