---
id: T24
title: "UI: shared CardShell primitives"
layer: "ui"
deps: []
acs: []
files_hint: ["plan/app/src/cards/life-area-card/ui/CardShell.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T24 — UI: shared CardShell primitives

## Why

Каркас картки, що перевертається — [`design-system.md` §Component inventory](../../../design-system.md) (`CardShell`, заплановано).

## What

`CardShell` (перегортання лицьова/зворот), плюс переюзані з `structure/screens.md`: `Spinner`, `Banner`, `EmptyState`, `ConfirmDialog` (pending, той самий компонент, не дубльований).

## Definition of Done

- [ ] Component test: `CardShell` перегортає між переданим лицьовим і зворотним вмістом
- [ ] Component test: `Spinner`/`Banner`/`EmptyState`/`ConfirmDialog` рендерять свої стани
- [ ] lint + vet clean
