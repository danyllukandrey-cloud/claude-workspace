---
id: T46
title: "Tests: cascading account deletion across features"
layer: "tests"
deps: ["T39"]
acs: ["AC-17"]
files_hint: ["plan/backend/src/agent/"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T46 — Tests: cascading account deletion across features

## Why

Видалення акаунта охоплює 3 фічі (agent/life-area-card/structure), не лише agent — це якраз те, що робить його ризикованим і вартим окремого e2e-тесту, а не лише unit-тесту T39.

## What

Засіяти користувача картками, декларацією Структури, правилами й пам'яттю; видалити акаунт; перевірити нуль рядків для цього `user_id` в усіх трьох фічах.

## Definition of Done

- [ ] E2e test: після видалення — 0 рядків у `agent` (усі 6 таблиць), `life-area-card.card` (+ каскад на `metric_block`/`entry`), `structure.structure` (+ каскад на `structure_layout_position`)
- [ ] lint + vet clean
