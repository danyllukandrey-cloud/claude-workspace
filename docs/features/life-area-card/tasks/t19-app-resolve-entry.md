---
id: T19
title: "App: resolveEntry use-case"
layer: "app"
deps: ["T7", "T8", "T10"]
acs: ["AC-06", "AC-11", "AC-12"]
files_hint: ["plan/app/src/cards/life-area-card/app/resolve-entry.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T19 — App: resolveEntry use-case

## Why

Три випадки одного механізму (`confirmed`/`rejected`) — [`sad.md §6` Flow 7/11](../sad.md#6-runtime-view). Викликається `agent` API, не напряму користувачем.

## What

Вирішує конфлікт (дублікат/окремий, AC-06), підтверджує накопичений `pending` після повернення агента (AC-11), або виправляє/відкочує запис з історії (AC-12) — в усіх трьох випадках переводить `entry.status` через T7, ніколи не видаляє рядок.

## Definition of Done

- [x] Integration test: вирішення конфлікту → один `confirmed`, інший `rejected`, прогрес перераховується
- [x] Integration test: підтвердження pending-запису після повернення агента → `confirmed`
- [x] Integration test: виправлення з історії → `rejected`, запис лишається читомим
- [x] lint + vet clean

## Notes

Критик: PASS. Should-fix (`ResolveEntryInput.cardId` не мав відповідника в locked `PATCH /entries/{entryId}`) записано [ISS-32](../../../ISSUES.md), закрито того ж дня тим самим підходом, що ISS-30 (T17): `findEntryById` у `postgres-repo.ts`, `cardId` виводиться з `entry.cardId`, не приймається від викликача. Заразом [ISS-36](../../../ISSUES.md) — поле входу перейменовано з `resolution: 'confirm'/'reject'` на `status: 'confirmed'/'rejected'`, точно за `EntryResolve` контракту.
