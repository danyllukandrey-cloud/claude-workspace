---
id: T18
title: "App: createEntry use-case"
layer: "app"
deps: ["T7", "T8", "T10"]
acs: ["AC-01", "AC-06", "AC-11"]
files_hint: ["plan/app/src/cards/life-area-card/app/create-entry.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T18 — App: createEntry use-case

## Why

Оркеструє T7 (статус) + T8 (конфлікт) + T10 (запис) — [`sad.md §6` Flow 3/7](../sad.md#6-runtime-view). Викликається `agent`'s `confirm`, не напряму користувачем.

## What

Щасливий шлях пише `confirmed` (AC-01). Виявлений конфлікт (T8) пише `pending` на обидва записи (AC-06); той самий статус, якщо агент був недоступний (AC-11) — причина конфлікту не зберігається в самому записі, лише в `pending`-статусі.

## Definition of Done

- [ ] Integration test: щасливий шлях → `confirmed`, прогрес оновлюється
- [ ] Integration test: конфліктний запис → обидва `pending`, прогрес не змінюється
- [ ] lint + vet clean
