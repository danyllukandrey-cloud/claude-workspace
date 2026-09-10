---
id: T11
title: "Domain (agent-worker): activity-report model"
layer: "domain"
deps: []
acs: ["AC-11"]
files_hint: ["plan/app/src/agent-worker/domain/report.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T11 — Domain (agent-worker): activity-report model

## Why

Формування звіту за визначеними правилами — [`sad.md §5`](../sad.md#5-building-block-view) `agent-worker/domain/report.ts`, D-70.

## What

Розрахунок меж періоду (тижневий/місячний/квартальний) і ключа ідемпотентності `(user_id, period_type, period_start)` для перевірки «чи звіт за цей період уже сформовано».

## Definition of Done

- [ ] Unit test: межі тижневого/місячного/квартального періодів обчислені коректно для довільної дати
- [ ] Unit test: той самий ключ ідемпотентності для двох викликів у межах одного періоду
- [ ] lint + vet clean

## Notes

Три акценти звіту (тижневий/місячний/+прив'язка до зон/+пропозиція перегляду пріоритетів, D-70) — вміст `content`, не структура цієї моделі; сам текст формується в T19 (app-шар), тут лише межі й ідемпотентність.
