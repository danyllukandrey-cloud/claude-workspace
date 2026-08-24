---
id: T24
title: "Wiring: register Структура module in app-shell"
layer: "wiring"
deps: ["T20", "T21", "T22", "T23"]
acs: []
files_hint: ["plan/app/src/structure/index.ts", "plan/app/src/app/main.tsx"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T24 — Wiring: register Структура module in app-shell

## Why

[sad.md §5](../sad.md#5-building-block-view) — `index.ts`: реєстрація Структури в app-shell (singleton, не картка) + 3 навігаційні вкладки.

## What

`index.ts` експортує 3 екрани (Декларація/Схема/Літопис-Аналітика — «Картки» поза межами фічі), підключає до нижнього меню в `main.tsx`.

## Definition of Done

- [ ] Застосунок піднімається, усі 3 вкладки Структури доступні з нижнього меню
- [ ] Навігація між вкладками — один екран за раз, без паралельних вікон ([ux-flows.md §Platform decisions](../ux-flows.md#platform-decisions))
- [ ] lint + vet clean

## Notes

Немає власного AC — суто інтеграційна задача, збирає докупи T20-T23.
