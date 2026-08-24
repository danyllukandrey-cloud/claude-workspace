---
id: T19
title: "UI: shared primitives (Spinner, Banner, ConfirmDialog, EmptyState)"
layer: "ui"
deps: []
acs: []
files_hint: ["plan/app/src/shared/ui/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T19 — UI: shared primitives (Spinner, Banner, ConfirmDialog, EmptyState)

## Why

[screens.md §New components](../screens.md#new-components) — 4 з 11 нових компонентів використовуються на кількох екранах одразу; писати їх окремо на кожному екрані означало б дублювання.

## What

`Spinner` (не skeleton — `design-system.md` конвенція), `Banner` (inline, ніколи `alert`/`confirm`), `ConfirmDialog`, `EmptyState`. У `plan/app/src/shared/ui/`, поруч з уже запланованими `CardShell`/`Button`/`NumberField`/`TextField`.

## Definition of Done

- [ ] Кожен компонент рендерить усі свої задекларовані стани (Storybook чи еквівалент)
- [ ] Зареєстровано в [`docs/design-system.md` §Component inventory](../../../design-system.md#component-inventory) (замінити рядок `pending` на реальний `file:line`)
- [ ] Unit test на кожен компонент
- [ ] lint + vet clean

## Notes

Немає власного AC — це інфраструктурний UI-шар під T20-T23, не пряма реалізація критерію приймання.
