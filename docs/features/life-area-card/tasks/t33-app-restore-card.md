---
id: T33
title: "App: restoreCard use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-17"]
files_hint: ["plan/app/src/cards/life-area-card/app/restore-card.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T33 — App: restoreCard use-case

## Why

Дзеркало `archiveCard` (T15) — [spec.md AC-17](../spec.md#5-acceptance-criteria).

## What

Переводить `status: archived` → `active`, пише подію `restored` у `card_lifecycle_event`. Позиція в розкладці Структури НЕ відновлюється автоматично (D-69) — це відповідальність `structure`, не цього use-case.

## Definition of Done

- [ ] Integration test: розархівація активної (не архівованої) картки повертає `card.not_archived`, нічого не пише
- [ ] Integration test: розархівація архівованої картки повертає `status: active`, картка знову в `listCards` за замовчуванням
- [ ] lint + vet clean
