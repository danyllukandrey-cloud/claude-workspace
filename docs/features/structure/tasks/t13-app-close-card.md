---
id: T13
title: "App: closeCard use-case"
layer: "app"
deps: ["T5", "T9", "T10"]
acs: ["AC-12", "AC-15"]
files_hint: ["plan/app/src/structure/app/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T13 — App: closeCard use-case

## Why

[sad.md Потік 6](../sad.md#6-runtime-view), [D-65](../../../DECISIONS.md#d-65) — закриття напрямку з опційним перенесенням метрик.

## What

Use-case: закриває позицію (T5/T9, статус `closed`, ніколи DELETE), для кожного запису `metricTransfers` викликає **зовнішню** доменну логіку `life-area-card` (інтеграційна точка, сама реалізація — поза цією фічею), пише подію `closed` через T10.

## Definition of Done

- [ ] Integration test: закриття без переносу — позиція `closed`, подія записана
- [ ] Integration test: закриття з переносом викликає інтеграційну точку `life-area-card` для кожного запису в `metricTransfers`
- [ ] Integration test: невалідна цільова картка (не існує / не належить власнику) повертає `structure.metric_transfer_target_invalid`, закриття НЕ відбувається (атомарно)
- [ ] lint + vet clean

## Notes

Сам перенос метрики — доменна логіка `life-area-card`, ще не написана (окрема фіча). Тут — лише виклик інтерфейсу; заглушка/мок до появи реальної реалізації.
