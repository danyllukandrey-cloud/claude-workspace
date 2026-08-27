---
id: T13
title: "App: createCard use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-02"]
files_hint: ["plan/app/src/cards/life-area-card/app/create-card.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T13 — App: createCard use-case

## Why

Оркеструє T9 (валідація) + T10 (запис) — [`sad.md §6` Flow 1](../sad.md#6-runtime-view).

## What

Приймає назву, відхиляє порожню (AC-02), інакше створює картку зі станом `created` і пише подію в `card_lifecycle_event`.

## Definition of Done

- [ ] Integration test: щасливий шлях створює картку + подію життєвого циклу
- [ ] Integration test: порожня назва відхиляється без запису
- [ ] lint + vet clean
