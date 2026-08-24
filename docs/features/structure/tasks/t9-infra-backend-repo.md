---
id: T9
title: "Infra: backend repository for structure + layout positions"
layer: "infra"
deps: ["T1", "T2"]
acs: ["AC-03", "AC-08", "AC-09", "AC-12"]
files_hint: ["plan/app/src/structure/infra/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T9 — Infra: backend repository for structure + layout positions

## Why

Читання/запис через `shared/storage/` заборонено для серверних даних — це прямий доступ бекенда до БД (D-24, [data-model.md](../data-model.md)).

## What

Репозиторій: `findStructureByOwner`, `upsertStructure`, `listActiveLayoutPositions`, `upsertLayoutPosition`, `closeLayoutPosition`. Кожен запит фільтрує за `owner_user_id` — жодного шляху обійти це (AC-03).

## Definition of Done

- [ ] Integration test проти локальної PostgreSQL: запит іншого власника ніколи не повертає чужий рядок
- [ ] Integration test: `upsertLayoutPosition` поважає частковий унікальний індекс (T2) — колізія повертає помилку БД, не мовчазний перезапис
- [ ] lint + vet clean

## Notes

Правило залежностей: `infra` не знає про HTTP — це шар нижче `ports` (T15-T18).
