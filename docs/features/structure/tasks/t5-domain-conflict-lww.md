---
id: T5
title: "Domain: layout position conflict + last-write-wins resolution"
layer: "domain"
deps: []
acs: ["AC-02", "AC-08", "AC-12"]
files_hint: ["plan/app/src/structure/domain/layout.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T5 — Domain: layout position conflict + last-write-wins resolution

## Why

[ADR-0002](../adr/0002-resolve-structure-sync-conflicts-last-write-wins.md), [D-62](../../../DECISIONS.md#d-62) (одна клітинка = одна картка), [D-66](../../../DECISIONS.md#d-66) (м'яке закриття).

## What

Чиста функція: дано дві позиції картки з різними часовими мітками — повернути переможця (пізніша виграє, без явного прапорця конфлікту). Чиста функція: дано цільову клітинку й перелік активних позицій — виявити колізію в розкладці «за логікою» (AC-02). Чиста функція: перехід позиції в статус `closed` (ніколи не видаляє рядок, D-66).

## Definition of Done

- [ ] Unit test: пізніша мітка часу перемагає, різниця в мілісекундах теж коректно порівнюється
- [ ] Unit test: колізія виявляється лише в розкладці «за логікою», не у вільній чи одна-картка
- [ ] Unit test: перехід у `closed` не змінює жодне інше поле рядка, окрім статусу
- [ ] lint + vet clean

## Notes

DB-рівня частковий унікальний індекс (T2) — друга лінія захисту, не єдина; ця задача — перша (валідація до запиту).
