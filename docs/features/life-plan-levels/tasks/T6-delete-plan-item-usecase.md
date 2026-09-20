---
id: T6
title: "use-case: м'яко видалити пункт"
layer: "app"
deps: ["T2", "T3"]
acs: ["AC-04", "AC-05"]
files_hint: ["plan/app/src/plan-horizons/app/delete-plan-item.ts", "plan/app/src/plan-horizons/app/delete-plan-item.test.ts"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T6 — use-case: м'яко видалити пункт

## Why

[AC-04](../spec.md) — позначає `status: removed`, ніколи фізично не видаляє, той самий шаблон, що `archive-metric-block` у `life-area-card`.

## What

`deletePlanItem(db, ownerUserId, planItemId, recordAction?)` — оновлює `status = 'removed'`, за наявності `recordAction` пише подію.

## Definition of Done

- [ ] Юніт-тест: після виклику пункт відсутній у `listActivePlanItems`
- [ ] Юніт-тест: рядок технічно лишається в базі (не DELETE FROM)
- [ ] Юніт-тест: `recordAction` викликається
- [ ] lint + vet чисто
