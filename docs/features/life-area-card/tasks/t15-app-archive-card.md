---
id: T15
title: "App: archiveCard use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-16"]
files_hint: ["plan/app/src/cards/life-area-card/app/archive-card.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T15 — App: archiveCard use-case

## Why

М'яка архівація — [`sad.md §6` Flow 13](../sad.md#6-runtime-view).

## What

Позначає `status: archived`, пише подію `archived` у `card_lifecycle_event`. Ніколи фізичне видалення.

## Definition of Done

- [ ] Integration test: архівація виключає картку зі списку активних, рядок лишається читомим напряму
- [ ] lint + vet clean

## Notes

Синхронізація з позицією в `structure_layout_position` — те саме транзакційне закриття, що вже описано в `structure`'s D-69; тут лише архівує саму картку, `structure`'s власна логіка закриває позицію окремим (уже спроєктованим) шляхом.
