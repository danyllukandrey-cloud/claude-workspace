---
id: T14
title: "Infra: Google OAuth + app_user provisioning"
layer: "infra"
deps: ["T1"]
acs: ["AC-06", "AC-13"]
files_hint: ["plan/backend/src/agent/infra/auth.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T14 — Infra: Google OAuth + app_user provisioning

## Why

Google-вхід (D-33), скоуп на користувача (AC-06) — [`sad.md §5`](../sad.md#5-building-block-view) `infra/auth.ts`, [`sad.md §8`](../sad.md#8-crosscutting-concepts) Authentication.

## What

Мідлвар: перевіряє OAuth-токен перед кожним викликом use-case; при першому вході створює рядок `app_user` за `google_sub`, при повторному — знаходить наявний. Визначення «перший вхід взагалі» (AC-13) виводиться з відсутності будь-якого `chat_message` для цього `user_id` (T24 читає це через T13, не тут).

## Definition of Done

- [ ] Integration test: перший вхід створює `app_user`; повторний — не дублює рядок
- [ ] Integration test: відсутній/невалідний токен відхиляється до виклику use-case
- [ ] lint + vet clean

## Notes

Мідлвар підключається глобально до всіх маршрутів агента в T29 (wiring), не в кожному ports-хендлері окремо.
