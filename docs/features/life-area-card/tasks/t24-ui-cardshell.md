---
id: T24
title: "UI: shared CardShell primitives"
layer: "ui"
deps: []
acs: []
files_hint: ["plan/app/src/shared/ui/CardShell.tsx", "plan/app/src/shared/ui/Spinner.tsx", "plan/app/src/shared/ui/Banner.tsx", "plan/app/src/shared/ui/EmptyState.tsx", "plan/app/src/shared/ui/ConfirmDialog.tsx"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T24 — UI: shared CardShell primitives

## Why

Каркас картки, що перевертається — [`design-system.md` §Component inventory](../../../design-system.md) (`CardShell`, заплановано).

## What

`CardShell` (перегортання лицьова/зворот), плюс переюзані з `structure/screens.md`: `Spinner`, `Banner`, `EmptyState`, `ConfirmDialog` (pending, той самий компонент, не дубльований).

> **Нестиковка документів (виявлена, не мовчки виправлена):** оригінальний `files_hint` вище вказував на `plan/app/src/cards/life-area-card/ui/CardShell.tsx`. Це розходилось з [`design-system.md` §Library location](../../../design-system.md) і зі `plan/app/src/shared/ui/index.ts`, які прямо кажуть — спільні UI-примітиви (CardShell/Button/NumberField/TextField) живуть у `plan/app/src/shared/ui/`, не всередині картки. Реалізацію розміщено за `design-system.md` (джерело правди для розташування бібліотеки компонентів), `files_hint` вище відповідно виправлено на фактичний шлях.

## Definition of Done

- [x] Component test: `CardShell` перегортає між переданим лицьовим і зворотним вмістом
- [x] Component test: `Spinner`/`Banner`/`EmptyState`/`ConfirmDialog` рендерять свої стани
- [x] lint + vet clean
