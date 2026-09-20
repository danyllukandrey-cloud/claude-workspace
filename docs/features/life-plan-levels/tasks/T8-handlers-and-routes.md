---
id: T8
title: "Express-обробники + реєстрація 4 маршрутів у server/app.ts"
layer: "ports"
deps: ["T4", "T5", "T6", "T7"]
acs: ["AC-01", "AC-02", "AC-03", "AC-03b", "AC-04", "AC-05", "AC-07", "AC-08", "AC-11"]
files_hint: ["plan/app/src/plan-horizons/ports/plan-item-handlers.ts", "plan/app/src/plan-horizons/ports/plan-item-handlers.test.ts", "plan/app/server/app.ts"]
owner: "Андрій + Claude Code"
estimate: "M"
status: "todo"
---

# T8 — Express-обробники + реєстрація маршрутів

## Why

Реалізує контракт [contracts/openapi.yaml](../contracts/openapi.yaml) дослівно — 4 ендпоінти на `/api/v1/plan-items`.

## What

Обробники `listPlanItemsHandler`/`createPlanItemHandler`/`updatePlanItemHandler`/`deletePlanItemHandler`, маппінг доменних помилок на `{code, message}` (`plan_item.text_required`, `plan_item.not_found`), реєстрація в `server/app.ts` за прецедентом `structure`'s ендпоінтів (DI `recordAction`, Bearer-middleware вже глобальний).

## Definition of Done

- [ ] Тест на кожен з 4 ендпоінтів: happy path точно за `openapi.yaml` (статус-код, форма тіла)
- [ ] Тест на кожен помилковий код з контракту (422, 404, 400, 413)
- [ ] Курсорна пагінація `GET /plan-items` відповідає `{items, has_next, has_prev, next_cursor}`
- [ ] lint + vet чисто

## Notes

Той самий файл `server/app.ts`, що й реєстрація структури/карток/агента — очікується конфлікт рядків з іншими фічами лише якщо вони одночасно редагують той самий файл; ця задача йде після T4-T7, тож послідовно з ними, паралельно з нічим іншим у цій фічі.
