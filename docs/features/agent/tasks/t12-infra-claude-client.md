---
id: T12
title: "Infra: Claude API client"
layer: "infra"
deps: []
acs: ["AC-01", "AC-10"]
files_hint: ["plan/app/src/agent/infra/claude-client.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T12 — Infra: Claude API client

## Why

Виклик Claude API — ключ ховається на бекенді (D-24) — [`sad.md §5`](../sad.md#5-building-block-view) `infra/claude-client.ts`, [`sad.md §2`](../sad.md#2-constraints).

## What

Обгортка над Claude API: запит на розбір тексту/вкладення, формування пропозиції запису чи пояснення. Таймаут і мапінг недоступності в domain-sentinel `Err` (ADR-0006) — жоден `throw` для очікуваної помилки.

## Definition of Done

- [ ] Integration test проти заглушки Claude API: запит-відповідь для тексту й для вкладення
- [ ] Integration test: таймаут/недоступність повертає `Err`, не кидає виняток
- [ ] Тест на відсутність ключа в логах
- [ ] lint + vet clean

## Notes

Заглушка (stub), не реальний Claude API — той самий підхід, що описаний у `sad.md §10 QG-2` для навантажувального тесту.
