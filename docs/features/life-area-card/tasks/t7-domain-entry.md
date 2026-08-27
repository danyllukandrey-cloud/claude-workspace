---
id: T7
title: "Domain: entry status model"
layer: "domain"
deps: []
acs: ["AC-01", "AC-06", "AC-11", "AC-12"]
files_hint: ["plan/app/src/cards/life-area-card/domain/entry.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T7 — Domain: entry status model

## Why

Статуси запису — [ADR-0002](../adr/0002-hold-unconfirmed-records-pending.md), [`sad.md §5`](../sad.md#5-building-block-view) `domain/entry.ts`.

## What

Переходи `pending -> confirmed`/`pending -> rejected`. `confirmed` — щасливий шлях (AC-01). `rejected` — виправлення/відкат (AC-12) чи вирішений конфлікт/недоступність агента (AC-06/AC-11); ніколи фізичне видалення.

## Definition of Done

- [ ] Unit test: щасливий шлях створює `confirmed`
- [ ] Unit test: конфліктний/неперевірений запис створюється `pending`, не входить у прогрес (T6 його виключає)
- [ ] Unit test: `rejected` лишає рядок доступним для історії (AC-12)
- [ ] lint + vet clean

## Notes

Модель не знає, ЧОМУ запис `pending` (конфлікт пристроїв чи недоступність агента) — причину несе `card.ts`/викликач; тут лише статус і переходи.
