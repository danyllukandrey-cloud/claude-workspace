---
id: T37
title: "Infra: outbound email client"
layer: "infra"
deps: []
acs: ["AC-20", "AC-20b"]
files_hint: ["plan/app/src/agent/infra/email-client.ts"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T37 — Infra: outbound email client

## Why

Доставка звіту про проблему на пошту розробника — [spec.md AC-20](../spec.md#5-acceptance-criteria).

## What

Тонкий клієнт над SMTP чи транзакційним email-API (постачальник — деталь реалізації, не вирішена жодним upstream-документом). Той самий рівень ізоляції, що `claude-client.ts` (T12) — жоден інший шар не знає, як саме лист іде.

## Definition of Done

- [ ] Integration test проти заглушки: успішне надсилання повертає підтвердження доставки
- [ ] Integration test проти заглушки: збій повертає типізовану помилку, ніколи не кидає необроблений виняток
- [ ] lint + vet clean
