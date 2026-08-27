---
id: T2
title: "Create agent_proposal table"
layer: "migration"
deps: ["T1"]
acs: ["AC-01", "AC-02", "AC-02b", "AC-03", "AC-10", "AC-10b"]
files_hint: ["docs/features/agent/migrations/02_create_agent_proposal.up.sql", "docs/features/agent/migrations/02_create_agent_proposal.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T2 — Create agent_proposal table

## Why

Стан «пропозиції, що чекає підтвердження» — [`data-model.md` §agent_proposal](../data-model.md#agent_proposal), [`sad.md §4`](../sad.md#4-solution-strategy) («одна активна пропозиція на користувача, без TTL»).

## What

Промотувати staged-міграцію `02_create_agent_proposal`. Схема включає `status`/`source_type` CHECK-enum, FK на `app_user`/`card`/`metric_block`, і частковий унікальний індекс `uq_agent_proposal_active_user` — домен-інваріант на рівні БД.

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] Частковий унікальний індекс перевірено тестом: друга спроба вставити активну пропозицію для того самого користувача відхиляється
- [ ] lint + vet clean

## Notes

**Залежність порядку промоції (крос-фічева, вперше в проєкті):** FK на `card(id)`/`metric_block(id)` вимагають, щоб міграції `life-area-card` вже застосувались. Якщо ні — ця міграція впаде. `implement` має промотувати `life-area-card` раніше за `agent` ([`data-model.md` _audit](../_audit/data-model-2026-08-27.md)).
