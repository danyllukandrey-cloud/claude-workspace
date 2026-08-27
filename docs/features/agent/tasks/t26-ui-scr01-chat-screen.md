---
id: T26
title: "UI: SCR-01 Чат screen"
layer: "ui"
deps: ["T25", "T20", "T21", "T24"]
acs: ["AC-01", "AC-02", "AC-02b", "AC-03", "AC-04", "AC-05", "AC-09", "AC-10", "AC-10b", "AC-13", "AC-15"]
files_hint: ["plan/app/src/agent/ui/ChatScreen.tsx"]
owner: "TBD"
estimate: "L"
status: "todo"
---

# T26 — UI: SCR-01 Чат screen

## Why

Головний екран агента, типовий екран застосунку — [`screens.md` SCR-01](../screens.md#scr-01--чат).

## What

Компоновка T25 + виклики `GET/POST /messages` (T20), `GET/POST /proposals/active`+`confirm` (T21), `GET /onboarding` (T24). Рендерить усі 9 станів: `default`, `empty-onboarding`, `loading`, `proposal-pending`, `confirmed`, `clarifying`, `attachment-error`, `rate-limited`, `llm-unavailable`.

## Definition of Done

- [ ] Component test: усі 9 станів зі `screens.md` SCR-01 рендеряться за відповідним триггером
- [ ] Component test: підтвердження пропозиції викликає `POST /proposals/{id}/confirm`, не повторний `POST /messages`
- [ ] lint + vet clean

## Notes

`llm-unavailable` (503) — без retry на клієнті (accepted debt, `sad.md §11`): банер лише пропонує спробувати ще раз, нічого не повторює автоматично.
