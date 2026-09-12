---
id: T46
title: "Tests: cascading account deletion across features"
layer: "tests"
deps: ["T39"]
acs: ["AC-17"]
files_hint: ["plan/app/src/agent/"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T46 — Tests: cascading account deletion across features

## Why

Видалення акаунта охоплює 3 фічі (agent/life-area-card/structure), не лише agent — це якраз те, що робить його ризикованим і вартим окремого e2e-тесту, а не лише unit-тесту T39.

## What

Засіяти користувача картками, декларацією Структури, правилами й пам'яттю; видалити акаунт; перевірити нуль рядків для цього `user_id` в усіх трьох фічах.

## Definition of Done

- [x] E2e test: після видалення — 0 рядків у `agent` (усі 6 таблиць + `sync_resource`, T31 — див. примітку в тесті щодо розбіжності з формулюванням «6»), `life-area-card.card` (+ каскад на `metric_block`/`entry`/`card_lifecycle_event`), `structure.structure` (+ каскад на `structure_layout_position`/`structure_history_event`)
- [x] lint + vet clean

**Виконано:** `plan/app/src/agent/app/delete-account-cascade.e2e.test.ts` -- будує з міграцій усіх трьох фіч FK-граф (`FOREIGN KEY ... ON DELETE ...`) в оперативній пам'яті (пісочниця без живої БД/`.env`) і запускає проти нього справжній `deleteAccount` (T39). Розбіжність задокументована в тесті: DoD/tasks.json кажуть «6 таблиць», але `sync_resource` (T31, agent/08) теж каскадить на `user_id` -- фактично 7; не виправлено тут мовчки, лишено як відкрите питання для власника.
