---
id: T8
title: "Domain: proposal lifecycle model"
layer: "domain"
deps: []
acs: ["AC-01", "AC-02", "AC-02b", "AC-03", "AC-10", "AC-10b"]
files_hint: ["plan/backend/src/agent/domain/proposal.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T8 — Domain: proposal lifecycle model

## Why

Чиста доменна логіка стану пропозиції — [`sad.md §5`](../sad.md#5-building-block-view) `domain/proposal.ts`, [`sad.md §6` Flow 1/3/5](../sad.md#6-runtime-view).

## What

Модель переходів: `active -> confirmed`, `active -> active` (уточнення, AC-02b, оновлює ту саму пропозицію), `active -> dropped` (мовчання/нетематичне повідомлення, AC-03). Приймає джерело тексту чи вкладення (AC-01/AC-10), позначає нерозпізнане вкладення (AC-10b) без створення пропозиції.

## Definition of Done

- [ ] Unit test: створення пропозиції з тексту й з вкладення
- [ ] Unit test: уточнення оновлює наявну пропозицію на місці, не створює нову
- [ ] Unit test: нетематичне повідомлення позначає стару пропозицію `dropped`, нічого не записує
- [ ] Unit test: нерозпізнане вкладення не створює пропозицію
- [ ] lint + vet clean

## Notes

Домен-рівень **не** торкається БД — інваріант «одна активна пропозиція» тут перевіряється логічно; на рівні БД його дублює частковий унікальний індекс з T2 (два незалежні рівні захисту, свідомо).
