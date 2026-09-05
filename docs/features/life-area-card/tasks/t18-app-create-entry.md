---
id: T18
title: "App: createEntry use-case"
layer: "app"
deps: ["T7", "T8", "T10"]
acs: ["AC-01", "AC-06", "AC-11"]
files_hint: ["plan/app/src/cards/life-area-card/app/create-entry.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T18 — App: createEntry use-case

## Why

Оркеструє T7 (статус) + T8 (конфлікт) + T10 (запис) — [`sad.md §6` Flow 3/7](../sad.md#6-runtime-view). Викликається `agent`'s `confirm`, не напряму користувачем.

## What

Щасливий шлях пише `confirmed` (AC-01). Виявлений конфлікт (T8) пише `pending` на обидва записи (AC-06); той самий статус, якщо агент був недоступний (AC-11) — причина конфлікту не зберігається в самому записі, лише в `pending`-статусі.

## Definition of Done

- [x] Integration test: щасливий шлях → `confirmed`, прогрес оновлюється
- [x] Integration test: конфліктний запис → обидва `pending`, прогрес не змінюється
- [x] lint + vet clean

## Notes

Критик знайшов blocker, виправлено в тому ж коміті: не було перевірки, що `metricBlockId` справді належить переданій картці — власник валідної картки міг підсунути чужий/довільний блок (діра в межі авторизації AC-04). Додано `listMetricBlocksByCard(cardId).find()`, той самий підхід, що T17. Заразом виправлено should-fix (конфлікт враховував уже `rejected` записи) і вирівняно код помилки на контракт (`metric_block.not_found`, єдиний код для обох 404-причин цього ендпоінту).
