---
id: T10
title: "Infra: history repository (write + asOf read)"
layer: "infra"
deps: ["T3"]
acs: ["AC-07", "AC-15"]
files_hint: ["plan/app/src/structure/infra/history-repo.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T10 — Infra: history repository (write + asOf read)

## Why

Літопис (`structure_history_event`) — звичайний репозиторій-модуль у тій самій базі мінімального бекенда, що й `structure`/`structure_layout_position`/`card` ([D-113](../../../DECISIONS.md#d-113), скасовує [ADR-0004](../adr/0004-separate-service-for-structure-history-log.md)). Окремого сервісу й окремої бази більше нема — читання/запис ідуть тим самим шляхом, що й решта інфра-шару Структури (T9).

## What

Репозиторій: `recordEvent(structureId, cardId, eventType, detail)` і `getLayoutAsOf(structureId, asOf)` — прямі SQL-запити до `structure_history_event` в тій самій базі, без HTTP-виклику й без клієнта до окремого сервісу.

## Definition of Done

- [ ] Integration test: подія записується, потім читається назад через `asOf` (та сама чи пізніша дата)
- [ ] Integration test: `asOf` у минулому до першої події повертає порожній результат, не помилку
- [ ] lint + vet clean

## Notes

Відкрите питання «поведінка при недоступності сервісу» ([`sad.md §11`](../sad.md#11-risks-and-technical-debt)) тепер неактуальне — окремого сервісу, здатного стати недоступним незалежно від бекенда, більше нема ([D-113](../../../DECISIONS.md#d-113)).
