# data-model audit — life-plan-levels (2026-09-20)

## Convention source

Derived from `docs/architecture-map.md` §Migrations + `sad.md` §2/§4/§8 + the existing `life-area-card`/`structure`/`agent` migrations (corroboration, no architecture-map drift found for this topic): PostgreSQL, `node-pg-migrate`, no ORM, staged under `docs/features/<slug>/migrations/` with a feature-local ordinal, promoted into the live flat-numbered `plan/app/migrations/` (tracked in `plan/app/MIGRATIONS.md`) only by `/sdd:implement`.

Schema conventions followed (detected from `card`/`structure`/`agent` tables, not invented here): UUID PK app-generated (`crypto.randomUUID()`); `owner_user_id` FK → `app_user(id)` ON DELETE CASCADE, included directly since `app_user` already exists (unlike the earliest `card`/`structure` migrations, which had to omit the FK and add it later in a follow-up migration before `app_user` existed); TEXT + CHECK for fixed enumerations (`layout_mode` precedent); soft-delete via a `status` column, never physical delete (`card.status`/`metric_block.status` precedent); `created_at`/`updated_at` timestamptz on every table.

## Staged migration files

- `docs/features/life-plan-levels/migrations/01_create_plan_item.up.sql`
- `docs/features/life-plan-levels/migrations/01_create_plan_item.down.sql`

**Promote-time hint:** repo's live tree uses millisecond-epoch timestamp filenames (`plan/app/migrations/<timestamp>_<slug>.sql`), sequential by promotion time, not by feature-local ordinal — the last promoted migration is `1789841424996_add-card-tracking-mode.sql` (2026-09-19). `/sdd:implement` assigns the real timestamp at promotion time; no number is reserved here.

## Aggregate roots

`plan_item` is its own aggregate root — a self-contained entity with no parent, unlike `metric_block`/`entry` (which nest under `card`). Confirmed by spec.md §3 non-goals: card-linkage is explicitly out of v1 scope, so there is no cross-aggregate FK beyond `owner_user_id`.

## Self-check (4 mandatory)

- **Naming** — matches the repo's snake_case table/column convention (`plan_item`, `owner_user_id`, `plan_text`) and the existing enum-via-TEXT+CHECK style (`horizon`, `status`).
- **Down reversibility** — `CREATE TABLE` ↔ `DROP TABLE`, `CREATE INDEX` ↔ `DROP INDEX`, both present in `01_create_plan_item.down.sql`.
- **FK indexes** — `owner_user_id` is the leading column of `idx_plan_item_owner_active`, so it serves both the FK-column-indexed hygiene rule and the real query from `sad.md §6` flow 1 (list all horizons' active items for the owner, in add-order).
- **Convention adherence** — no deviation from the repo's detected conventions; nothing to flag.

## Drift detection

N/A — `plan_item` / the `plan-horizons` module do not exist in code yet (this is the design stage, before `implement`). No domain-layer struct to compare against.

## Open `<!-- TBD -->` markers

None — every column's type, nullability, and constraint was derivable from spec.md + the repo's existing convention with no honest unknown left.
