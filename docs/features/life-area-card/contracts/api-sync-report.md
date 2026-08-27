# API sync report — life-area-card — 2026-08-27

## Section A — field-origins

| schema_path | origin | confidence |
|---|---|---|
| Card.id | data-model.md → `card.id` | high |
| Card.name | data-model.md → `card.name` | high |
| Card.description | data-model.md → `card.description` | high |
| Card.status | data-model.md → `card.status` (CHECK enum) | high |
| Card.aggregateProgress | derived (ADR-0001) — середнє часток `metric_block.progress`, обчислюється з сирих подій `entry`, не окрема колонка | medium |
| Card.dataWarning | inferred from spec.md AC-10 + sad.md §6 Flow 5 — обчислюється при читанні (Claude-перевірка), не зберігається | medium |
| Card.createdAt / updatedAt | data-model.md → `card.created_at` / `.updated_at` | high |
| MetricBlock.id | data-model.md → `metric_block.id` | high |
| MetricBlock.cardId | data-model.md → `metric_block.card_id` (FK) | high |
| MetricBlock.label / unit / frequency | data-model.md → `metric_block.label` / `.unit` / `.frequency` | high |
| MetricBlock.targetCount / targetDate | data-model.md → `metric_block.target_count` / `.target_date` | high |
| MetricBlock.isOngoing | data-model.md → `metric_block.is_ongoing` | high |
| MetricBlock.progress | derived (ADR-0001) — з сирих `entry`, capped на 1.0 (AC-09b); NULL коли `is_ongoing` без денумератора | medium |
| MetricBlock.overGoalAmount | derived (AC-09b) — сума понад ціль, той самий розрахунок, окреме поле | medium |
| MetricBlock.createdAt / updatedAt | data-model.md → `metric_block.created_at` / `.updated_at` | high |
| MetricBlockTransferRequest.sourceMetricBlockId | data-model.md → `metric_block.id` (джерело — картка, що закривається) | high |
| MetricBlockTransferRequest.newLabel | data-model.md → `metric_block.label` (після перенесення, AC-15) | high |
| Entry.id | data-model.md → `entry.id` | high |
| Entry.metricBlockId / cardId | data-model.md → `entry.metric_block_id` / `.card_id` (FK, денормалізовано) | high |
| Entry.amount | data-model.md → `entry.amount` | high |
| Entry.rawText | data-model.md → `entry.raw_text` | high |
| Entry.status | data-model.md → `entry.status` (CHECK enum, ADR-0002) | high |
| Entry.sourceDeviceId | data-model.md → `entry.source_device_id` | high |
| Entry.recordedAt / confirmedAt / createdAt | data-model.md → `entry.recorded_at` / `.confirmed_at` / `.created_at` | high |
| *Page.next_cursor / has_next / has_prev | derived (cursor-обгортка, конвенція skill) | high |

`aggregateProgress`/`dataWarning`/`progress`/`overGoalAmount` — `medium`, не `high`: обчислювані поля без власної колонки, узгоджені з ADR-0001 («ніколи не кешуємо готове число»), не приховані як `high`.

## Section B — drift findings (4-point checklist)

1. **Endpoint ↔ data-model** *(core)* — ✓. `POST/GET/PATCH/DELETE /cards*` → `card`; `POST /cards/{id}/metric-blocks*` → `metric_block`; `POST/PATCH /entries*` (і вкладений шлях запису) → `entry`. `card_lifecycle_event` — жодного власного ендпоінта, лише службовий журнал переходів (пишеться попутно при `PATCH`/`DELETE`, ніколи не читається клієнтом напряму в цій версії — той самий підхід, що `agent_audit_event` у контракті `agent`).
2. **Error code ↔ repo error definition** *(core)* — no error registry found — codes are the contract's proposal; reconcile when the repo defines them (бекенд ще жодного разу не піднімався, `architecture-map.md §Migrations`).
3. **Validation ↔ constraint** *(core)* — ✓. `Card.status`/`Entry.status` enum = відповідні `CHECK` у `data-model.md`.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓ з двома задокументованими межами нижче.

### Зафіксовані свідомі межі (не помилки)

