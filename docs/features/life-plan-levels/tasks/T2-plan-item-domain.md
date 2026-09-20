---
id: T2
title: "Доменна сутність PlanItem + інваріанти"
layer: "domain"
deps: []
acs: ["AC-01", "AC-02", "AC-03", "AC-03b"]
files_hint: ["plan/app/src/plan-horizons/domain/plan-item.ts", "plan/app/src/plan-horizons/domain/plan-item.test.ts"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T2 — Доменна сутність PlanItem + інваріанти

## Why

Чисті доменні правила з [spec §AC-01/AC-02/AC-03/AC-03b](../spec.md) і [data-model.md](../data-model.md) `plan_item` — без залежності від бази чи HTTP, як і в `card`/`structure`.

## What

Тип `PlanItem` (id, ownerUserId, horizon, planText, done, createdAt, updatedAt), тип `PlanHorizon` = `'tactical' | 'operational' | 'strategic'`. Чисті функції: `createPlanItem` (валідує непорожній текст), `toggleDone` (реверсивний), перевірка непорожності тексту (trim).

## Definition of Done

- [ ] Юніт-тест: створення з порожнім/лише-пробільним текстом відхиляється
- [ ] Юніт-тест: `toggleDone` працює в обидва боки
- [ ] Юніт-тест: `horizon` приймає лише 3 фіксовані значення
- [ ] lint + vet чисто

## Notes

Не залежить від жодної іншої задачі — можна робити паралельно з T1.
