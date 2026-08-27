---
id: T27
title: "UI: SCR-04 Форма створення"
layer: "ui"
deps: ["T24", "T21"]
acs: ["AC-02"]
files_hint: ["plan/app/src/cards/life-area-card/ui/CreateCardForm.tsx"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T27 — UI: SCR-04 Форма створення картки

## Why

Точка входу для US-01 — [`screens.md` SCR-04](../screens.md#scr-04--форма-створення-картки).

## What

`TextField`/`Button` з інвентарю + `POST /cards` (T21). Рендерить `default`/`validation`/`saving`/`error`.

## Definition of Done

- [ ] Component test: усі 4 стани зі `screens.md` SCR-04 рендеряться за відповідним триггером
- [ ] lint + vet clean
