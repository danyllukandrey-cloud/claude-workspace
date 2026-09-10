---
id: T15
title: "App: archiveCard use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-16"]
files_hint: ["plan/app/src/cards/life-area-card/app/archive-card.ts"]
owner: "TBD"
estimate: "S"
status: "done"
---

# T15 — App: archiveCard use-case

## Why

М'яка архівація — [`sad.md §6` Flow 13](../sad.md#6-runtime-view).

## What

Позначає `status: archived`, пише подію `archived` у `card_lifecycle_event`. Ніколи фізичне видалення.

## Definition of Done

- [x] Integration test: архівація виключає картку зі списку активних, рядок лишається читомим напряму
- [x] lint + vet clean

## Notes

~~Синхронізація з позицією в `structure_layout_position` — те саме транзакційне закриття, що вже описано в `structure`'s D-69; тут лише архівує саму картку, `structure`'s власна логіка закриває позицію окремим (уже спроєктованим) шляхом.~~ — **невірно, знайдено критиком хвилі 5 ([ISS-26](../../../ISSUES.md)):** такої логіки в `structure` не існувало. **Виправлено 2026-09-05 ([D-103](../../../DECISIONS.md#d-103)):** `archiveCard` приймає опційний інжектований `closeStructurePosition` (DI, той самий підхід що StoragePort/callClaude) — не імпортує `structure/` напряму. `structure`'s T1/T2/T26 (фундаментальні міграції) промоучені позачергово заради цього. Перевірено проти реальної Neon: активна позиція в розкладці реально закривається (`status='closed'`) в тій самій дії архівації.
