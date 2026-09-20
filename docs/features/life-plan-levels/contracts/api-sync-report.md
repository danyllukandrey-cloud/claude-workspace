# api-sync-report — life-plan-levels (2026-09-20)

## Section A — field-origins table

| schema_path | origin | confidence |
|---|---|---|
| `PlanItem.id` | data-model.md → `plan_item.id` (UUID PK) | high |
| `PlanItem.horizon` | data-model.md → `plan_item.horizon` (TEXT+CHECK) | high |
| `PlanItem.planText` | data-model.md → `plan_item.plan_text` (TEXT NOT NULL) | high |
| `PlanItem.done` | data-model.md → `plan_item.done` (BOOLEAN) | high |
| `PlanItem.createdAt` | data-model.md → `plan_item.created_at` | high |
| `PlanItem.status` (internal, not exposed) | data-model.md → `plan_item.status` — deliberately excluded from the client-facing schema; soft-removal is expressed as "not returned by GET" + a 204 DELETE, never a visible status string (spec.md §1 ¶4 / AC-04) | high |
| `listPlanItems.next_cursor`, `has_next`, `has_prev` | derived (repo's cursor-page wrapper convention, `CardPage` precedent) | high |
| `createPlanItem` `Idempotency-Key` header | derived from spec.md §6 NFR row "ідемпотентність збереження" — no sad.md §6 flow drew an explicit retry loop for this endpoint, so the header is inferred from the NFR text, not a sequence branch | medium |
| `updatePlanItem` 422 `plan_item.text_required` on empty `planText` | inferred from spec.md AC-02's rule reused for edits, by analogy — sad.md flow 6 shows only the "clear = remove" branch, not an "edit-to-empty-without-delete" attempt | medium |

No `low`-confidence rows — every field traces to either a `data-model.md` column or a documented repo-wide convention.

## Section B — drift findings (4-point checklist)

1. **Endpoint ↔ data-model** *(core)* — ✓. All 4 operations (`listPlanItems`, `createPlanItem`, `updatePlanItem`, `deletePlanItem`) read/write `plan_item`. Every operation also maps to a spec.md §4 user story (US-01/US-02/US-03/US-04/US-05/US-08).

2. **Error code ↔ repo error definition** *(core)* — no central error registry exists in this repo (`plan/app/src/shared/errors/index.ts` defines a generic `AppError(code, status)` class, not an enumerated list of valid codes — each feature throws its own codes inline). `plan_item.not_found` / `plan_item.text_required` / `request.invalid_body` are this contract's **proposal**, matching the naming pattern already used by `card.not_found` / `card.name_required` in `life-area-card`'s contract. Not a failure — the codes will exist once `implement` writes the use-cases that throw them.

3. **Validation ↔ constraint** *(core)* — ✓. `horizon` enum (3 values) matches the `CHECK` constraint verbatim. `planText` has no `maxLength` in either the contract or `data-model.md` (TEXT, unbounded) — consistent, not a gap; matches `card.description`'s own unbounded `TEXT` treatment.

4. **OpenAPI ↔ sequence** *(supporting)* — ✓ with one reconciliation, documented rather than silently applied: `sad.md §6` flow 6 draws text-editing and removal as two branches of **one** interaction ("редагує текст... alt новий текст непорожній / else очищено повністю"). The contract splits this into two HTTP operations (`PATCH` for non-empty edits, `DELETE` for removal) instead of one endpoint with an `alt` — chosen to match the repo's own established pattern for the identical situation (`life-area-card`'s `archive-metric-block` uses a dedicated `DELETE`, not an overloaded `PATCH`). Confirmed with Андрій before writing the contract (this session, 2026-09-20). The UI still presents it as one "clear the text and save" action per spec.md AC-04 — this is a wire-protocol decision, not a UX change.

**No core point failed; 0 flags requiring a pause.** The two `medium`-confidence rows (Section A) are declared incompleteness, not errors — they'll tighten to `high` once `implement` writes the debounce/idempotency-key handling and the edit-to-empty validation path.

## Deviations from the fixed defaults

None — OpenAPI 3.1.0, `{code, message, details?}` envelope, cursor pagination, `/api/v1/...` URL versioning, global `BearerAuth`, `$ref` for all shared schemas, placeholder-only examples. No ADR overrides any default.
