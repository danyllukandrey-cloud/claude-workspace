---
status: Draft
owner: "Андрій"
reviewers: ["<implementing engineer>", "Tech Lead"]
updated_at: "2026-08-27"
feature_size: "M"
---

# Test plan — life-area-card

Картка — generic-механізм зони життя: назва, Опис, блоки-метрики, Відстеження ([`spec.md §2`](spec.md#2-goals)). Записи потрапляють лише через підтверджену пропозицію агента (`agent`, поза цим планом).

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure logic: a domain rule/calculation/validator — no I/O. | In-memory, no external dependency. |
| Integration | The module against a real dependency it owns (Postgres, Claude API stub). | An ephemeral real dependency, e.g. a throwaway DB container spun up per suite. |
| Contract | The OpenAPI shape both `structure` and `life-area-card` agree on (metric-transfer). | Validate the real response shape against `contracts/openapi.yaml`; no hand-rolled stubs. |
| Component *(UI surface)* | A card UI component exercised in isolation. | Render in a component harness; assert output + interactions, no full app boot. |
| E2E-through-UI *(UI surface)* | A user-story flow driven through the real card UI. | The flow exercised through the rendered UI against ephemeral dependencies. |

<!-- E2E (без UI) і Load: N/A цим планом — див. нижче §NFR validation і §CI placement. -->
<!-- Visual-regression: N/A — код-режим design-system, jak і в agent/test-plan.md. -->

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Expected outcome |
|---|---|---|---|
| AC-01 happy | confirmed record updates the card's tracked count | integration | entry status confirmed, progress reflects it |
| AC-02 error | creating a card without a name is rejected | unit | nothing created, name-required reason returned |
| AC-03 error | marking a card filled without a description is rejected | unit | card stays in its current state, description-required reason returned |
| AC-04 authorization | a request never returns another user's card | integration | cross-user request returns nothing, own-user request unaffected |
| AC-05 domain invariant | an ongoing metric-block shows an accumulated count, not a percentage | unit | no percentage computed against a missing deadline |
| AC-06 cross-context | near-simultaneous entries from different devices are held for review | integration | both entries pending, neither counts until resolved |
| AC-07 happy | an unmeasurable goal is accepted once turned into a measurable one | integration | metric-block created with the agreed measurable target |
| AC-08 happy | a card with no metric-block stays usable but never reaches "actively tracked" | unit | card remains declarative-only |
| AC-09 happy | opening a card shows computed share of completion per metric-block and aggregate | unit | correct shares returned for confirmed entries |
| AC-09b domain invariant | a metric-block over its goal is capped, not shown above full | unit | share capped at 100%, overage noted separately |
| AC-10 happy | inconsistent data is flagged without blocking the rest of the card | integration | warning explanation present, other fields still readable |
| AC-11 domain invariant | a record that arrived while unreviewable stays out of progress until reviewed | integration | pending until explicit review, then resolved |
| AC-12 happy | a flagged wrong entry is corrected or rolled back together with the agent | integration | entry marked rejected, never physically removed, progress reflects correction |
| AC-13 happy | expanding a card's history shows recent entries in order | integration | entries returned newest-first with what/when |
| AC-14 happy | a metric-block moved from a closing card arrives with its full history | integration | destination card's progress and history include the moved entries |
| AC-15 error | a name+unit collision on transfer is rejected, not silently merged | integration | transfer blocked until a new label is supplied |
| AC-16 happy | deleting a card soft-archives it | integration | card gone from the active deck, technically recoverable |

## Edge cases / error paths

- Claude API unavailable during a suspicious-data check (T12) → card still opens, no `dataWarning`, no user-facing error (fail-open, not fail-closed).
- Attempting to view/update/archive a card by a made-up or someone else's id → the same "not found" outcome — existence is never confirmed or denied.
- Transfer target card archived between the source closing and the transfer call → transfer rejected, source metric-block stays on the closing card.
- Two devices resolve the same conflicting entry pair at nearly the same moment → the second resolution is rejected once the first has already settled the pair, not applied on top of it.
- Offline record made with no connectivity at all → stays queued locally, syncs and resolves to pending/confirmed once reconnected (see Test data below).

## Test data

- Seed strategy: factories per `data-model.md` entity — `buildCard`, `buildMetricBlock`, `buildEntry`, `buildPendingEntry` (already named in `data-model.md` §Test fixtures).
- Integration dependency: an ephemeral real PostgreSQL instance (throwaway container), NOT a mocked store; the suspicious-data check (T12) goes through a stub Claude client with deterministic canned responses.
- Cleanup boundary: per-test — each test seeds only what it needs and the suite resets the database between tests, so the near-simultaneous-conflict window (AC-06) never leaks state across unrelated tests.

## NFR validation (load)

<!-- N/A: spec.md §6 lists Throughput as N/A (одноосібний клієнтський застосунок) and only p95 latency numbers
     for offline-local operations (≤300ms write, ≤150ms read) — these are client-side timer assertions
     (already the DoD of the UI tasks, T26-T29), not a server load scenario. No numeric server-side NFR
     to load-test. -->

## CI placement

- On every PR: unit, component — fast enough to gate a merge.
- On schedule / pre-release: integration, contract, e2e-through-UI — heavier suites that need the full stack (or a real Postgres container) up.
