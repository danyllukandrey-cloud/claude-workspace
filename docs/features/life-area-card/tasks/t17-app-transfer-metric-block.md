---
id: T17
title: "App: transferMetricBlock use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-14", "AC-15"]
files_hint: ["plan/app/src/cards/life-area-card/app/transfer-metric-block.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T17 — App: transferMetricBlock use-case

## Why

Прийняти метрику, перенесену із закритої картки — [`sad.md §6` Flow 12](../sad.md#6-runtime-view), викликається `structure` API.

## What

Переносить блок-метрику й **усю** її історію записів у цю картку. Перевіряє колізію назви+одиниці з наявними блоками; без `newLabel` при колізії — відхиляє (AC-15), не зливає мовчки.

## Definition of Done

- [x] Integration test: перенесення без колізії — блок + усі записи в новій картці, історія й прогрес враховують перенесене (AC-14)
- [x] Integration test: колізія назви+одиниці без `newLabel` відхиляється
- [x] Integration test: колізія з `newLabel` завершує перенесення під новою назвою
- [x] lint + vet clean

## Notes

Критик (окремий агент, читав diff) знайшов blocker, виправлено в тому ж коміті: код помилки колізії розходився з уже зафіксованим `contracts/openapi.yaml` (`metric_block.label_unit_collision` замість документованого `metric_block.name_collision`) — вирівняно на контракт.

Критик знайшов ще одну прогалину, НЕ виправлену тут (записано [ISS-30](../../../ISSUES.md)): сигнатура вимагає `sourceCardId`, якого немає в `MetricBlockTransferRequest` контракту — майбутньому T21/T22 нема звідки його взяти без нового репо-lookup чи зміни контракту. Self-transfer edge case (`sourceCardId === targetCardId`) теж не оброблено — [ISS-31](../../../ISSUES.md).