- **Записи (`POST`/`PATCH entries`) викликає `agent` API, не сам користувач.** `sad.md §6` Flow 3 і Flow 7 (agent) уже показують цей самий виклик з боку агента; тут — дзеркальний бік контракту, який agent's `confirm`/`ask-agent` викликають. Не дублюю опис послідовності, лише посилаюсь.
- **`POST /cards/{id}/metric-blocks/transfer` викликає `structure` API**, не користувач напряму — `structure/contracts/openapi.yaml`'s `POST /structure/layout/{cardId}` (`metricTransfers`) уже позначив цей побічний ефект як «Save-as-OQ: власник — `/sdd:api life-area-card`, due — коли той контракт пишеться» ([`structure/contracts/api-sync-report.md`](../../structure/contracts/api-sync-report.md)). **Закрито цим проходом** — ендпоінт написано, `newLabel`-параметр узгоджений з полем, яке `structure`'s `MetricTransfer.newLabel` уже передає.
- **`structure`'s Потік 8 (нова картка отримує дефолтну позицію, AC-09) і Потік 6 (перейменування картки)** — обидва позначені в `structure/contracts/api-sync-report.md` як внутрішні побічні ефекти `life-area-card`'s `POST /cards`/`PATCH /cards/{id}`, не публічні операції `structure`'s контракту. Цей контракт **не документує зворотний виклик у `structure`** (створення дефолтної позиції, синхронізація перейменування) як окрему операцію — це внутрішня деталь реалізації (той самий бекенд-процес, D-24), не HTTP-виклик між сервісами. Позначено тут для повноти, не Save-as-OQ (немає окремого контракту, який це мав би зафіксувати).

## Back-feed coverage — §4 use-case pass

| US | Операція(ї) |
|---|---|
| US-01 | `POST /cards` |
| US-02 | `PATCH /cards/{id}`, `POST /cards/{id}/metric-blocks` |
| US-03 | `POST .../entries` (викликає `agent`) |
| US-04 | `GET /cards/{id}` (`aggregateProgress`, `MetricBlock.progress`) |
| US-05 | `GET /cards/{id}` (`dataWarning`) |
| US-06 | `POST /cards/{id}/metric-blocks` (`isOngoing`) |
| US-07 | `POST .../entries` (pending-гілка) + `PATCH /entries/{id}` |
| US-08 | `POST /cards/{id}/metric-blocks` (результат діалогу з агентом) |
| US-09 | відсутність виклику `POST metric-blocks` — не окрема операція |
| US-10 | глобально — `401`/`404` non-disclosure на кожному ендпоінті |
| US-11 | `POST .../entries` (pending) + `PATCH /entries/{id}` |
| US-12 | `GET /cards/{id}/entries`, `PATCH /entries/{id}` |
| US-13 | `POST /cards/{id}/metric-blocks/transfer` |
| US-14 | `DELETE /cards/{id}` |

Усіх 14 US мають ≥1 операцію.

## Back-feed coverage — §5 AC pass

| AC | Операція / відповідь |
|---|---|
| AC-01 | `POST .../entries` 201, `status: confirmed` |
| AC-02 | `POST /cards` 422 `card.name_required` |
| AC-03 | `PATCH /cards/{id}` 422 `card.description_required` |
| AC-04 | `404 card.not_found` на будь-якому ендпоінті картки (non-disclosure) |
| AC-05 | `MetricBlock.isOngoing` + `progress` без денумератора |
| AC-06 | `POST .../entries` 201, `status: pending` + `PATCH /entries/{id}` |
| AC-07 | `POST metric-blocks` — результат діалогу, без структурного маркера |
| AC-08 | відсутність `metric-blocks` → `Card.aggregateProgress: null` |
| AC-09 | `GET /cards/{id}` → `MetricBlock.progress` |
| AC-09b | `MetricBlock.progress` (capped 1.0) + `overGoalAmount` |
| AC-10 | `GET /cards/{id}` → `Card.dataWarning` |
| AC-11 | `POST .../entries` `status: pending` до підтвердження |
| AC-12 | `PATCH /entries/{id}` → `status: rejected` (виправлення/відкат) |
| AC-13 | `GET /cards/{id}/entries` |
| AC-14 | `POST metric-blocks/transfer` 200 |
| AC-15 | `POST metric-blocks/transfer` 409 `metric_block.name_collision` |
| AC-16 | `DELETE /cards/{id}` 200, `status: archived` |

Усіх 17 AC зі `spec.md §5` показано.

## `events.md` — не написано

`target_surfaces: [backend-service, web-frontend]` — жодного `worker`, жодного async-потоку в `sad.md §6` (Flow 7 показує conditional-гілку «агент доступний/недоступний», не async retry/dead-letter патерн). Немає що документувати.

## Підсумок

0 core-помилок, 0 flags ≥3 — запуск не призупинявся. Дві крос-фічеві залежності (записи через `agent`, перенесення метрики через `structure`) задокументовано як свідомі межі, одна раніше відкрита `structure`'s Save-as-OQ — **закрита цим проходом**.

**Наступний крок:** `/sdd:ux-flows life-area-card` (декларовано `web-frontend` у `target_surfaces`).
