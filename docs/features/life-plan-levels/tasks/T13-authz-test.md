---
id: T13
title: "Тест: авторизація і non-disclosure на всіх 4 ендпоінтах"
layer: "tests"
deps: ["T8"]
acs: ["AC-07"]
files_hint: ["plan/app/src/plan-horizons/ports/plan-item-handlers.test.ts"]
owner: "Андрій + Claude Code"
estimate: "S"
status: "todo"
---

# T13 — Тест: авторизація і non-disclosure

## Why

[AC-07](../spec.md) — та сама наскрізна перевірка власника, що в `structure`/`life-area-card`, тут перевіряється прицільно по всіх 4 ендпоінтах цього контракту.

## What

Наскрізний тест: користувач A створює пункт, користувач B намагається прочитати/оновити/видалити його — очікується `plan_item.not_found` (404) на кожному з трьох write/read-ендпоінтів щодо чужого `planItemId`.

## Definition of Done

- [ ] Тест на GET (список показує лише власні пункти)
- [ ] Тест на PATCH чужого пункту → 404
- [ ] Тест на DELETE чужого пункту → 404
- [ ] lint + vet чисто
