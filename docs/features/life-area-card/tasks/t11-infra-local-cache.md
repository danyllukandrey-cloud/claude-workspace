---
id: T11
title: "Infra: local offline cache"
layer: "infra"
deps: []
acs: []
files_hint: ["plan/app/src/cards/life-area-card/infra/local-cache.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T11 — Infra: local offline cache

## Why

Офлайн-доступність читання й запису — [`spec.md §6` NFR](../spec.md#6-non-functional-requirements), [ADR-0001](../adr/0001-recompute-progress-from-raw-events.md).

## What

Кеш сирих подій картки (не готового прогресу) через `shared/storage/` (~2 МБ, architecture-map.md). PWA виконує **той самий** `progress.ts` (T6) над кешем локально, не другу реалізацію.

## Definition of Done

- [x] Integration test: картка й історія відкриваються з кешу без мережі
- [x] Integration test: запис офлайн приймається, лишається «в очікуванні» до підключення й підтвердження
- [x] Integration test: локальний розрахунок прогресу з кешу дає той самий результат, що бекенд над тими самими подіями
- [x] lint + vet clean

## Notes

Жодного `acs` — покриває NFR `spec.md §6`, не окремий acceptance criterion.
