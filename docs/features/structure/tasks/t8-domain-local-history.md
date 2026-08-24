---
id: T8
title: "Domain: local history cache model"
layer: "domain"
deps: []
acs: ["AC-15"]
files_hint: ["plan/app/src/structure/domain/history.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T8 — Domain: local history cache model

## Why

[sad.md §5](../sad.md#5-building-block-view) — `history.ts`: локальна модель для офлайн-кешу; самі події пише backend/сервіс літопису (T10), не ця задача.

## What

Тип події (`renamed`/`moved`/`closed`) + функція додавання в локальну чергу перед синхронізацією (офлайн-доступність, spec.md §6 NFR).

## Definition of Done

- [ ] Unit test: подія додається в чергу з часовою міткою
- [ ] Unit test: черга зберігає порядок додавання
- [ ] lint + vet clean

## Notes

Це лише локальна модель клієнта — фактичний запис у сервіс літопису відбувається на бекенді (T10, T12, T13).
