---
id: T34
title: "App: listCards with status filter (archived view)"
layer: "app"
deps: ["T10"]
acs: ["AC-18"]
files_hint: ["plan/app/src/cards/life-area-card/app/list-cards.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T34 — App: listCards with status filter (archived view)

## Why

Перегляд архіву — [spec.md AC-18](../spec.md#5-acceptance-criteria).

## What

Розширює читання колоди опційним `status` (`active` за замовчуванням, або `archived`) — той самий репозиторій (T10), інший фільтр. Не окремий use-case з нуля, а параметризація наявного.

## Definition of Done

- [ ] Integration test: `status=archived` повертає лише архівовані картки, найновіші зверху
- [ ] Integration test: виклик без параметра поводиться так само, як і раніше (тільки активні, AC-04 не зламано)
- [ ] lint + vet clean
