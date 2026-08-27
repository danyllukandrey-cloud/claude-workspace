---
id: T25
title: "UI: SCR-01 Колода карток"
layer: "ui"
deps: ["T24", "T21"]
acs: ["AC-04"]
files_hint: ["plan/app/src/cards/life-area-card/ui/DeckScreen.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T25 — UI: SCR-01 Колода карток

## Why

Стартовий екран застосунку — [`screens.md` SCR-01](../screens.md#scr-01--колода-карток).

## What

`DeckGrid` (нове) + `GET /cards` (T21). Рендерить 4 стани: `default`, `empty`, `loading`, `error`.

## Definition of Done

- [ ] Component test: усі 4 стани зі `screens.md` SCR-01 рендеряться за відповідним триггером
- [ ] lint + vet clean
