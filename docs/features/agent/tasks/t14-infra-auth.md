---
id: T14
title: "Infra: Google OAuth + app_user provisioning"
layer: "infra"
deps: ["T1"]
acs: ["AC-06", "AC-13"]
files_hint: ["plan/app/src/agent/infra/auth.ts"]
owner: "TBD"
estimate: "M"
status: "done"
---

# T14 — Infra: Google OAuth + app_user provisioning

## Why

Google-вхід (D-33), скоуп на користувача (AC-06) — [`sad.md §5`](../sad.md#5-building-block-view) `infra/auth.ts`, [`sad.md §8`](../sad.md#8-crosscutting-concepts) Authentication.

## What

Мідлвар: перевіряє OAuth-токен перед кожним викликом use-case; при першому вході створює рядок `app_user` за `google_sub`, при повторному — знаходить наявний. Визначення «перший вхід взагалі» (AC-13) виводиться з відсутності будь-якого `chat_message` для цього `user_id` (T24 читає це через T13, не тут).

## Definition of Done

- [x] Integration test: перший вхід створює `app_user`; повторний — не дублює рядок
- [x] Integration test: відсутній/невалідний токен відхиляється до виклику use-case
- [x] lint + vet clean

## Notes

~~Мідлвар підключається глобально до всіх маршрутів агента в T29 (wiring), не в кожному ports-хендлері окремо.~~

**Реалізовано позачергово 2026-09-06 задачею T30 фічі `life-area-card` ([D-109](../../../DECISIONS.md#d-109), закриває [ISS-51](../../../ISSUES.md)), НЕ власною чергою хвиль `agent`** — той самий прецедент, що [D-103](../../../DECISIONS.md#d-103) (`structure`'s T1/T2/T26): перша фіча, що дійшла до composition root (`plan/app/server/`), будує спільну інфраструктуру один раз. `POST /api/v1/session` (обмін Google ID-токена на власний JWT), апсерт `app_user` за `google_sub`/email і спільний auth-мідлвар уже реалізовані там — точна форма в [ADR-0006 §Додаток: Ендпоінт сесії](../../../adr/0006-backend-http-and-migration-tool.md#додаток-ендпоінт-сесії-d-109), файли `plan/app/server/app.ts` (маршрут і мідлвар) / `db.ts` (Postgres pool). `files_hint` (`agent/infra/auth.ts`) лишається як історична вказівка на початковий задум — реального файлу за цим шляхом не буде, код живе в спільному корені. T29 (wiring агента) лише підключає agent-маршрути до вже готового кореня.
