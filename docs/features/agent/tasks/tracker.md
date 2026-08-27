# Tracker — agent

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | Create app_user table | migration | TBD | S | — | todo |
| T2 | Create agent_proposal table | migration | TBD | S | T1 | todo |
| T3 | Create imperative_rule table | migration | TBD | S | T1 | todo |
| T4 | Create long_term_memory_fact table | migration | TBD | S | T1 | todo |
| T5 | Create chat_message table | migration | TBD | S | T1 | todo |
| T6 | Create agent_audit_event table | migration | TBD | S | T1 | todo |
| T7 | Create activity_report table | migration | TBD | S | T1 | todo |
| T8 | Domain: proposal lifecycle model | domain | TBD | M | — | todo |
| T9 | Domain: imperative rule model + guard-check enforcement | domain | TBD | M | — | todo |
| T10 | Domain: hybrid memory model | domain | TBD | M | — | todo |
| T11 | Domain (agent-worker): activity-report model | domain | TBD | S | — | todo |
| T12 | Infra: Claude API client | infra | TBD | M | — | todo |
| T13 | Infra: Postgres repo | infra | TBD | L | T2, T3, T4, T5, T6 | todo |
| T14 | Infra: Google OAuth + app_user provisioning | infra | TBD | M | T1 | todo |
| T15 | Infra (agent-worker): schedule + report persistence | infra | TBD | M | T7, T13 | todo |
| T16 | App: handle-message use-case | app | TBD | L | T8, T10, T13, T18 | todo |
| T17 | App: confirm use-case | app | TBD | S | T8, T13 | todo |
| T18 | App: ask-agent orchestration | app | TBD | M | T9, T12 | todo |
| T19 | App (agent-worker): generate-report use-case | app | TBD | M | T11, T15 | todo |
| T20 | Ports: GET/POST /messages handlers | ports | TBD | M | T16 | todo |
| T21 | Ports: proposal confirm handlers | ports | TBD | S | T17 | todo |
| T22 | Ports: GET/POST /rules handlers | ports | TBD | S | T9, T13 | todo |
| T23 | Ports: GET /reports handler | ports | TBD | S | T13 | todo |
| T24 | Ports: GET /onboarding handler | ports | TBD | S | T13 | todo |
| T25 | UI: SCR-01 chat components | ui | TBD | M | — | todo |
| T26 | UI: SCR-01 Чат screen | ui | TBD | L | T25, T20, T21, T24 | todo |
| T27 | UI: SCR-02 Налаштування правил screen | ui | TBD | M | T22 | todo |
| T28 | UI: SCR-03 Звіти активності screen | ui | TBD | M | T23 | todo |
| T29 | Wiring: register agent module | wiring | TBD | S | T14, T26, T27, T28 | todo |
| T30 | Tests: cross-cutting integration | tests | TBD | M | T29 | todo |

**Total:** 30 tasks — 12 S + 14 M + 4 L. Найбільша фіча SDD-конвеєра поки (7 сутностей проти 3 у `structure`, 8 ендпоінтів проти 6, 3 поверхні проти 2) — реалістично довше за одну сесію навіть у термінах size-matrix (M); у реальному часі — значно довше через темп проєкту (~1–2 год/тиждень, `architecture-map.md` §Organisational).
