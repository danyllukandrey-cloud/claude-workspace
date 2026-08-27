---
id: T17
title: "App: transferMetricBlock use-case"
layer: "app"
deps: ["T9", "T10"]
acs: ["AC-14", "AC-15"]
files_hint: ["plan/app/src/cards/life-area-card/app/transfer-metric-block.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T17 — App: transferMetricBlock use-case

## Why

Прийняти метрику, перенесену із закритої картки — [`sad.md §6` Flow 12](../sad.md#6-runtime-view), викликається `structure` API.

## What

Переносить блок-метрику й **усю** її історію записів у цю картку. Перевіряє колізію назви+одиниці з наявними блоками; без `newLabel` при колізії — відхиляє (AC-15), не зливає мовчки.

## Definition of Done

- [ ] Integration test: перенесення без колізії — блок + усі записи в новій картці, історія й прогрес враховують перенесене (AC-14)
- [ ] Integration test: колізія назви+одиниці без `newLabel` відхиляється
- [ ] Integration test: колізія з `newLabel` завершує перенесення під новою назвою
- [ ] lint + vet clean
