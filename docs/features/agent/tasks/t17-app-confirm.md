---
id: T17
title: "App: confirm use-case"
layer: "app"
deps: ["T8", "T13"]
acs: ["AC-02", "AC-03"]
files_hint: ["plan/app/src/agent/app/confirm.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T17 — App: confirm use-case

## Why

Мовчазного запису не буває (D-30) — запис стається лише після явного підтвердження — [`sad.md §5`](../sad.md#5-building-block-view) `app/confirm.ts`, [`sad.md §6` Flow 1](../sad.md#6-runtime-view).

## What

Приймає `proposalId`, перевіряє, що пропозиція активна й належить викликачу, делегує запис події в `life-area-card` (крос-фічевий виклик, поза цим DAG), переводить пропозицію в `confirmed`, пише подію в аудит-лог.

## Definition of Done

- [ ] Integration test: підтвердження активної пропозиції записує подію й оновлює статус
- [ ] Integration test: підтвердження неактивної (`confirmed`/`dropped`) чи чужої пропозиції відхиляється
- [ ] lint + vet clean

## Notes

Сам запис у картку — виклик доменної логіки `life-area-card`, яку цей use-case не переписує (spec.md §3 Non-goal).
