# Tracker — structure

> Status of every task in the epic. `implement` updates `done` as it commits each task.
> States: `todo` · `in_progress` · `blocked` · `review` · `done`.

| # | Task | Layer | Owner | Estimate | Blocked by | Status |
|---|---|---|---|---|---|---|
| T1 | Create structure table (backend DB) | migration | TBD | S | — | todo |
| T2 | Create structure_layout_position table | migration | TBD | S | T1 | todo |
| T3 | Create structure_history_event table (history-service DB) | migration | TBD | S | — | todo |
| T4 | Domain: declaration + layout core models | domain | TBD | M | — | todo |
| T5 | Domain: layout conflict + LWW resolution | domain | TBD | M | — | todo |
| T6 | Domain: aggregate progress calculation | domain | TBD | M | — | todo |
| T7 | Domain: gap + trend calculation | domain | TBD | M | — | todo |
| T8 | Domain: local history cache model | domain | TBD | S | — | todo |
| T9 | Infra: backend repository | infra | TBD | M | T1, T2 | todo |
| T10 | Infra: history service client | infra | TBD | M | T3 | todo |
| T11 | App: updateStructure use-case | app | TBD | M | T4, T9 | todo |
| T12 | App: moveCard use-case | app | TBD | M | T4, T5, T9, T10 | todo |
| T13 | App: closeCard use-case | app | TBD | M | T5, T9, T10 | todo |
| T14 | App: getAnalytics use-case | app | TBD | L | T6, T7, T9, T10 | todo |
| T15 | Ports: GET/PATCH /structure | ports | TBD | S | T11 | todo |
| T16 | Ports: GET /structure/layout(+/history) | ports | TBD | S | T9, T14 | todo |
| T17 | Ports: PUT /structure/layout/{cardId} | ports | TBD | S | T12 | todo |
| T18 | Ports: POST .../close | ports | TBD | S | T13 | todo |
| T19 | UI: shared primitives | ui | TBD | M | — | todo |
| T20 | UI: SCR-01 Декларація | ui | TBD | M | T19, T15 | todo |
| T21 | UI: SCR-02 Схема | ui | TBD | L | T19, T16, T17 | todo |
| T22 | UI: SCR-03 Аналітика | ui | TBD | M | T19, T16 | todo |
| T23 | UI: SCR-04 Закрити напрямок | ui | TBD | M | T19, T18 | todo |
| T24 | Wiring: app-shell registration | wiring | TBD | S | T20, T21, T22, T23 | todo |
| T25 | Tests: cross-cutting integration | tests | TBD | M | T24 | todo |

**Total:** 25 tasks, ~2 S + 15 M + 2 L + ... orientовно ~1.5–2 sprints одноосібного темпу (~1–2 год/тиждень, architecture-map.md §Organisational) — це і є те «M = 1-2 sprints» з size-matrix, тільки в реальному часі значно довше через темп проєкту.
