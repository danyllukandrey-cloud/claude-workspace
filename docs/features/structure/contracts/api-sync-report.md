# API sync report — structure — 2026-08-24

## Section A — field-origins

| schema_path | origin | confidence |
|---|---|---|
| Structure.id | data-model.md → `structure.id` | high |
| Structure.declaration | data-model.md → `structure.declaration` | high |
| Structure.layoutMode | data-model.md → `structure.layout_mode` (CHECK enum) | high |
| Structure.createdAt | data-model.md → `structure.created_at` | high |
| Structure.updatedAt | data-model.md → `structure.updated_at` | high |
| LayoutPosition.cardId | data-model.md → `structure_layout_position.card_id` | high |
| LayoutPosition.cellIndex | data-model.md → `structure_layout_position.cell_index` | high |
| LayoutPosition.status | data-model.md → `structure_layout_position.status` (CHECK enum) | high |
| LayoutPosition.positionUpdatedAt | data-model.md → `structure_layout_position.position_updated_at` | high |
| LayoutPositionMoveRequest.cellIndex | data-model.md → `structure_layout_position.cell_index` | high |
| LayoutPositionMoveRequest.positionUpdatedAt | data-model.md → `structure_layout_position.position_updated_at` (client-supplied, LWW) | high |
| MetricTransfer.metricBlockId | `life-area-card/data-model.md` → `metric_block.id` (зовнішня сутність, поза цим data-model.md) | medium |
| MetricTransfer.targetCardId | `life-area-card/data-model.md` → `card.id` | medium |
| MetricTransfer.newLabel | `life-area-card/data-model.md` → `metric_block.label`, після перенесення (US-13/AC-15) | medium |
| getLayoutHistoryAsOf.asOf | derived from spec.md AC-07 (тренд) + sad.md §6 Потік 9, немає власної колонки — параметр запиту | medium |
| *Page.next_cursor / has_next / has_prev | derived (cursor-обгортка, конвенція skill) | high |

`MetricTransfer.*` — `medium`, не `high`: ці поля описують сутність з **чужого** `data-model.md` (`life-area-card`), не з цього. Позначено чесно, не приховано за `high`.

## Section B — drift findings (4-point checklist)

1. **Endpoint ↔ data-model** *(core)* — ✓. Кожен ендпоінт читає/пише `structure` чи `structure_layout_position`: `GET/PATCH /structure` → `structure`; `GET/PUT/POST /structure/layout*` → `structure_layout_position`. `GET /structure/layout/history` читає `structure_history_event` (База 2, окрема схема, ADR-0004) — те саме джерело, що Потік 9.
2. **Error code ↔ repo error definition** *(core)* — no error registry found — codes are the contract's proposal; reconcile when the repo defines them (проєкт ще не має живого коду бекенда — `architecture-map.md` §Migrations: «бекенд жодного разу не піднімався»).
3. **Validation ↔ constraint** *(core)* — ✓. `layoutMode` enum `[single, free, logic, null]` = `data-model.md` CHECK; `status` enum `[active, closed]` = `data-model.md` CHECK; `cellIndex` — `data-model.md` не задає верхньої межі (лише `INTEGER NOT NULL`) → контракт узяв `minimum: 0`, без `maximum` (щільність поля — «запас вільних клітинок», sad.md §5.2, конкретне число не зафіксовано жодним джерелом; не вигадую).
4. **OpenAPI ↔ sequence** *(supporting)* — ✓ з одним зафіксованим винятком нижче.

### Зафіксований виняток (не помилка, свідома межа контракту)

**Потік 6 (`renamed` — перейменування картки)** у `sad.md §6` показує гілку `alt перейменовує картку`, але **жодного ендпоінта під неї в цьому контракті немає.** Це не пропуск: перейменування — операція над `card.name`, яка належить `life-area-card`, не `structure` (spec.md §1: «Структура не описує поля картки»). Той самий бекенд-сервер (D-24 — один мінімальний бекенд) обробляє це через **свій майбутній** ендпоінт `life-area-card` (ще не написаний — `/sdd:api life-area-card` не запускали), який після перейменування сам пише подію в сервіс літопису Структури — внутрішній міжфічевий виклик, не публічна операція цього контракту. **Save-as-OQ:** власник — `/sdd:api life-area-card`, due — коли той контракт пишеться, переконатись, що ендпоінт перейменування явно документує цей побічний ефект.

**Потік 8 (нова картка отримує дефолтну позицію, AC-09)** — так само внутрішній побічний ефект: `life-area-card`'s `POST /cards` (ще не написаний) автоматично створює рядок у `structure_layout_position`. Не публічна операція цього контракту.

**Потік 2 / Потік 6 — недоступність сервісу літопису** — `sad.md §11` явно лишає це відкритим питанням (блокувати запис чи чергувати). Контракт **не визначає** поведінку `PUT/POST /structure/layout/{cardId}` у цьому випадку — задокументовано як TBD у `description` обох операцій, не вигадано.

## Підсумок

0 core-помилок, 0 flags ≥3 — запуск не призупинявся. Один `medium`-кластер полів (`MetricTransfer.*`, чужа сутність) і два `Save-as-OQ` (перейменування й авто-розміщення нової картки — обидва належать майбутньому `/sdd:api life-area-card`) — задокументовані, не приховані.

**Наступний крок:** `/sdd:screens structure` (декларовано `web-frontend` у `target_surfaces`).
