---
id: T34
title: "Domain: account deletion orchestration"
layer: "domain"
deps: []
acs: ["AC-17", "AC-17b"]
files_hint: ["plan/app/src/agent/domain/account.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T34 — Domain: account deletion orchestration

## Why

[spec.md AC-17/AC-17b](../spec.md#5-acceptance-criteria).

## What

Побудова впорядкованого плану видалення: явне підтвердження обов'язкове (AC-17b) → запис `account_deleted` в аудит **до** видалення → видалення `app_user`. Без реального доступу до БД — сам план, домен-рівень.

## Definition of Done

- [ ] Unit test: без прапорця підтвердження план не будується, нічого не пише
- [ ] Unit test: з підтвердженням план містить рівно два кроки в правильному порядку
- [ ] lint + vet clean
