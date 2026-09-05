---
id: T29
title: "Wiring: register agent module in app-shell + backend composition root"
layer: "wiring"
deps: ["T14", "T26", "T27", "T28"]
acs: []
files_hint: ["plan/app/src/agent/index.ts", "plan/app/src/agent/index.ts", "plan/app/src/app/main.tsx"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T29 — Wiring: register agent module

## Why

Реєстрація модуля в app-shell (клієнт) і в composition root (сервер) — той самий патерн, що вже застосований у `structure`'s T24.

## What

Клієнт: Чат — типовий екран при відкритті застосунку; Налаштування правил і Звіти активності — пункти нижньої навігації. Сервер: підключає auth-мідлвар (T14) перед кожним маршрутом агента; реєструє `agent` і `agent-worker` як окремі контейнери (ADR-0001).

## Definition of Done

- [ ] Застосунок запускається з Чатом як типовим екраном і 2 додатковими вкладками навігації
- [ ] Запит без токена до будь-якого маршруту агента відхиляється мідлваром до виклику use-case
- [ ] lint + vet clean

## Notes

`agent-worker` — окремий деплой-юніт логічно (ADR-0001/0002 Neutral), може тимчасово ділити фізичний процес із `backend-service` на старті (`sad.md §7`).
