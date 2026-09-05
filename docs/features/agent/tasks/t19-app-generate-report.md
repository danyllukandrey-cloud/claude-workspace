---
id: T19
title: "App (agent-worker): generate-report use-case"
layer: "app"
deps: ["T11", "T15"]
acs: ["AC-11"]
files_hint: ["plan/app/src/agent-worker/app/generate-report.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T19 — App (agent-worker): generate-report use-case

## Why

«Чий звіт зараз» → пасивний запис — [`sad.md §5`](../sad.md#5-building-block-view) `agent-worker/app/generate-report.ts`, D-70.

## What

Для кожного due-періоду формує текст звіту (тижневий: сирий підсумок; місячний: + прив'язка до зон картини світу; квартальний: + текстова пропозиція перегляду пріоритетів) і передає T15 на запис. Ніколи нічого не надсилає й нікого не перериває (D-43).

## Definition of Done

- [ ] Integration test: тижневий/місячний/квартальний звіт має відповідний акцент у `content`
- [ ] Integration test: use-case не викликає жодного каналу сповіщення (лише запис через T15)
- [ ] lint + vet clean

## Notes

Квартальний акцент («текстова пропозиція переглянути картину світу») — це саме текст у самому звіті, не окрема дія агента чи нагадування (D-70 уточнює D-40).
