---
id: T47
title: "UI: HintBubble + SCR-01 confirmed-hint state"
layer: "ui"
deps: ["T25", "T26"]
acs: ["AC-16", "AC-16b"]
files_hint: ["plan/app/src/agent/ui/chat/HintBubble.tsx"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T47 — UI: HintBubble + SCR-01 confirmed-hint state

## Why

[screens.md SCR-01, стан `confirmed-hint`](../screens.md#scr-01--чат) — T3, [D-84](../../../DECISIONS.md#d-84), 2026-08-29. Раніше додано разом зі spec.md (US-10/AC-16/AC-16b), але без задачі — знайдено самоперевіркою T47 при закритті дрейфу T4-T7.

## What

Дисмісибл-підказка над `Composer`: «Звертайся до Агента щоразу, коли маєш запитання чи не розумієш наступний крок». З'являється після завершеної дії, зникає по ✕ або по фокусу на полі вводу.

## Definition of Done

- [ ] Component test: рендерить `confirmed-hint` стан per screens.md SCR-01
- [ ] Component test: зникає по ✕ і по фокусу на `Composer`
- [ ] lint + vet clean
