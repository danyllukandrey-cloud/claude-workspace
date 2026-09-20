---
id: T1
title: "Промоутити міграцію plan_item у живе дерево"
layer: "migration"
deps: []
acs: ["AC-01", "AC-02", "AC-03", "AC-03b", "AC-04", "AC-07", "AC-08", "AC-11"]
files_hint: ["docs/features/life-plan-levels/migrations/01_create_plan_item.up.sql", "docs/features/life-plan-levels/migrations/01_create_plan_item.down.sql", "plan/app/migrations/", "plan/app/MIGRATIONS.md"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T1 — Промоутити міграцію plan_item у живе дерево

## Why

Застейджена міграція з [data-model.md](../data-model.md) ще не в живому дереві `plan/app/migrations/`. Основа для всіх наступних задач.

## What

Скопіювати `01_create_plan_item.{up,down}.sql` у `plan/app/migrations/` з реальним timestamp-іменем (за конвенцією `plan/app/scripts/promote-migrations.mjs`), додати рядок у `plan/app/MIGRATIONS.md` з SHA256-хешем застейдженого файлу.

## Definition of Done

- [ ] Міграція застосована й відкочена проти реальної Neon (`up` → `down` → `up`)
- [ ] Рядок у `plan/app/MIGRATIONS.md` з правильним хешем
- [ ] `npm run migrate` (чи еквівалент) проходить чисто
- [ ] lint + vet чисто

## Notes

Той самий скрипт промоуту, що вже використовувався для 9 попередніх міграцій продукту — нічого нового вигадувати не треба.
