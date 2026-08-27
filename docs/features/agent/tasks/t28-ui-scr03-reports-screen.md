---
id: T28
title: "UI: SCR-03 Звіти активності screen"
layer: "ui"
deps: ["T23"]
acs: ["AC-11"]
files_hint: ["plan/app/src/agent/ui/ReportsScreen.tsx"]
owner: "TBD"
estimate: "M"
status: "todo"
---

# T28 — UI: SCR-03 Звіти активності screen

## Why

Нижня навігація, лише читання — [`screens.md` SCR-03](../screens.md#scr-03--звіти-активності).

## What

`ReportList` (нове), виклик `GET /reports` (T23). Рендерить 5 станів: `default`, `empty`, `loading`, `dead-letter-flagged`, `error`.

## Definition of Done

- [ ] Component test: усі 5 станів зі `screens.md` SCR-03 рендеряться за відповідним триггером
- [ ] Component test: `dead_letter`-звіт показує видиму позначку «потребує перевірки» (`Banner`)
- [ ] lint + vet clean

## Notes

Жодної дії користувача, що запускає формування звіту — цей екран лише читає (AC-11: worker формує самостійно).
