---
id: T18
title: "App: ask-agent orchestration (Claude call + guard check)"
layer: "app"
deps: ["T9", "T12"]
acs: ["AC-07"]
files_hint: ["plan/app/src/agent/app/ask-agent.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T18 — App: ask-agent orchestration

## Why

Оркеструє виклик Claude API + guard-перевірку — [`sad.md §5`](../sad.md#5-building-block-view) `app/ask-agent.ts`, [ADR-0004](../adr/0004-prompt-plus-post-hoc-guard-for-rule-enforcement.md).

## What

Читає активні правила (T9), формує системний промпт, звертається до Claude (T12), прогонятиме чернетку відповіді через guard (T9). Якщо порушення — одна повторна спроба без забороненого вмісту; результат перевірки (пройшла/провалилась) повертається для аудит-логу (T16 його записує).

## Definition of Done

- [ ] Integration test: чернетка, що порушує активне правило, відкидається й формується повторний запит
- [ ] Integration test: результат guard-перевірки (пройшла/провалилась) присутній у відповіді use-case
- [ ] Тест на цільову точність AC-07 (§6 NFR ≥95%, уточнення 2026-08-27) на реалістичному наборі правил і повідомлень — не лише один функціональний кейс
- [ ] lint + vet clean

## Notes

Лише **одна** повторна спроба (без циклу) — задокументований accepted debt (`sad.md §11`): друга спроба теж без гарантії проходження guard, звідси й нефіксовані 100% точності.
