---
id: T42
title: "App: developer-report use-case"
layer: "app"
deps: ["T36", "T37"]
acs: ["AC-20", "AC-20b"]
files_hint: ["plan/app/src/agent/app/developer-report.ts"]
owner: "TBD"
estimate: "S"
status: "todo"
---

# T42 — App: developer-report use-case

## Why

[spec.md AC-20/AC-20b](../spec.md#5-acceptance-criteria).

## What

Зберігає `developer_report` (T36) і надсилає лист (T37) — обидва кроки в одній транзакції наміру: якщо лист не пішов, рядок усе одно лишається зі `delivery_status: failed`, не втрачається.

## Definition of Done

- [ ] Integration test: agent-detected і user-requested обидва зберігають рядок і надсилають лист
- [ ] Integration test: збій надсилання лишає рядок зі `delivery_status: failed`, не кидає
- [ ] lint + vet clean
