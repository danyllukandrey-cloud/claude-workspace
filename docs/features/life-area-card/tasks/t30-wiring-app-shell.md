---
id: T30
title: "Wiring: register life-area-card module + backend transport (Express)"
layer: "wiring"
deps: ["T25", "T26", "T27", "T28", "T29", "T36", "T37"]
acs: []
files_hint: ["plan/app/src/cards/life-area-card/index.ts", "plan/app/src/app/main.tsx", "plan/app/server/ (composition root, ADR-0006)"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T30 — Wiring: register life-area-card module + backend transport

## Why

Реєстрація модуля в app-shell — той самий патерн, що вже застосований у `structure`'s T24/`agent`'s T29. Крім цього — [D-107](../../../DECISIONS.md#d-107)/[ISS-45](../../../ISSUES.md): `ports/*.ts` (T21-T23, T35) написані framework-agnostic саме в очікуванні цього кроку — без нього застосунок не здатний реально відповісти на жоден HTTP-запит, попри готовий use-case- і ports-шар.

## What

Дві частини, та сама задача (розширено D-107, раніше — лише перша):

1. **Frontend:** Колода — типовий екран (чи один із них поруч із Чатом `agent`, порядок навігації — деталь реалізації). Один код картки-типу назавжди (D-23), реєструється один раз в `index.ts`.
2. **Backend (нове, D-107):** composition root `plan/app/server/` (ADR-0006 §Обґрунтування — поза `src/`, куди дотягується Vite, щоб ключ Claude API не потрапив у браузерний бандл) — `express()` застосунок, монтування `ports/*.ts` (card-handlers/metric-block-handlers/entry-handlers) на реальні маршрути `/api/v1/...` за `contracts/openapi.yaml`, error-middleware на `AppError` (ADR-0006 §Обґрунтування, "Envelope помилки"), `app.listen()`.

## Definition of Done

- [ ] Застосунок запускається з Колодою, доступною з навігації
- [ ] `index.ts` відповідає `sad.md §5`
- [ ] `plan/app/server/` реально піднімає Express, усі змонтовані маршрути відповідають формою за `contracts/openapi.yaml` (контрактний тест — ADR-0006 §Рішення, п.3)
- [ ] Помилки (`AppError`) мапляться в JSON-конверт контракту одним error-middleware, не в кожному хендлері окремо
- [ ] lint + vet clean
