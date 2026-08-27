---
id: T12
title: "Infra: Claude client for suspicious-data check"
layer: "infra"
deps: []
acs: ["AC-10"]
files_hint: ["plan/app/src/cards/life-area-card/infra/claude-client.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T12 — Infra: Claude client for suspicious-data check

## Why

Агент вказує на підозрілі дані — [`sad.md §6` Flow 5](../sad.md#6-runtime-view).

## What

Обгортка над Claude API: перевіряє дані картки на суперечність із описаним, повертає пояснення чи `null`, коли нічого не знайдено.

## Definition of Done

- [ ] Integration test проти заглушки Claude API: суперечливі дані повертають пояснення
- [ ] Integration test: узгоджені дані повертають `null`
- [ ] lint + vet clean

## Notes

**Можлива дублікація з `agent`'s `claude-client.ts`** — при `implement` варто перевірити, чи це той самий клієнт, не дві незалежні реалізації виклику Claude API. Рішення не вирішене жодним upstream-документом, деталь реалізації.
