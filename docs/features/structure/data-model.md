---
status: Draft
owner: "Андрій Данилюк"
reviewers: []
updated_at: "2026-09-15"
feature_size: "M"
---

# Data model — structure

> **Одна база.** І `structure`/`structure_layout_position`, і Літопис (`structure_history_event`) живуть в одній і тій самій PostgreSQL-базі мінімального бекенда (D-24, D-59) — той самий процес, звичайні FK між таблицями. Раніше запланована окрема схема/інстанс для літопису (ADR-0004, D-67) скасована [D-113](../../DECISIONS.md#d-113): окремого деплой-юніту й окремої бази нема. Тому нижче — дві секції за темами (Структура/розкладка і Літопис), а не за різними базами, кожна зі своєю ER-діаграмою.
>
> PK-стратегія: UUID, генерується в app-шарі через `crypto.randomUUID()` ([architecture-map.md §Конвенції](../../architecture-map.md)) — той самий підхід, що й `life-area-card/data-model.md`. Аудит-колонки й видалення — той самий стиль: `created_at`/`updated_at` де є сенс, **ніколи фізичне видалення**, лише статус ([D-66](../../DECISIONS.md#d-66), той самий підхід, що вже застосований до `entry.status` у `life-area-card`).

## Структура і розкладка (PostgreSQL, D-59)

### ER diagram

```mermaid
erDiagram
    STRUCTURE ||--o{ STRUCTURE_LAYOUT_POSITION : has
    CARD ||--o| STRUCTURE_LAYOUT_POSITION : "placed by (life-area-card)"

    STRUCTURE {
        uuid id PK
        uuid owner_user_id
        text declaration
        text layout_mode
        timestamptz created_at
        timestamptz updated_at
    }
    STRUCTURE_LAYOUT_POSITION {
        uuid id PK
        uuid structure_id FK
        uuid card_id FK
        int cell_index
        text status
        timestamptz position_updated_at
        timestamptz created_at
    }
```

`CARD` — таблиця `life-area-card` (не власність цієї фічі; показана лише як зв'язок, схема — в [`life-area-card/data-model.md`](../life-area-card/data-model.md)).

### Entities

#### `structure`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, app-generated | `crypto.randomUUID()` |
| `owner_user_id` | UUID | NOT NULL, UNIQUE, FK → `app_user(id)` ON DELETE CASCADE | singleton на користувача (AC-03) — UNIQUE забезпечує «рівно одна Структура на власника». FK додано 2026-08-29, міграція 03 — `agent`'s `app_user` (migration 01) тепер існує. Закриває TBD від 2026-08-24; вмикає каскадне видалення акаунта (agent AC-17, D-89) |
| `declaration` | TEXT | NULL | картина світу / навіщо / пріоритет, вільний текст (AC-10); NULL, доки не написано |
| `layout_mode` | TEXT | NULL, CHECK (`layout_mode` IN ('balance','focus','cause_effect','free','staging')) | **Плоска модель, вимоги 14/15 (Андрій, чат), staged-міграція `07_flatten_layout_mode`.** Раніше — два поля: `layout_mode IN ('single','free','logic')` + окремий `logic_variant IN ('balance','focus','cause_effect')`, що мав сенс лише коли `layout_mode = 'logic'` ([D-83](../../DECISIONS.md#d-83)). Тепер — ОДНЕ поле, 5 рівноправних значень: `balance` = баланс навколо ядра, `focus` = фокус і спостереження, `cause_effect` = причина і наслідок (ті самі три, що раніше жили в `logic_variant`, тепер топ-рівневі), `free` = вільна розкладка (перейменування підпису колишнього `free`, та сама поведінка), `staging` = готово до розкладання (**НОВИЙ** — картки з'являються внизу екрана без клітинки, користувач розкладає сам; `defaultPositionForNewCard`, domain/layout.ts, свідомо НЕ дає нову клітинку автоматично, поки цей режим активний). `single` («одна картка») **скасований повністю** — навіщо режим «одна картка», якщо картку й так можна створити рівно одну. **NULL = ще не обрано** — той самий принцип, що раніше (AC-09) |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | джерело часової мітки для last-write-wins при офлайн-конфлікті (ADR-0002) |

**Aggregate root:** root.
**Access patterns:** читання/запис Структури власника (AC-03, кожен запит) → UNIQUE-індекс на `owner_user_id` (створюється автоматично разом з обмеженням).
**Constraints:** UNIQUE на `owner_user_id`; CHECK на `layout_mode` (5 значень). Колишній окремий CHECK на `logic_variant` і колишня app-шар-звірка «`logic_variant` має сенс лише при `layout_mode = 'logic'`» (T4/T11) прибрані разом зі стовпцем — плоска модель не має пари полів, яку треба узгоджувати.

#### `structure_layout_position`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, app-generated | |
| `structure_id` | UUID | NOT NULL, FK → `structure(id)` ON DELETE CASCADE | індексовано нижче |
| `card_id` | UUID | NOT NULL, FK → `card(id)` ON DELETE CASCADE | справжній cross-feature FK — таблиця `card` уже існує в тій самій базі (`life-area-card`) |
| `cell_index` | INTEGER | NULL | номер клітинки/позиції в межах фіксованої нумерованої схеми — той самий підхід і для вільного порядку, і для сітки «за логікою» ([sad.md §5.2](sad.md#5-building-block-view), «запас вільних клітинок»). **NULL = картка без клітинки** — лежить у треї нерозкладених унизу екрана, користувач тягне її на вільну клітинку сам: саме так існують AC-11b/AC-16b (після зміни режиму чи підвиду кожна активна позиція втрачає клітинку) і AC-17 (відновлена з архіву картка клітинки не отримує). Той самий принцип «NULL = ще не обрано», що й у `layout_mode`. Колонка була `NOT NULL` (міграція 02) — рев'ю 2026-09-11 показало, що при цьому стан «без клітинки» фізично неможливий і app-шар писав замість нього реальний номер; виправлено окремою міграцією 06 (`06_make_cell_index_nullable`), бо 02 уже промоучена ([ADR-0006](../../adr/0006-backend-http-and-migration-tool.md)) |
| `status` | TEXT | NOT NULL DEFAULT 'active', CHECK (`status` IN ('active','closed')) | [D-66](../../DECISIONS.md#d-66) — закриття напрямку (AC-12) позначає рядок, ніколи не видаляє фізично |
| `position_updated_at` | timestamptz | NOT NULL DEFAULT now() | часова мітка для last-write-wins (ADR-0002) — та сама позиція, синхронізована з іншого пристрою, порівнюється за цим полем |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Aggregate root:** `structure`.
**Access patterns:** список активних позицій розкладки (екран Схема) → індекс на `structure_id`; блокування розміщення на зайняту клітинку (AC-02) → частковий унікальний індекс на `(structure_id, cell_index)` де `status = 'active'`; де зараз розташована конкретна картка → індекс на `card_id`.
**Constraints:** UNIQUE на `(structure_id, card_id)` — одна позиція на картку; частковий UNIQUE на `(structure_id, cell_index)` WHERE `status = 'active'` — рівно одна активна картка в клітинці (AC-02, D-62 на рівні БД, не лише UI-перевірки); FK → `structure(id)`; FK → `card(id)`.
Жодного CHECK-обмеження рівня БД на `cell_index IS NOT NULL` немає навмисно: «без клітинки» — легальний стан (див. колонку вище). Частковий UNIQUE це не ламає — у Postgres два NULL не вважаються рівними, тож будь-яка кількість активних позицій без клітинки в одній Структурі співіснує, а заборона «дві картки в одній клітинці» працює лише для реальних номерів.

## Індекси (Структура і розкладка)

| Index | Columns | Query it serves |
|---|---|---|
| `idx_layout_position_structure` | `structure_layout_position(structure_id)` | список активних позицій на екрані Схема (US-02, US-03) |
| `uq_layout_position_active_cell` | `structure_layout_position(structure_id, cell_index) WHERE status = 'active'` | блокування розміщення на зайняту клітинку (AC-02) — гарантія на рівні БД, не лише перевірка в PWA (Потік 4) |
| `uq_layout_position_card` | `structure_layout_position(structure_id, card_id)` | одна позиція на картку; швидкий пошук поточної позиції картки (Потоки 2, 6) |
| `idx_layout_position_card` | `structure_layout_position(card_id)` | зворотний пошук — де зараз ця картка (AC-05 крос-контекст, каскад при видаленні картки `life-area-card`) |

## Літопис Структури (structure_history_event)

### ER diagram

```mermaid
erDiagram
    STRUCTURE_HISTORY_EVENT {
        uuid id PK
        uuid structure_id
        uuid card_id
        text event_type
        text detail
        timestamptz occurred_at
    }
```

`structure_id` і `card_id` тут — реальні DB-рівня FK (`ON DELETE CASCADE`) на `structure.id` і `card.id` — та сама база, той самий підхід, що вже використовує `structure_layout_position` (§Структура і розкладка).

### Entities

#### `structure_history_event`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, app-generated | |
| `structure_id` | UUID | NOT NULL | реальний FK на structure.id, ON DELETE CASCADE |
| `card_id` | UUID | NOT NULL | реальний FK на card.id (life-area-card), ON DELETE CASCADE |
| `event_type` | TEXT | NOT NULL, CHECK (`event_type` IN ('renamed','moved','closed')) | AC-12, AC-15 |
| `detail` | TEXT | NULL | вільний опис деталі події (нова назва / новий `cell_index`) — `<!-- TBD: точна форма вирішується разом з майбутнім екраном перегляду літопису, поза v1 (spec.md §3 Non-goals) -->` |
| `occurred_at` | timestamptz | NOT NULL DEFAULT now() | часова мітка події |

**Aggregate root:** root (незалежний журнал подій, не підпорядкований `structure` як частина того самого агрегату, але живе в тій самій базі).
**Access patterns:** історія однієї картки за часом (майбутній екран перегляду + тренд AC-07) → індекс на `(card_id, occurred_at)`; «яка була розкладка Структури на дату X» (AC-07, D-67 — читання, якого раніше не було) → індекс на `(structure_id, occurred_at)`, запит бере останню подію `moved` кожної картки з `occurred_at <= X`.
**Constraints:** CHECK на `event_type`.

## Індекси (Літопис Структури)

| Index | Columns | Query it serves |
|---|---|---|
| `idx_history_card_time` | `structure_history_event(card_id, occurred_at)` | історія конкретної картки за часом (майбутній екран перегляду, поза v1) |
| `idx_history_structure_time` | `structure_history_event(structure_id, occurred_at)` | реконструкція розкладки на дату X для тренду розриву (Потік 9, AC-07, D-67) |

## Test fixtures

- `buildStructure({ ownerUserId, declaration, layoutMode })` — Структура з дефолтним власником `user-<uuid>@example.test`; `layoutMode` — одне з 5 плоских значень або `null` (вимоги 14/15; колишній окремий `logicVariant`-параметр прибраний разом зі стовпцем).
- `buildLayoutPosition({ structureId, cardId, cellIndex, status })` — позиція розкладки, за замовчуванням `status: 'active'`.
- `buildStructureHistoryEvent({ structureId, cardId, eventType, detail })` — подія літопису для тестів AC-07/AC-12/AC-15.

## Дрейф (drift)

Greenfield-фіча — жодного домену `structure` в коді ще немає (той самий стан, що й `life-area-card` до свого `data-model`), тож перевірка дрейфу код↔схема неактуальна цього разу.

## Відкриті питання (перенесено в spec.md §8, не дублюю тут)

- Перенесення метрики закритої картки в іншу картку — `life-area-card` ще не має acceptance criterion на прийом ([D-65](../../DECISIONS.md#d-65)).
- Реальне фізичне видалення картки з колоди — окремий приріст `life-area-card` ([D-66](../../DECISIONS.md#d-66)).
- Точна форма `structure_history_event.detail` — вирішується з майбутнім екраном перегляду літопису.
