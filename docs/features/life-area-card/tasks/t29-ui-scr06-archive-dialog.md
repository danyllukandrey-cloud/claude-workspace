---
id: T29
title: "UI: SCR-06 Підтвердження архівації"
layer: "ui"
deps: ["T24", "T21"]
acs: ["AC-16"]
files_hint: ["plan/app/src/cards/life-area-card/ui/ArchiveCardDialog.tsx"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T29 — UI: SCR-06 Підтвердження архівації

## Why

Видалення завжди з підтвердженням — [`screens.md` SCR-06](../screens.md#scr-06--підтвердження-архівації).

## What

`ConfirmDialog` (reused, T24) + `DELETE /cards/{id}` (T21). Рендерить `default`/`error`.

## Definition of Done

- [ ] Component test: обидва стани зі `screens.md` SCR-06 рендеряться за відповідним триггером
- [ ] Component test: скасування не викликає `DELETE`
- [ ] lint + vet clean
