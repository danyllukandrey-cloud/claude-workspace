# Tracker — life-plan-levels

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | Промоутити міграцію plan_item | migration | Андрій + Claude Code | S | — | todo |
| T2 | Доменна сутність PlanItem + інваріанти | domain | Андрій + Claude Code | S | — | todo |
| T3 | postgres-repo для plan_item | infra | Андрій + Claude Code | M | T1, T2 | todo |
| T4 | use-case: створити пункт | app | Андрій + Claude Code | S | T2, T3 | todo |
| T5 | use-case: оновити текст/чекбокс | app | Андрій + Claude Code | S | T2, T3 | todo |
| T6 | use-case: м'яко видалити пункт | app | Андрій + Claude Code | S | T2, T3 | todo |
| T7 | use-case: прочитати активні пункти | app | Андрій + Claude Code | S | T3 | todo |
| T8 | Express-обробники + маршрути | ports | Андрій + Claude Code | M | T4, T5, T6, T7 | todo |
| T9 | PlanScreen.tsx | ui | Андрій + Claude Code | M | T8 | todo |
| T10 | PlanItemEditor.tsx | ui | Андрій + Claude Code | M | T8 | todo |
| T11 | Навігація в App.tsx/main.tsx | wiring | Андрій + Claude Code | S | T9, T10 | todo |
| T12 | Підключення чату агента | wiring | Андрій + Claude Code | M | T8, T11 | todo |
| T13 | Тест авторизації/non-disclosure | tests | Андрій + Claude Code | S | T8 | todo |
| T14 | Тест ідемпотентності | tests | Андрій + Claude Code | S | T8 | todo |

**Total:** 14 tasks, ~1 тиждень (feature_size: S, spec.md/sad.md frontmatter).
