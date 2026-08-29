---
id: T36
title: "UI: SCR-07 Архів карток"
layer: "ui"
deps: ["T24", "T35"]
acs: ["AC-17", "AC-18"]
files_hint: ["plan/app/src/cards/life-area-card/ui/ArchiveScreen.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T36 — UI: SCR-07 Архів карток

## Why

[screens.md SCR-07](../screens.md#scr-07--архів-карток).

## What

Список архівованих карток (default/empty), режим перегляду картки (`card-view`) з кнопкою «Розархівувати» (AC-17). У `card-view` новий запис недоступний, поки картку не розархівовано. Вхід — кнопка «Архів» на SCR-01 (T25).

## Definition of Done

- [ ] Component test: рендерить default/empty/card-view стани per screens.md SCR-07
- [ ] Component test: «Розархівувати» викликає T35, після успіху картка зникає зі списку архіву
- [ ] lint + vet clean
