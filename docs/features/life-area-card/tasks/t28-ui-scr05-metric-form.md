---
id: T28
title: "UI: SCR-05 Форма блоку-метрики"
layer: "ui"
deps: ["T24", "T22"]
acs: ["AC-05", "AC-07", "AC-08"]
files_hint: ["plan/app/src/cards/life-area-card/ui/MetricBlockForm.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T28 — UI: SCR-05 Форма блоку-метрики

## Why

Додавання блоку-метрики — [`screens.md` SCR-05](../screens.md#scr-05--форма-блоку-метрики).

## What

`TextField`/`NumberField`/`Button` з інвентарю + `POST /cards/{id}/metric-blocks` (T22). Рендерить `default`/`ongoing-toggle`/`prefilled`/`validation`/`error`.

## Definition of Done

- [ ] Component test: усі 5 станів зі `screens.md` SCR-05 рендеряться за відповідним триггером
- [ ] Component test: перемикач «постійний процес» ховає поле дати
- [ ] lint + vet clean
