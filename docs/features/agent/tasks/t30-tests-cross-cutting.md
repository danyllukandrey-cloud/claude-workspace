---
id: T30
title: "Tests: cross-cutting integration (cross-user isolation + Claude-unavailable)"
layer: "tests"
deps: ["T29"]
acs: ["AC-06"]
files_hint: ["plan/backend/src/agent/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T30 — Tests: cross-cutting integration

## Why

QG-3 (конфіденційність довгострокової пам'яті) і QG-2 (accepted debt без retry) — [`sad.md §10`](../sad.md#10-quality-requirements), обидва завершальні перевірки, що охоплюють кілька модулів разом, а не один шар.

## What

E2e: користувач A автентифікований, ніколи не бачить пропозицій/правил/фактів/звітів користувача B — жодним ендпоінтом (`AC-06` тест на крос-користувацьку ізоляцію, `sad.md §10 QG-3`). Окремо: заглушений збій Claude API повертає `503`, текст користувача не втрачається (Flow 2).

## Definition of Done

- [ ] E2e test: повний прохід — користувач A створює пропозицію/правило/факт → користувач B жодним запитом їх не бачить
- [ ] E2e test: Claude API недоступний → `503`, `POST /messages` можна повторити з тим самим текстом без помилки дублювання
- [ ] lint + vet clean

## Notes

Це остання задача перед `/sdd:plan-tests agent` — саме тут зводяться докупи наскрізні гарантії, які жоден окремий шар не перевіряє сам.
