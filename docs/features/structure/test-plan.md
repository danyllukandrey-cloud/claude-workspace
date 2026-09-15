---
status: Draft
owner: "Андрій"
reviewers: ["<implementing engineer>", "Tech Lead"]
updated_at: "2026-09-15"
feature_size: "M"
---

# Test plan — structure

Структура тримає декларацію картини світу окремо від Опису кожної картки, розкладку карток за одним із п'яти рівноправних способів групування (вимоги 14/15, плоска модель — [`spec.md §2`](spec.md#2-goals)), і зведену аналітику — чесний розрив між заявленим і фактичним, без вердикту.

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure logic: an aggregation/gap-rank rule — no I/O. | In-memory, no external dependency. |
| Integration | The module against a real dependency it owns (the shared backend Postgres). | An ephemeral real dependency, e.g. a throwaway DB container spun up per suite. |
| Component *(UI surface)* | A structure UI component exercised in isolation. | Render in a component harness; assert output + interactions, no full app boot. |
| E2E-through-UI *(UI surface)* | A user-story flow driven through the real UI. | The flow exercised through the rendered UI against ephemeral dependencies. |

<!-- E2E (без UI), Contract, Load: N/A цим планом — жодного окремого API-споживача поза UI не заплановано;
     load — див. §NFR validation нижче. Visual-regression: N/A — код-режим design-system. -->

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Expected outcome |
|---|---|---|---|
| AC-01 happy | average progress across computable cards is shown | integration | correct average returned from real card progress values |
| AC-02 error | dropping a card on an occupied cell is blocked | integration | placement rejected, cell contents unchanged |
| AC-03 authorization | a request never returns another user's Structure | integration | non-owner gets the same outcome as non-existent |
| AC-04 domain invariant | layout position never changes the aggregate | unit | reordering cards leaves the average identical |
| AC-05 cross-context | a corrected card entry updates the Structure's aggregate | integration | Structure reads the same corrected number, never a stale cached one |
| AC-06 happy | logic-layout gap shows rank vs progress, no verdict | unit | gap value returned, no good/bad label attached |
| AC-06b happy | no-scheme layout flags declared-but-unmaintained cards | unit | flag set only when created but no tracking activity |
| AC-07 happy | gap trend shown as growing or shrinking over two points in time | integration | trend direction derived from history-log reads |
| AC-08 happy | dragging a card to a free position saves immediately | integration | new position persisted and returned on next read |
| AC-09 happy | a new card gets a default position without forcing a mode choice | integration | card placed, no mode-selection prompt required |
| AC-10 domain invariant | Structure declaration and card Опис never merge | unit | the two fields stay independent in the model |
| AC-11 happy | picking a layout mode applies it going forward | integration | subsequent placements follow the chosen mode |
| AC-11b happy | switching layout mode resets cards to a fixed base order | integration | every card moved to base order, new grid shown, atomically |
| AC-12 happy | closing an overlapping card offers per-metric transfer | integration | closure recorded as a history event; declined metrics stay behind |
| AC-13 domain invariant | non-computable cards are excluded from the average, counted separately | unit | excluded count shown, average unaffected by them |
| AC-15 happy | a rename or logic-layout move is recorded as a history event | integration | timestamped event written to the history log table |
| AC-16 happy | picking a grid-based mode directly applies its grid and root-card rule | integration | mode's cell scheme and root-card marking applied |
| AC-17 restored-card | archive restore leaves a card without a cell | integration | card lands in the tray, no cell assigned |
| AC-18 happy | "staging" places new/reset cards in the tray, never auto-assigns a cell | integration | card has no cell while this mode is active, even with free cells available |

<!-- AC-16b скасовано (вимоги 14/15, плоска модель) -- злито в AC-11b: перемикання між будь-якими двома з 5 режимів, зокрема між колишніми підвидами напряму, тепер один механізм. -->

## Edge cases / error paths

- Two devices move the same card to different cells at nearly the same time → last-write-wins by `positionUpdatedAt` (ADR-0002), the earlier write is silently superseded, not merged.
- Closing a card with zero metric-blocks → closure proceeds with no per-metric prompt (AC-12's happy path collapses to a plain confirm).
- Attempting to view/edit a Structure or move a card by a made-up or someone else's id → the same "not found" outcome — existence is never confirmed or denied (AC-03).

## Test data

- Seed strategy: factories matching `data-model.md` entities (`structure` — one flat `layoutMode` field, 5 values, вимоги 14/15 — `structure_layout_position`, `structure_history_event`) — same shape as the fixtures `life-area-card` already builds (`buildCard`, `buildMetricBlock`, `buildEntry`), reused across both features' integration suites since aggregation reads `life-area-card`'s own domain.
- Integration dependency: one ephemeral real dependency — the shared backend Postgres (structure, layout, and the history log all in the same database, [D-113](../../DECISIONS.md#d-113)) — NOT mocked; each suite spins it up fresh.
- Cleanup boundary: per-test — Structure is a singleton per user, so tests must reset both stores between runs or a stale row from a previous test silently satisfies a "lazy-create" assertion that should have failed.

## NFR validation (load)

<!-- N/A: spec.md §6 lists Throughput as N/A (одноосібний клієнтський застосунок) and only client-side
     p95 timer targets (≤300ms analytics open, ≤200ms drag write) — already the DoD of the UI tasks
     in tasks.json, not a server load scenario. No numeric server-side NFR to load-test. -->

## CI placement

- On every PR: unit, component — fast enough to gate a merge.
- On schedule / pre-release: integration, e2e-through-UI — heavier suites that need the ephemeral store up.
