---
id: T3
title: "postgres-repo для plan_item (CRUD + non-disclosure)"
layer: "infra"
deps: ["T1", "T2"]
acs: ["AC-01", "AC-04", "AC-07", "AC-08"]
files_hint: ["plan/app/src/plan-horizons/infra/postgres-repo.ts", "plan/app/src/plan-horizons/infra/postgres-repo.integration.test.ts"]
owner: "Андрій + Claude Code"
estimate: "M"
status: "todo"
---

# T3 — postgres-repo для plan_item (CRUD + non-disclosure)

## Why

Прямі SQL-запити без ORM — той самий шар, що `card`/`structure`'s `postgres-repo.ts` ([sad.md §5](../sad.md)).

## What

Функції `insertPlanItem`, `listActivePlanItems(ownerUserId)`, `updatePlanItem`, `softDeletePlanItem` — кожна фільтрує за `owner_user_id`, повертає `null`/порожньо для чужих записів (non-disclosure, AC-07), не підтверджуючи різницю між «не існує» й «належить іншому».

## Definition of Done

- [ ] Інтеграційний тест: round-trip create → list → update → soft-delete проти реальної Neon
- [ ] Інтеграційний тест: читання/зміна чужого `plan_item` повертає порожньо, без винятку
- [ ] `EXPLAIN`-перевірка, що `idx_plan_item_owner_active` реально використовується для списку
- [ ] lint + vet чисто

## Notes

Той самий `Db`-інтерфейс (`query<T>`), що в усіх сусідніх модулях — жодної нової абстракції.
