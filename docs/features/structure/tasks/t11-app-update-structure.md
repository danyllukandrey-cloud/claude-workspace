---
id: T11
title: "App: updateStructure use-case"
layer: "app"
deps: ["T4", "T9"]
acs: ["AC-10", "AC-11", "AC-11b"]
files_hint: ["plan/app/src/structure/app/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T11 — App: updateStructure use-case

## Why

Оркестрація домену (T4) й інфраструктури (T9) для запису декларації/способу розкладки — [sad.md Потік 3](../sad.md#6-runtime-view).

## What

Use-case: приймає часткове оновлення (`declaration?`, `layoutMode?`), зберігає через T9. Якщо `layoutMode` змінюється на нове значення — застосовує «план скидання» з T4 до КОЖНОЇ активної позиції **в одній транзакції** (AC-11b).

## Definition of Done

- [ ] Integration test: оновлення лише декларації не чіпає розкладку
- [ ] Integration test: зміна `layoutMode` на нове значення скидає всі активні позиції в базовий порядок, атомарно (усі або жодна)
- [ ] Integration test: те саме значення `layoutMode` (без зміни) не запускає скидання
- [ ] lint + vet clean

## Notes

Транзакційність — обов'язкова: часткове скидання (частина карток скинута, частина ні) неприпустиме.
