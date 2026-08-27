---
id: T5
title: "Create chat_message table"
layer: "migration"
deps: ["T1"]
acs: ["AC-13", "AC-15"]
files_hint: ["docs/features/agent/migrations/05_create_chat_message.up.sql", "docs/features/agent/migrations/05_create_chat_message.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T5 — Create chat_message table

## Why

Сирий лог чату — джерело короткострокового вікна пам'яті (D-26) і сигнал першого запуску для онбордингу — [`data-model.md` §chat_message](../data-model.md#chat_message).

## What

Промотувати staged-міграцію `05_create_chat_message`. `session_date DATE` = календарний день (D-26), проставляється застосунком при записі.

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] Індекс `(user_id, session_date, created_at)` перевірено на швидкій вибірці «повідомлення сьогодні»
- [ ] lint + vet clean

## Notes

Незалежна від крос-фічевого порядку промоції — жодного зовнішнього FK.
