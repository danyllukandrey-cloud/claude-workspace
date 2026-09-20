---
id: T11
title: "Підключити ПЛАН у навігацію (App.tsx/main.tsx)"
layer: "wiring"
deps: ["T9", "T10"]
acs: ["AC-01"]
files_hint: ["plan/app/src/app/App.tsx", "plan/app/src/app/main.tsx", "plan/app/src/plan-horizons/index.ts"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T11 — Підключити ПЛАН у навігацію

## Why

Композиційний корінь (`App.tsx`/`main.tsx`) — той самий шаблон, що для `structure`'s підключення ([sad.md §5](../sad.md)).

## What

Експорт `PlanScreen`/`PlanItemEditor` з `plan-horizons/index.ts`, підключення в `App.tsx` (новий пункт напрямку навігації, AppProps-колбеки `loadPlanItems`/`onCreatePlanItem`/`onUpdatePlanItem`/`onDeletePlanItem`), реалізація колбеків у `main.tsx` через мережевий клієнт.

## Definition of Done

- [ ] `App.test.tsx` покриває перехід на напрямок ПЛАН і рендер `PlanScreen`
- [ ] Кнопка навігації додана (порядок кнопок — за наявним, Group 4 з CH-01 `app-shell.md` ще заблокована й не займає це місце)
- [ ] lint + vet чисто
