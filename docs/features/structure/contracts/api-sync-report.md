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

1. **Endpoint ↔ data-model** *(core)* — ✓. Кожен ендпоінт читає/пише `structure` чи `structure_layout_position`: `GET/PATCH /structure` → `structure`; `GET/PUT/POST /structure/layout*` → `structure_layout_position`. `GET /structure/layout/history` читає `structure_history_event` (та сама база, звичайна таблиця в спільному бекенді, D-113) — те саме джерело, що Потік 9.
2. **Error code ↔ repo error definition** *(core)* — no error registry found — codes are the contract's proposal; reconcile when the repo defines them (проєкт ще не має живого коду бекенда — `architecture-map.md` §Migrations: «бекенд жодного разу не піднімався»).
3. **Validation ↔ constraint** *(core)* — ✓. `layoutMode` enum `[single, free, logic, null]` = `data-model.md` CHECK; `logicVariant` enum `[balance, focus, cause_effect, null]` = `data-model.md` CHECK (D-83); `status` enum `[active, closed]` = `data-model.md` CHECK; `cellIndex` — `data-model.md` не задає верхньої межі (лише `INTEGER NOT NULL`) → контракт узяв `minimum: 0`, без `maximum` (щільність поля — «запас вільних клітинок», sad.md §5.2, конкретне число не зафіксовано жодним джерелом; не вигадую). Крос-польовий інваріант `logic_variant IS NULL` при `layout_mode != 'logic'` — `data-model.md` прямо каже, що на рівні БД CHECK на цю пару нема, тримає app-шар (T4/T11); контракт відображає це окремим кодом помилки `structure.logic_variant_requires_logic_mode` (422), не покладається на БД.
4. **OpenAPI ↔ sequence** *(supporting)* — ✓ з одним зафіксованим винятком нижче. **Примітка (2026-09-05):** `sad.md §6` не має окремої діаграми на US-12/AC-16/AC-16b (вибір і зміна підвиду «за логікою») — сам `spec.md` AC-16b каже «treats the switch the same way as AC-11b», тобто це той самий механізм, що вже намальований у «Critical flow 11» (зміна `layoutMode` скидає розкладку), лише без окремого зображення для `logicVariant`. Не Save-as-OQ: поведінка описана, механізм той самий, дублювати діаграму заради іншого імені поля сенсу нема.

### Зафіксований виняток (не помилка, свідома межа контракту)

**Потік 6 (`renamed` — перейменування картки)** у `sad.md §6` показує гілку `alt перейменовує картку`, але **жодного ендпоінта під неї в цьому контракті немає.** Це не пропуск: перейменування — операція над `card.name`, яка належить `life-area-card`, не `structure` (spec.md §1: «Структура не описує поля картки»). Той самий бекенд-сервер (D-24 — один мінімальний бекенд) обробляє це через `life-area-card`'s `PATCH /cards/{id}`, який після перейменування сам пише подію в таблицю `structure_history_event` — звичайний виклик функції й SQL-запис у тій самій транзакції, не окрема публічна операція цього контракту.

~~Save-as-OQ: власник — /sdd:api life-area-card, due — коли той контракт пишеться~~ — **закрито 2026-08-27**: `/sdd:api life-area-card` запущено, [`life-area-card/contracts/api-sync-report.md`](../../life-area-card/contracts/api-sync-report.md) підтверджує той самий внутрішній побічний ефект (не окрема операція, той самий бекенд-процес).

**Потік 8 (нова картка отримує дефолтну позицію, AC-09)** — так само внутрішній побічний ефект: `life-area-card`'s `POST /cards` автоматично створює рядок у `structure_layout_position`. Не публічна операція цього контракту.

## Підсумок

0 core-помилок, 0 flags ≥3 — запуск не призупинявся. Один `medium`-кластер полів (`MetricTransfer.*`, чужа сутність) і два внутрішні побічні ефекти `life-area-card` (перейменування картки, авто-розміщення нової картки) — задокументовані, не приховані. Перший (перейменування) мав Save-as-OQ, **закритий 2026-08-27** — `/sdd:api life-area-card` тепер існує.

