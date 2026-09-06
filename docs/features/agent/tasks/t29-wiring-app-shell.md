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

Клієнт: Чат — типовий екран при відкритті застосунку; Налаштування правил і Звіти активності — пункти нижньої навігації. Сервер: **додає** маршрути агента до вже наявного `plan/app/server/app.ts` — composition root і спільний auth-мідлвар уже підключені задачею T30 фічі `life-area-card` ([D-109](../../../DECISIONS.md#d-109), [ISS-51](../../../ISSUES.md)), ця задача НЕ створює їх заново; реєструє `agent` і `agent-worker` як окремі контейнери (ADR-0001).

## Definition of Done

- [ ] Застосунок запускається з Чатом як типовим екраном і 2 додатковими вкладками навігації
- [ ] Маршрути агента змонтовані в наявному `plan/app/server/app.ts`; запит без токена до будь-якого з них відхиляється тим самим спільним auth-мідлваром (T30) до виклику use-case — без другого мідлвара чи другого composition root
- [ ] lint + vet clean

## Notes

`agent-worker` — окремий деплой-юніт логічно (ADR-0001/0002 Neutral), може тимчасово ділити фізичний процес із `backend-service` на старті (`sad.md §7`).
