# Tracker — life-plan-levels

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status | Commit |
|---|---|---|---|---|---|---|---|
| T1 | Промоутити міграцію plan_item | migration | Андрій + Claude Code | S | — | done | `535ff55` |
| T2 | Доменна сутність PlanItem + інваріанти | domain | Андрій + Claude Code | S | — | done | `b8857ac` |
| T3 | postgres-repo для plan_item | infra | Андрій + Claude Code | M | T1, T2 | done | `355220f` |
| T4 | use-case: створити пункт | app | Андрій + Claude Code | S | T2, T3 | done | `d9270e0` |
| T5 | use-case: оновити текст/чекбокс | app | Андрій + Claude Code | S | T2, T3 | done | `24a4f3c` |
| T6 | use-case: м'яко видалити пункт | app | Андрій + Claude Code | S | T2, T3 | done | `5d3ccd4` |
| T7 | use-case: прочитати активні пункти | app | Андрій + Claude Code | S | T3 | done | `8b08317` |
| T8 | Express-обробники + маршрути | ports | Андрій + Claude Code | M | T4, T5, T6, T7 | done | `bcaea26` |
| T9 | PlanScreen.tsx | ui | Андрій + Claude Code | M | T8 | done | `3db34be` |
| T10 | PlanItemEditor.tsx | ui | Андрій + Claude Code | M | T8 | done | `da5772d` |
| T11 | Навігація в App.tsx/main.tsx | wiring | Андрій + Claude Code | S | T9, T10 | done | `a9c1409` |
| T12 | Підключення чату агента | wiring | Андрій + Claude Code | M | T8, T11 | done | `5157166` + `0ea3432` |
| T13 | Тест авторизації/non-disclosure | tests | Андрій + Claude Code | S | T8 | done | `d68c69a` |
| T14 | Тест ідемпотентності | tests | Андрій + Claude Code | S | T8 | done | `f9713a4` |

**Total:** 14 tasks, ~1 тиждень (feature_size: S, spec.md/sad.md frontmatter). **Усі 14 виконано 2026-09-20**, гілка `life-plan-levels` (15 комітів, D-134 -- одна гілка на фічу; окрема гілка через те, що `.githooks/commit-msg` D-100 блокує прямі коміти коду в `plan/app/` на `main`).

**Фінальна звірка (2026-09-20, поза Workflow, вручну):** `npm test` -- 1213/1213; `npm run test:integration` -- 96/96 проти реальної Neon; `npm run lint` -- чисто.