**Наступний крок (знімок 2026-08-24, застаріло):** `/sdd:screens structure` (декларовано `web-frontend` у `target_surfaces`) — **виконано 2026-08-24**, як і `/sdd:ux-flows`/`/sdd:tasks`/`/sdd:plan-tests` (`DELIVERY-PLAN.md` §Частина 2). Реальний наступний крок на 2026-09-05 — `/sdd:implement structure`, коли до нього дійде черга (зараз у роботі `life-area-card`).

---

## Reconcile — 2026-09-11 (після review-fix хвилі, ISS-100)

`/sdd:api structure --reconcile`. `implement` завершився (27/27), потім незалежне рев'ю (`review-2026-09-11.md`) знайшло реальний код, що розходиться з контрактом вище. Дві розбіжності, обидві виправлені в `openapi.yaml`:

1. **`LayoutPosition.cellIndex` мав `type: integer` без null.** Міграція 06 (`data-model.md`, review-2026-09-11.md MUST-FIX 3) дозволила `cell_index NULL` у БД — "картка ще нікуди не розкладена" (AC-11b/AC-16b/AC-17). Контракт цього не допускав. **Виправлено:** `type: [integer, "null"]`, `minimum` стосується лише не-null значення. `LayoutPositionMoveRequest.cellIndex` (тіло PUT-запиту користувача) НЕ чіпав — користувач завжди тягне картку на конкретну клітинку, "перемістити в нікуди" через цей ендпоінт неможливо за задумом.
2. **`POST /structure/layout/{cardId}/close` не документував `409`.** Код (`layout-handlers.ts`, через `transferMetricBlock` з `life-area-card`) реально кидає `metric_block.name_collision`/409, коли перенесена метрика конфліктує назвою+одиницею на цільовій картці без `newLabel` — контракт знав лише 200/401/404/422 (знахідка `review-2026-09-11.md`, Частина 2, WP1 п.2 "T18: 409 протікає повз контракт"). **Виправлено:** додано `409` з прикладом.

**Sequence gap, зафіксовано чесно, не приховано:** `sad.md` "Critical flow 6" (AC-12/AC-15) не малює окрему `alt`-гілку на цю колізію — постумова лише текстом каже "перенос метрик лишається доменною логікою life-area-card". Save-as-OQ, власник — `/sdd:sequences structure`, due — до наступного `/sdd:review`: додати `alt`-гілку 409 у Critical flow 6, якщо колись знадобиться перемалювати цю діаграму; не блокує контракт зараз (код і так коректно повертає 409, діаграма лише не показує чому).

0 core-помилок цього прогону. `info.version` не піднімав (правило skill — вручну, окремим CHANGELOG-рядком, коли буде реліз).

---

## Reconcile — 2026-09-15 (вимоги 14/15, Андрій, чат — плоска модель)

Ручне реконсилювання поруч зі зміною коду (не окремий запуск `/sdd:api --reconcile`) — контракт, `data-model.md` і код мінялись разом, тим самим коммітом-набором.

**Зміна:** `Structure.layoutMode` + `Structure.logicVariant` (два поля, друге мало сенс лише при `layoutMode = 'logic'`) злиті в ОДНЕ поле `layoutMode` з 5 значеннями (`balance`/`focus`/`cause_effect`/`free`/`staging`). `single` ("одна картка") скасований повністю. `logicVariant` прибраний зі схеми `Structure` і `StructureUpdate` повністю — більше не існує ні як поле запиту, ні як поле відповіді.

Наслідки для Section A/B вище (історичні записи там НЕ переписані — цей запис їх доповнює, не замінює):

- Section A, рядок `Structure.logicVariant` → **прибраний** (поля більше нема).
- Section A, рядок `Structure.layoutMode` → `origin` лишається `data-model.md → structure.layout_mode`, лише enum тепер 5 значень замість 3.
- Section B п.3 (Validation ↔ constraint) → `logicVariant` enum і крос-польовий інваріант `logic_variant IS NULL` — обидва прибрані разом зі стовпцем; `structure.logic_variant_requires_logic_mode` (422) видалений з контракту, лишається лише `structure.invalid_layout_mode`.
- Section B п.4 (OpenAPI ↔ sequence) → примітка про відсутню окрему діаграму US-12/AC-16/AC-16b втрачає предмет: US-12 злитий у US-02, AC-16b злитий у AC-11b (`spec.md`) — нема більше окремого механізму, про який могло бракувати діаграми.

0 core-помилок цього прогону.
