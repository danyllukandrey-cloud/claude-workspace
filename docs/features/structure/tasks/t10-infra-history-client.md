---
id: T10
title: "Infra: history service client (write + asOf read)"
layer: "infra"
deps: ["T3"]
acs: ["AC-07", "AC-15"]
files_hint: ["plan/app/src/structure/infra/history-client.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T10 — Infra: history service client (write + asOf read)

## Why

Сервіс літопису — окремий деплой-юніт з окремою базою (ADR-0004). Комунікація — прямий HTTP-виклик, не спільна БД ([D-67](../../../DECISIONS.md#d-67)).

## What

Клієнт: `recordEvent(structureId, cardId, eventType, detail)` і `getLayoutAsOf(structureId, asOf)` — HTTP-виклики до сервісу літопису з основного бекенда.

## Definition of Done

- [ ] Integration test: подія записується, потім читається назад через `asOf` (та сама чи пізніша дата)
- [ ] Integration test: `asOf` у минулому до першої події повертає порожній результат, не помилку
- [ ] lint + vet clean

## Notes

Поведінка при недоступності сервісу — відкрите питання ([`sad.md §11`](../sad.md#11-risks-and-technical-debt)), НЕ вирішувати тут самовільно — пропагувати помилку вгору, нехай T12/T13/T14 (app-шар) вирішують, коли рішення буде ухвалено.
