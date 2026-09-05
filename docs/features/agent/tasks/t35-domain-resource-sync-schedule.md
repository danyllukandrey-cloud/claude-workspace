---
id: T35
title: "Domain: resource-sync scheduling model"
layer: "domain"
deps: []
acs: ["AC-18"]
files_hint: ["plan/app/src/agent-worker/domain/sync-resource.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T35 — Domain: resource-sync scheduling model

## Why

[spec.md AC-18](../spec.md#5-acceptance-criteria).

## What

Визначає, які ресурси «потребують синхронізації зараз» (`status = active`, ще не синхронізовані сьогодні) — та сама логіка меж періоду, що T11 (`activity_report`), лише щоденний, а не тижневий/місячний/квартальний крок.

## Definition of Done

- [ ] Unit test: ресурс, синхронізований сьогодні, не потрапляє в чергу повторно
- [ ] Unit test: ресурс зі `status = error` усе одно бере участь у наступній спробі (не «застряг» назавжди)
- [ ] lint + vet clean
