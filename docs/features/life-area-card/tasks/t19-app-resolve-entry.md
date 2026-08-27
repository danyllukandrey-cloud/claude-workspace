---
id: T19
title: "App: resolveEntry use-case"
layer: "app"
deps: ["T7", "T8", "T10"]
acs: ["AC-06", "AC-11", "AC-12"]
files_hint: ["plan/app/src/cards/life-area-card/app/resolve-entry.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T19 — App: resolveEntry use-case

## Why

Три випадки одного механізму (`confirmed`/`rejected`) — [`sad.md §6` Flow 7/11](../sad.md#6-runtime-view). Викликається `agent` API, не напряму користувачем.

## What

Вирішує конфлікт (дублікат/окремий, AC-06), підтверджує накопичений `pending` після повернення агента (AC-11), або виправляє/відкочує запис з історії (AC-12) — в усіх трьох випадках переводить `entry.status` через T7, ніколи не видаляє рядок.

## Definition of Done

- [ ] Integration test: вирішення конфлікту → один `confirmed`, інший `rejected`, прогрес перераховується
- [ ] Integration test: підтвердження pending-запису після повернення агента → `confirmed`
- [ ] Integration test: виправлення з історії → `rejected`, запис лишається читомим
- [ ] lint + vet clean
