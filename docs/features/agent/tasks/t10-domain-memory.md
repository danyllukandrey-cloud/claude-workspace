---
id: T10
title: "Domain: hybrid memory model (short-term window + long-term facts)"
layer: "domain"
deps: []
acs: ["AC-06", "AC-09", "AC-15"]
files_hint: ["plan/app/src/agent/domain/memory.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T10 — Domain: hybrid memory model

## Why

Гібридна пам'ять (D-26) — [`sad.md §5`](../sad.md#5-building-block-view) `domain/memory.ts`, [`sad.md §6` Flow 11/12](../sad.md#6-runtime-view).

## What

Коротке сире вікно, одиниця «сесія» = календарний день (D-26). Довгострокові факти з пошуком за темою. Прибирання імені третьої особи перед записом факту, лишається лише вимірюване число (AC-06, §8 Privacy) — «біг з Марією 5 км» → «5 км».

## Definition of Done

- [ ] Unit test: коротке вікно повертає лише повідомлення того самого календарного дня
- [ ] Unit test: пошук довгострокового факту за темою повертає найновіший активний
- [ ] Unit test: текст із чужим ім'ям зберігається без імені, лише число
- [ ] lint + vet clean

## Notes

`status: 'deleted'` (м'яке видалення факту) — фільтрація тут, на рівні домену, не лише в SQL-запиті репо.
