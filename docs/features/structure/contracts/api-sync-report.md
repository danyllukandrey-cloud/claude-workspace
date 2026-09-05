# API sync report — structure — 2026-08-24

> **Reconcile pass 2026-09-05** ([ISS-14](../../../ISSUES.md), [ISS-16](../../../ISSUES.md)) — `logicVariant` додано в контракт услід за `data-model.md`/`spec.md` (D-83/D-93), доданий одразу нижче в Section A/B, решта звіту від 2026-08-24 лишається без змін.

## Section A — field-origins

| schema_path | origin | confidence |
|---|---|---|
| Structure.id | data-model.md → `structure.id` | high |
| Structure.declaration | data-model.md → `structure.declaration` | high |
| Structure.layoutMode | data-model.md → `structure.layout_mode` (CHECK enum) | high |
| Structure.logicVariant | data-model.md → `structure.logic_variant` (CHECK enum, D-83) | high |
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
3. **Validation ↔ constraint** *(core)* — ✓. `layoutMode` enum `[single, free, logic, null]` = `data-model.md` CHECK; `logicVariant` enum `[balance, focus, cause_effect, null]` = `data-model.md` CHECK (D-83); `status` enum `[active, closed]` = `data-model.md` CHECK; `cellIndex` — `data-model.md` не задає верхньої межі (лише `INTEGER NOT NULL`) → контракт узяв `minimum: 0`, без `maximum` (щільність поля — «запас вільних клітинок», sad.md §5.2, конкретне число не зафіксовано жодним джерелом; не вигадую). Крос-польовий інваріант `logic_variant IS NULL` при `layout_mode != 'logic'` — `data-model.md` прямо каже, що на рівні БД CHECK на цю пару нема, тримає app-шар (T4/T11); контракт відображає це окремим кодом помилки `structure.logic_variant_requires_logic_mode` (422), не покладається на БД.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓ з одним зафіксованим винятком нижче. **Примітка (2026-09-05):** `sad.md §6` не має окремої діаграми на US-12/AC-16/AC-16b (вибір і зміна підвиду «за логікою») — сам `spec.md` AC-16b каже «treats the switch the same way as AC-11b», тобто це той самий механізм, що вже намальований у «Critical flow 11» (зміна `layoutMode` скидає розкладку), лише без окремого зображення для `logicVariant`. Не Save-as-OQ: поведінка описана, механізм той самий, дублювати діаграму заради іншого імені поля сенсу нема.

### Зафіксований виняток (не помилка, свідома межа контракту)

**Потік 6 (`renamed` — перейменування картки)** у `sad.md §6` показує гілку `alt перейменовує картку`, але **жодного ендпоінта під неї в цьому контракті немає.** Це не пропуск: перейменування — операція над `card.name`, яка належить `life-area-card`, не `structure` (spec.md §1: «Структура не описує поля картки»). Той самий бекенд-сервер (D-24 — один мінімальний бекенд) обробляє це через `life-area-card`'s `PATCH /cards/{id}`, який після перейменування сам пише подію в сервіс літопису Структури — внутрішній міжфічевий виклик, не публічна операція цього контракту.

~~Save-as-OQ: власник — /sdd:api life-area-card, due — коли той контракт пишеться~~ — **закрито 2026-08-27**: `/sdd:api life-area-card` запущено, [`life-area-card/contracts/api-sync-report.md`](../../life-area-card/contracts/api-sync-report.md) підтверджує той самий внутрішній побічний ефект (не окрема операція, той самий бекенд-процес).

**Потік 8 (нова картка отримує дефолтну позицію, AC-09)** — так само внутрішній побічний ефект: `life-area-card`'s `POST /cards` автоматично створює рядок у `structure_layout_position`. Не публічна операція цього контракту.

**Потік 2 / Потік 6 — недоступність сервісу літопису** — `sad.md §11` явно лишає це відкритим питанням (блокувати запис чи чергувати). Контракт **не визначає** поведінку `PUT/POST /structure/layout/{cardId}` у цьому випадку — задокументовано як TBD у `description` обох операцій, не вигадано.

## Підсумок

0 core-помилок, 0 flags ≥3 — запуск не призупинявся. Один `medium`-кластер полів (`MetricTransfer.*`, чужа сутність) і два внутрішні побічні ефекти `life-area-card` (перейменування картки, авто-розміщення нової картки) — задокументовані, не приховані. Перший (перейменування) мав Save-as-OQ, **закритий 2026-08-27** — `/sdd:api life-area-card` тепер існує.

**Наступний крок (знімок 2026-08-24, застаріло):** `/sdd:screens structure` (декларовано `web-frontend` у `target_surfaces`) — **виконано 2026-08-24**, як і `/sdd:ux-flows`/`/sdd:tasks`/`/sdd:plan-tests` (`DELIVERY-PLAN.md` §Частина 2). Реальний наступний крок на 2026-09-05 — `/sdd:implement structure`, коли до нього дійде черга (зараз у роботі `life-area-card`).
