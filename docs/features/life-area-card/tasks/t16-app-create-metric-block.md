---
id: T16
title: "App: createMetricBlock use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-05", "AC-07", "AC-08"]
files_hint: ["plan/app/src/cards/life-area-card/app/create-metric-block.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T16 — App: createMetricBlock use-case

## Why

Додає блок-метрику до картки — [`sad.md §6` Flow 6/8](../sad.md#6-runtime-view).

## What

Приймає label/unit/ціль чи `is_ongoing`. Допомога з невимірною ціллю (AC-07) відбувається в чаті до цього виклику — тут приймається вже узгоджений результат.

## Definition of Done

- [ ] Integration test: блок з фіксованою ціллю створюється
- [ ] Integration test: `is_ongoing: true` створюється без `target_date`
- [ ] Integration test: картка без жодного виклику цього use-case лишається декларативною (T9)
- [ ] lint + vet clean
