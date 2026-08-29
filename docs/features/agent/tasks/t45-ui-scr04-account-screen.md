---
id: T45
title: "UI: SCR-04 Обліковий запис і дані screen"
layer: "ui"
deps: ["T25", "T43", "T44"]
acs: ["AC-17", "AC-17b", "AC-18", "AC-18b"]
files_hint: ["plan/app/src/agent/ui/AccountScreen.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T45 — UI: SCR-04 Обліковий запис і дані screen

## Why

[screens.md SCR-04](../screens.md#scr-04--обліковий-запис-і-дані).

## What

Список ресурсів синхронізації + форма додавання + небезпечна зона видалення акаунта з підтвердженням словом.

## Definition of Done

- [ ] Component test: рендерить default/add-resource/sync-error/confirm-delete/deleted стани per screens.md SCR-04
- [ ] Component test: кнопка «Видалити» неактивна, поки не введено слово підтвердження
- [ ] lint + vet clean
