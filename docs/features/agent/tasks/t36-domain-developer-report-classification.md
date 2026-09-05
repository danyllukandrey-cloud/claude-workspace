---
id: T36
title: "Domain: developer-report classification"
layer: "domain"
deps: []
acs: ["AC-20", "AC-20b"]
files_hint: ["plan/app/src/agent/domain/developer-report.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T36 — Domain: developer-report classification

## Why

[spec.md AC-20/AC-20b](../spec.md#5-acceptance-criteria).

## What

Формує валідний payload `developer_report` з двох джерел: помилка, яку сам агент виявив (`trigger_type: agent_detected`), або прохання користувача переслати проблему (`trigger_type: user_requested`) — обидва зводяться до однієї моделі.

## Definition of Done

- [ ] Unit test: agent-detected payload не потребує тексту від користувача
- [ ] Unit test: user-requested payload зберігає опис користувача дослівно
- [ ] lint + vet clean
