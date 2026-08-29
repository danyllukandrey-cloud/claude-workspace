---
status: Draft
owner: "Андрій"
reviewers: ["<implementing engineer>", "Tech Lead"]
updated_at: "2026-08-29"
feature_size: "M"
---

# Test plan — agent

Агент перетворює пряме надходження (текст/вкладення) на записаний у картку факт лише через явне підтвердження, дотримується правил користувача, памʼятає контекст, формує пасивні звіти активності — [`spec.md §2`](spec.md#2-goals).

## Levels

| Level | Scope | Strategy (generic — no tool names) |
|---|---|---|
| Unit | Pure logic: а domain rule/model — no I/O. | In-memory, no external dependency. |
| Integration | The module against a real dependency it owns (Postgres, Claude API stub). | An ephemeral real dependency, e.g. a throwaway DB container spun up per suite. |
| Contract | The OpenAPI shape both sides agree on. | Validate the real response shape against `contracts/openapi.yaml`; no hand-rolled stubs. |
| E2E | One full flow end to end (one per critical user story). | The flow exercised through its real HTTP entry point against ephemeral dependencies. |
| Load | NFR validation — latency/throughput carry numbers. | The load tool already in your repo, or e.g. k6 or Locust. |
| Component *(UI surface)* | A chat UI component exercised in isolation. | Render in a component harness; assert output + interactions, no full app boot. |
| E2E-through-UI *(UI surface)* | A user-story flow driven through the real chat UI. | The flow exercised through the rendered UI against ephemeral dependencies. |

<!-- Visual-regression: N/A — жоден скріншот-baseline не запланований для v1 (code-mode design-system, screens.md — inline wireframes, не rendered UI); revisit коли з'явиться реальний рендер. -->

## AC coverage

| AC (spec.md §5) | Test name (intent-based) | Level | Expected outcome |
|---|---|---|---|
| AC-01 happy (text) | text message produces a card proposal | integration | proposal created, nothing written to the card yet |
| AC-02 happy | confirming an active proposal records the entry | integration | entry recorded, proposal marked confirmed |
| AC-02b happy | a clarification message updates the same proposal | integration | one proposal row, updated in place — no second one created |
| AC-03 domain invariant | an unrelated message silently drops the old proposal | unit | old proposal dropped, nothing recorded, no user-visible error |
| AC-04 error | contradictory data prompts a clarifying question | integration | agent explains the mismatch, nothing recorded, rest of card unaffected |
| AC-05 cross-context | an ambiguous message asks which card was meant | integration | agent asks or offers to create a new card, no guess made |
| AC-06 authorization | a request never returns another user's data | integration | cross-user request returns nothing, own-user request unaffected |
| AC-07 happy | a guarded reply follows the user's active rule | unit | draft that violates the rule is discarded, retry respects it |
| AC-08 happy | selecting menu categories saves them as active rules | integration | selected categories stored, later replies reflect them |
| AC-09 happy | a new session recalls a fact from an earlier one | integration | reply accounts for the stored fact without the user repeating it |
| AC-10 happy (attachment) | a photo with no text produces a proposal | integration | proposal created from the attachment alone |
| AC-10b error | an unrecognized attachment is explained, not guessed | integration | agent asks for a text description, nothing recorded |
| AC-11 happy | a due period produces exactly one passive report | integration | one `activity_report` row, no outbound notification |
| AC-12 happy | a card-scoped rule only applies on that card | integration | override active on the named card, global rule unaffected elsewhere |
| AC-13 happy | the very first open shows a one-time welcome | integration | welcome message created once; later opens return none |
| AC-14 happy | a new rule is checked against same-scope rules before saving | unit | conflicting rule rejected with the reason named; non-conflicting saved |
| AC-15 happy | the agent doesn't "forget" something said earlier the same day | integration | reply reflects same-day context not yet in long-term memory |
| AC-16 happy | a hint appears above the composer after a completed action | component | hint bubble renders on the confirmed-hint state |
| AC-16b happy | the hint dismisses via ✕ or composer focus | component | hint gone after either interaction, doesn't reappear until the next action |
| AC-17 happy | account deletion cascades across all three features | e2e | zero rows for that user_id in agent, life-area-card, AND structure tables |
| AC-17 error | deletion without the confirmation flag is rejected | integration | nothing deleted, no audit row written |
| AC-17b happy | the confirm button stays disabled until the confirmation word is typed | component | UI-level guard, independent of the backend rejection above |
| AC-18 happy | a due resource receives a fresh daily copy | integration | resource's `last_synced_at` updated, external write called exactly once |
| AC-18b error | an unreachable resource is marked with an error, not retried silently forever | integration | `status: error`, `last_error` set, `resource_sync_failed` audit row written |
| AC-19 happy | a document/spreadsheet attachment is processed like a photo | integration | proposal created from the attachment's content |
| AC-19b error | an unsupported attachment format is explained, not guessed | integration | same outcome as AC-10b — text description requested |
| AC-20 happy | the agent detects and reports its own technical error | integration | `developer_report` row (`trigger_type: agent_detected`) persisted, email sent |
| AC-20b happy | a user-requested bug report is forwarded | integration | `developer_report` row (`trigger_type: user_requested`) persisted with the user's description, email sent |

## Edge cases / error paths

- Claude API unavailable/timeout during a message → agent replies with an error, the user's typed text is not lost, no automatic retry (`sad.md §6` Flow 2, accepted debt).
- More than the allowed number of messages in an hour from one user → further messages are rejected until the window resets (§8 SAD Rate limiting); other users are unaffected.
- Confirming a proposal that is no longer active (already confirmed, or silently dropped) → rejected, nothing recorded twice.
- A rule with neither a category nor free text submitted → rejected before it reaches storage.
- Attempting to view/confirm/report on data addressed by a made-up or someone else's id → the same outcome as "not found" — existence is never confirmed or denied.
- Third-person name inside a message destined for long-term memory → the name is stripped before storage, only the measurable value is kept.
- Email delivery fails when sending a developer report → row persists with `delivery_status: failed`, never silently dropped (AC-20/AC-20b).
- A sync resource that was active becomes unreachable mid-run, then reachable again the next day → recovers to `status: active` without manual intervention (AC-18b isn't a permanent ban).
- Account deletion attempted twice in quick succession (double-click) → second call returns "not found", not a second cascade.

## Test data

- Seed strategy: factories per `data-model.md` entity — `buildAppUser`, `buildAgentProposal`, `buildImperativeRule`, `buildLongTermMemoryFact`, `buildChatMessage`, `buildAgentAuditEvent`, `buildActivityReport`, `buildSyncResource`, `buildDeveloperReport` (already named in `data-model.md` §Test fixtures).
- Integration dependency: an ephemeral real PostgreSQL instance (throwaway container), NOT a mocked store; Claude API calls go through a stub client (deterministic canned responses), never the real provider; outbound email (AC-20) and the external resource writer (AC-18) each go through their own stub, never a real send/write.
- Cascading-deletion tests (AC-17) seed a user with data in **all three** features (agent + life-area-card + structure) in one fixture — the point of the test is the cross-feature FK, not any single feature in isolation.
- Cleanup boundary: per-test — each test seeds only what it needs and the suite resets the database between tests, so cross-test state never leaks (important given the one-active-proposal-per-user invariant).

## NFR validation (load)

- `spec.md §6`: p95 ≤ 4000 ms from message to proposal → scenario: sustained load at the target throughput for a fixed window, assert p95 latency of `POST /messages` stays ≤ 4000 ms against the Claude API stub (measures backend throughput, not the real provider's latency).
- `spec.md §6`: p95 ≤ 1000 ms from confirmation to updated counter → scenario: same load window, assert p95 latency of `POST /proposals/{id}/confirm` stays ≤ 1000 ms.
- `spec.md §6`: throughput ≥ 5 req/s per instance → scenario: sustain 5 req/s for a fixed window, assert no error-rate regression.

<!-- AC-07 (≥95% guard accuracy) не включено сюди навмисно: за уточненням з Андрієм (плюс-питання цього кроку)
     цей критерій покривається unit-тестом механізму (одна відповідь), не load-тестом. Сам агрегований
     відсоток spec.md §6 фіксує як вимірюваний "протягом 90 днів після запуску" — виробниче вимірювання,
     не пре-релізний тест; жодна задача tasks.json це не обіцяє покрити тут. -->

## CI placement

- On every PR: unit, integration, component — fast enough to gate a merge.
- On schedule / pre-release: e2e, e2e-through-UI, load — heavier suites that need the full stack up.
