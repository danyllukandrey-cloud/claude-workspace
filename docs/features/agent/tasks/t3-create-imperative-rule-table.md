---
id: T3
title: "Create imperative_rule table"
layer: "migration"
deps: ["T1"]
acs: ["AC-07", "AC-08", "AC-12", "AC-14"]
files_hint: ["docs/features/agent/migrations/03_create_imperative_rule.up.sql", "docs/features/agent/migrations/03_create_imperative_rule.down.sql"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T3 — Create imperative_rule table

## Why

Правила користувача — глобальні й card-override — [`data-model.md` §imperative_rule](../data-model.md#imperative_rule), D-27 (6 категорій)/D-35 (власний текст).

## What

Промотувати staged-міграцію `03_create_imperative_rule`. Схема: `category` CHECK-enum (6 значень D-27), `rule_text`, `scope_card_id` (NULL = глобальне), CHECK «категорія або текст, хоч щось задано».

## Definition of Done

- [ ] Міграція застосовується й відкатується без помилок
- [ ] CHECK «category IS NOT NULL OR rule_text IS NOT NULL» перевірено тестом (обидва NULL відхиляються)
- [ ] lint + vet clean

## Notes

Той самий крос-фічевий FK-порядок, що й T2: `scope_card_id -> card(id)` вимагає `life-area-card` промотованою раніше.
