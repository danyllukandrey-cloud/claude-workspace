---
id: T5
title: "use-case: оновити текст і/чи чекбокс"
layer: "app"
deps: ["T2", "T3"]
acs: ["AC-03", "AC-03b", "AC-05"]
files_hint: ["plan/app/src/plan-horizons/app/update-plan-item.ts", "plan/app/src/plan-horizons/app/update-plan-item.test.ts"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T5 — use-case: оновити текст і/чи чекбокс

## Why

Один use-case для двох незалежних правок ([AC-03/AC-03b](../spec.md) чекбокс, частина [AC-04](../spec.md) — непорожнє редагування тексту), обидва мають лишати слід у Лозі дій (AC-05).

## What

`updatePlanItem(db, ownerUserId, planItemId, { planText?, done? }, recordAction?)` — якщо переданий `planText`, валідує непорожність (та сама правило, що при створенні); `done` приймає будь-яке булеве значення без обмежень (реверсивний тумблер).

## Definition of Done

- [ ] Юніт-тест: `done` перемикається в обидва боки
- [ ] Юніт-тест: оновлення тексту на порожній/пробільний відхиляється (це НЕ шлях видалення — див. [T6](./T6-delete-plan-item-usecase.md))
- [ ] Юніт-тест: `recordAction` викликається для обох типів зміни
- [ ] lint + vet чисто
