---
id: T25
title: "Tests: cross-cutting integration (AC-05 + offline sync)"
layer: "tests"
deps: ["T24"]
acs: ["AC-05"]
files_hint: ["plan/app/src/structure/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T25 — Tests: cross-cutting integration (AC-05 + offline sync)

## Why

[sad.md Потік 10](../sad.md#6-runtime-view) (AC-05, крос-фічевий сценарій) і [spec.md §6 NFR](../spec.md#6-non-functional-requirements) (офлайн-запис) — жоден з цих сценаріїв не покритий тестом однієї окремої задачі, бо перетинає межу `life-area-card` ↔ `structure`.

## What

E2e-тест 1: виправити/відкотити запис на картці (`life-area-card` AC-12) → перемкнутись на вкладку Літопис-Аналітика → перевірити, що число оновилось, без розбіжності (AC-05). E2e-тест 2: перемістити картку офлайн → перевірити миттєве збереження локально → підключити мережу → перевірити синхронізацію й вирішення конфлікту, якщо є (ADR-0002).

## Definition of Done

- [ ] Обидва e2e-сценарії проходять на локальному середовищі
- [ ] Тест підключає СПРАВЖНІЙ код `life-area-card` (не мок) для AC-05 — це саме крос-фічева перевірка
- [ ] lint + vet clean

## Notes

Ця задача — фінальна ланка DAG; якщо щось із T1-T24 приховано зламане, тут це виявиться.
