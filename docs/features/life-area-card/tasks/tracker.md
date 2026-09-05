# Tracker — life-area-card

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | Create card table | migration | TBD | S | — | done |
| T2 | Create metric_block table | migration | TBD | S | T1 | todo |
| T3 | Create entry table | migration | TBD | S | T1, T2 | todo |
| T4 | Create card_lifecycle_event table | migration | TBD | S | T1 | todo |
| T5 | Add card.status column (soft archival) | migration | TBD | S | T1, T4 | todo |
| T6 | Domain: progress calculation from raw events | domain | TBD | M | — | done |
| T7 | Domain: entry status model | domain | TBD | M | — | done |
| T8 | Domain: near-simultaneous conflict detection | domain | TBD | M | — | done |
| T9 | Domain: card lifecycle states | domain | TBD | S | — | todo |
| T10 | Infra: Postgres repo | infra | TBD | L | T2, T3, T4, T5 | todo |
| T11 | Infra: local offline cache | infra | TBD | M | — | done |
| T12 | Infra: Claude client for suspicious-data check | infra | TBD | M | — | done |
| T13 | App: createCard use-case | app | TBD | S | T9, T10 | todo |
| T14 | App: updateCard use-case | app | TBD | S | T9, T10 | todo |
| T15 | App: archiveCard use-case | app | TBD | S | T9, T10 | todo |
| T16 | App: createMetricBlock use-case | app | TBD | M | T9, T10 | todo |
| T17 | App: transferMetricBlock use-case | app | TBD | M | T9, T10 | todo |
| T18 | App: createEntry use-case | app | TBD | M | T7, T8, T10 | todo |
| T19 | App: resolveEntry use-case | app | TBD | M | T7, T8, T10 | todo |
| T20 | App: getCardWithProgress use-case | app | TBD | M | T6, T10, T12 | todo |
| T21 | Ports: cards handlers | ports | TBD | M | T13, T14, T15, T20 | todo |
| T22 | Ports: metric-blocks handlers | ports | TBD | S | T16, T17 | todo |
| T23 | Ports: entries handlers | ports | TBD | S | T18, T19 | todo |
| T24 | UI: shared CardShell primitives | ui | TBD | M | — | done |
| T25 | UI: SCR-01 Колода карток | ui | TBD | M | T24, T21 | todo |
| T26 | UI: SCR-02/SCR-03 Картка (face+back) | ui | TBD | L | T24, T21, T22, T23 | todo |
| T27 | UI: SCR-04 Форма створення | ui | TBD | S | T24, T21 | todo |
| T28 | UI: SCR-05 Форма блоку-метрики | ui | TBD | M | T24, T22 | todo |
| T29 | UI: SCR-06 Підтвердження архівації | ui | TBD | S | T24, T21 | todo |
| T30 | Wiring: register life-area-card module | wiring | TBD | S | T25, T26, T27, T28, T29, T36, T37 | todo |
| T31 | Tests: cross-cutting integration | tests | TBD | M | T30, T11 | todo |
| T32 | Migration: restore transition + archived index | migration | TBD | S | T5 | todo |
| T33 | App: restoreCard use-case | app | TBD | S | T9, T10 | todo |
| T34 | App: listCards with status filter | app | TBD | S | T10 | todo |
| T35 | Ports: restoreCard + archived listCards handlers | ports | TBD | S | T33, T34 | todo |
| T36 | UI: SCR-07 Архів карток | ui | TBD | M | T24, T35 | todo |
| T37 | UI: SCR-02 rename state | ui | TBD | S | T24, T21 | todo |
| T38 | Migration: add owner_user_id FK | migration | TBD | S | T1 | todo |

**Total:** 38 tasks — 17 S + 18 M + 3 L. Доповнено 2026-08-29 (T32-T38, D-89) — 6 задач на розархівацію/архів/перейменування + 1 крос-фічева FK-міграція. Порівнянно з `agent` (30 задач до доповнення) — реалістично довше за одну сесію навіть у термінах size-matrix (M); у реальному часі — значно довше через темп проєкту (~8-12 год/тиждень, уточнено 2026-08-29 — стара оцінка 1-2 год/тиждень застаріла, [D-87](../../../DECISIONS.md#d-87)).
