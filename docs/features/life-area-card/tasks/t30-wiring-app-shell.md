---
id: T30
title: "Wiring: register life-area-card module in app-shell"
layer: "wiring"
deps: ["T25", "T26", "T27", "T28", "T29"]
acs: []
files_hint: ["plan/app/src/cards/life-area-card/index.ts", "plan/app/src/app/main.tsx"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T30 — Wiring: register life-area-card module

## Why

Реєстрація модуля в app-shell — той самий патерн, що вже застосований у `structure`'s T24/`agent`'s T29.

## What

Колода — типовий екран (чи один із них поруч із Чатом `agent`, порядок навігації — деталь реалізації). Один код картки-типу назавжди (D-23), реєструється один раз в `index.ts`.

## Definition of Done

- [ ] Застосунок запускається з Колодою, доступною з навігації
- [ ] `index.ts` відповідає `sad.md §5`
- [ ] lint + vet clean
