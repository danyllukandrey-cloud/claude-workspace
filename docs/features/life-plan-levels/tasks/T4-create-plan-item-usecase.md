---
id: T4
title: "use-case: створити пункт плану"
layer: "app"
deps: ["T2", "T3"]
acs: ["AC-01", "AC-02", "AC-05"]
files_hint: ["plan/app/src/plan-horizons/app/create-plan-item.ts", "plan/app/src/plan-horizons/app/create-plan-item.test.ts"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T4 — use-case: створити пункт плану

## Why

Оркеструє домен ([T2](./T2-plan-item-domain.md)) + репозиторій ([T3](./T3-postgres-repo.md)) + опційний запис у Лог дій ([AC-05](../spec.md)) — той самий шаблон DI, що `createCard`.

## What

`createPlanItem(db, ownerUserId, { horizon, planText }, recordAction?)` — валідує текст через доменну функцію, зберігає, за наявності `recordAction` пише подію людською мовою («Додано пункт плану»).

## Definition of Done

- [ ] Юніт-тест: успішне створення з валідним текстом
- [ ] Юніт-тест: порожній/пробільний текст відхиляється до звернення до бази
- [ ] Юніт-тест: `recordAction` викликається з правильним `ownerUserId`, коли переданий
- [ ] lint + vet чисто
