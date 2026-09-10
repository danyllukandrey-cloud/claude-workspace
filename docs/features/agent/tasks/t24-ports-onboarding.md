---
id: T24
title: "Ports: GET /onboarding handler"
layer: "ports"
deps: ["T13"]
acs: ["AC-13"]
files_hint: ["plan/app/src/agent/ports/onboarding-handler.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T24 — Ports: GET /onboarding handler

## Why

Одноразовий свідомий виняток із «агент не заговорює першим» (D-43) — [`contracts/openapi.yaml` `/api/v1/onboarding`](../contracts/openapi.yaml), [`sad.md §6` Flow 15](../sad.md#6-runtime-view).

## What

Перевіряє, чи для `user_id` уже є хоч один `chat_message` (T13). Якщо ні — створює вітальний `chat_message` (role=agent), повертає `welcomeShown: true, message: <воно>`. Якщо так — `welcomeShown: true, message: null`.

## Definition of Done

- [ ] Handler-test: перший виклик для нового користувача створює й повертає вітальне повідомлення
- [ ] Handler-test: другий виклик того самого користувача повертає `message: null`
- [ ] lint + vet clean

## Notes

Текст вітання й гайду — окреме завдання копірайтингу (`Concept.md`, D-76/D-77, ще не написаний) — тут заглушка/плейсхолдер, не остаточний текст.
