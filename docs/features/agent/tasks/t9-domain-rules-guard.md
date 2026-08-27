---
id: T9
title: "Domain: imperative rule model + guard-check enforcement"
layer: "domain"
deps: []
acs: ["AC-07", "AC-08", "AC-12", "AC-14"]
files_hint: ["plan/backend/src/agent/domain/rules.ts", "plan/backend/src/agent/domain/guard.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T9 — Domain: imperative rule model + guard-check enforcement

## Why

Примус правил користувача — найгостріший ризик фічі (`devils-advocate`, spec §1) — [ADR-0004](../adr/0004-prompt-plus-post-hoc-guard-for-rule-enforcement.md), [`sad.md §6` Flow 6/7](../sad.md#6-runtime-view).

## What

`rules.ts`: модель правила (категорія з 6 D-27 + опційний власний текст), перевірка на несуперечливість у межах тієї самої області дії (глобальне з глобальними, card-override — лише з правилами тієї самої картки, AC-14). `guard.ts`: post-hoc перевірка, чи чернетка відповіді порушує активне правило — сам системний промпт не гарантує дотримання (ADR-0004).

## Definition of Done

- [ ] Unit test: збереження правила з категорії, з власного тексту, з обох
- [ ] Unit test: card-override перевіряється лише проти правил тієї самої картки, не глобальних (і навпаки)
- [ ] Unit test: guard позначає чернетку, що порушує активне правило («не радь, якщо не питаю» + непрохана порада)
- [ ] lint + vet clean

## Notes

Перевізначення картки (AC-12) свідомо переважає глобальне правило саме на тій картці — це очікуваний намір, guard **не** позначає це як конфлікт.
