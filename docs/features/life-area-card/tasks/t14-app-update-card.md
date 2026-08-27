---
id: T14
title: "App: updateCard use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-03"]
files_hint: ["plan/app/src/cards/life-area-card/app/update-card.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T14 — App: updateCard use-case

## Why

Оркеструє T9 + T10 для оновлення назви/Опису й переходу в `filled` — [`sad.md §6` Flow 2](../sad.md#6-runtime-view).

## What

Часткове оновлення. Спроба позначити `filled` без Опису відхиляється (AC-03), пише подію переходу при успіху.

## Definition of Done

- [ ] Integration test: Опис зберігається окремо від позначення «заповнена»
- [ ] Integration test: позначення «заповнена» без Опису відхиляється
- [ ] lint + vet clean
