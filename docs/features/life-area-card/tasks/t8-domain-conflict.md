---
id: T8
title: "Domain: near-simultaneous conflict detection"
layer: "domain"
deps: []
acs: ["AC-06"]
files_hint: ["plan/app/src/cards/life-area-card/domain/conflict.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T8 — Domain: near-simultaneous conflict detection

## Why

Виявлення близького за часом запису з іншого пристрою — [`sad.md §4`](../sad.md#4-solution-strategy), [`sad.md §6` Flow 7](../sad.md#6-runtime-view).

## What

Порівнює новий запис із наявними `pending`/`confirmed` записами того самого блоку-метрики за коротким часовим вікном (точне число — `sad.md §11` відкрите питання, TBD-параметр функції, не хардкод). Різні `source_device_id` у межах вікна → конфлікт.

## Definition of Done

- [x] Unit test: два записи того самого блоку з різних пристроїв у межах вікна → конфлікт
- [x] Unit test: той самий випадок поза вікном → не конфлікт
- [x] Unit test: той самий пристрій, будь-який інтервал → не конфлікт (це не conflict-кейс, а звичайне уточнення)
- [x] lint + vet clean

## Notes

Точне число вікна — параметр, не константа в коді; узгодити з Андрієм при `implement` (`sad.md §11`).
