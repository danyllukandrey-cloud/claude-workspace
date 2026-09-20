---
id: T7
title: "use-case: прочитати активні пункти плану"
layer: "app"
deps: ["T3"]
acs: ["AC-08", "AC-11"]
files_hint: ["plan/app/src/plan-horizons/app/list-plan-items.ts", "plan/app/src/plan-horizons/app/list-plan-items.test.ts"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T7 — use-case: прочитати активні пункти плану

## Why

[AC-08/AC-11](../spec.md) — перегляд сторінки ПЛАН, з пунктами і без них (перший запуск — легітимний стан, не помилка).

## What

`listPlanItems(db, ownerUserId)` — повертає активні пункти, згруповані (чи сортовані) по горизонтах у порядку додавання.

## Definition of Done

- [ ] Юніт-тест: повертає пункти по трьох горизонтах у порядку `created_at`
- [ ] Юніт-тест: порожній результат для нового користувача — не помилка, порожній масив
- [ ] lint + vet чисто

## Notes

Незалежна від T2 (доменний шар тут не потрібен — читання без валідації).
