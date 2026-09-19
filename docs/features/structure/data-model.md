---
status: Draft
owner: "Андрій Данилюк"
reviewers: []
updated_at: "2026-09-15"
feature_size: "M"
---

> **D-131-наступне рішення (Андрій, чат, 2026-09-15).** "Схема не працює і вона жахлива. Пропоную прибрати повністю оті клітинки." Фіксована сітка клітинок (`cell_index`) прибрана ПОВНІСТЮ — Схема стає вільним полотном (canvas) зі зв'язками. `structure_layout_position` тепер несе `position_x`/`position_y` (відсоток канви, 0-100) замість `cell_index`; нова таблиця `structure_connection` тримає лінії/стрілки між картками. AC-02 (D-62, колізія клітинки) скасований — вільне позиціювання дозволяє карткам перекриватись.

# Data model — structure

> **Одна база.** І `structure`/`structure_layout_position`, і Літопис (`structure_history_event`) живуть в одній і тій самій PostgreSQL-базі мінімального бекенда (D-24, D-59) — той самий процес, звичайні FK між таблицями. Раніше запланована окрема схема/інстанс для літопису (ADR-0004, D-67) скасована [D-113](../../DECISIONS.md#d-113): окремого деплой-юніту й окремої бази нема. Тому нижче — дві секції за темами (Структура/розкладка і Літопис), а не за різними базами, кожна зі своєю ER-діаграмою.
>
> PK-стратегія: UUID, генерується в app-шарі через `crypto.randomUUID()` ([architecture-map.md §Конвенції](../../architecture-map.md)) — той самий підхід, що й `life-area-card/data-model.md`. Аудит-колонки й видалення — той самий стиль: `created_at`/`updated_at` де є сенс, **ніколи фізичне видалення**, лише статус ([D-66](../../DECISIONS.md#d-66), той самий підхід, що вже застосований до `entry.status` у `life-area-card`).

## Структура і розкладка (PostgreSQL, D-59)

### ER diagram

```mermaid
erDiagram
    STRUCTURE ||--o{ STRUCTURE_LAYOUT_POSITION : has
    STRUCTURE ||--o{ STRUCTURE_CONNECTION : has
    CARD ||--o| STRUCTURE_LAYOUT_POSITION : "placed by (life-area-card)"
    CARD ||--o{ STRUCTURE_CONNECTION : "endpoint A/B (life-area-card)"

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
        real position_x
        real position_y
        text status
        timestamptz position_updated_at
        timestamptz created_at
    }
    STRUCTURE_CONNECTION {
        uuid id PK
        uuid structure_id FK
        uuid card_id_a FK
        uuid card_id_b FK
        boolean directed
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
| `position_x` | REAL | NULL | **D-131-наступне рішення** (staged-міграція `08_add_position_xy`) — відсоток ширини канви (0-100), вільне позиціювання замість фіксованої сітки клітинок. `position_x`/`position_y` завжди приходять разом: **NULL/NULL = картка без позиції** — лежить у купці нерозкладених унизу екрана, користувач тягне її на канву сам (миша чи дотик, Pointer Events). Той самий принцип «NULL = ще не обрано», що й у `layout_mode`. Колонка `cell_index` (INTEGER, номер клітинки фіксованої сітки) **видалена** цією ж міграцією — жоден живий код її більше не читає, dead-колонка гірше за посилання на цю staged-міграцію в `MIGRATIONS.md`, якщо колись знадобиться згадати стару схему |
| `position_y` | REAL | NULL | Відсоток висоти канви (0-100) — той самий принцип NULL, що `position_x` |
| `status` | TEXT | NOT NULL DEFAULT 'active', CHECK (`status` IN ('active','closed')) | [D-66](../../DECISIONS.md#d-66) — закриття напрямку (AC-12) позначає рядок, ніколи не видаляє фізично |
| `position_updated_at` | timestamptz | NOT NULL DEFAULT now() | часова мітка для last-write-wins (ADR-0002) — та сама позиція, синхронізована з іншого пристрою, порівнюється за цим полем |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Aggregate root:** `structure`.
**Access patterns:** список активних позицій розкладки (екран Схема) → індекс на `structure_id`; де зараз розташована конкретна картка → індекс на `card_id`.
**Constraints:** UNIQUE на `(structure_id, card_id)` — одна позиція на картку; FK → `structure(id)`; FK → `card(id)`.
**AC-02 (D-62, колізія клітинки) скасована D-131-наступним рішенням** — вільне позиціювання дозволяє карткам перекриватись, тож частковий UNIQUE `uq_layout_position_active_cell` (раніше блокував дві активні картки в одній клітинці) видалений разом із `cell_index` тією самою міграцією; жодного обмеження рівня БД на `(position_x, position_y)` не додано навмисно.

## Індекси (Структура і розкладка)

| Index | Columns | Query it serves |
|---|---|---|
| `idx_layout_position_structure` | `structure_layout_position(structure_id)` | список активних позицій на екрані Схема (US-02, US-03) |
| `uq_layout_position_card` | `structure_layout_position(structure_id, card_id)` | одна позиція на картку; швидкий пошук поточної позиції картки (Потоки 2, 6) |
| `idx_layout_position_card` | `structure_layout_position(card_id)` | зворотний пошук — де зараз ця картка (AC-05 крос-контекст, каскад при видаленні картки `life-area-card`) |

## Зв'язки на Схемі (structure_connection, D-131-наступне рішення)

> Андрій, чат, 2026-09-15, вимоги 4/5: "Між блоками потрібно створити звязки. Тобто має зявитись інструмент зєднання яким ми зєднуємо блоки, можемо розєднати і перезєднати" + "якщо ми робимо стрілки то нам потрібно буде додати їх як інструментарій можливого з'єднання".

### Entities

#### `structure_connection`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, app-generated | `crypto.randomUUID()` |
| `structure_id` | UUID | NOT NULL, FK → `structure(id)` ON DELETE CASCADE | індексовано нижче |
| `card_id_a` | UUID | NOT NULL, FK → `card(id)` ON DELETE CASCADE | справжній cross-feature FK, той самий підхід, що `structure_layout_position.card_id` |
| `card_id_b` | UUID | NOT NULL, FK → `card(id)` ON DELETE CASCADE | |
| `directed` | BOOLEAN | NOT NULL DEFAULT false | `true` — стрілка `card_id_a -> card_id_b` (напрямок значущий, інструмент "Стрілка"); `false` — звичайна лінія (порядок a/b не несе сенсу, інструмент "Лінія") |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |

**Aggregate root:** `structure`.
**Access patterns:** усі зв'язки Структури (екран Схема, разом із позиціями) → індекс на `structure_id`.
**Constraints:** FK → `structure(id)`; FK → `card(id)` ×2 (`card_id_a`, `card_id_b`). Жодного UNIQUE на `(card_id_a, card_id_b)` навмисно: авто-розклад режиму `cause_effect` (domain/layout.ts) сам гарантує, що кожна пара з'являється рівно раз у своєму плані; ручне створення через інструмент "Зв'язати" — свідома дія користувача щоразу, і "розʼєднати й перезʼєднати" (вимога 4) не має наштовхуватись на заборону дубля.

## Індекси (Зв'язки)

| Index | Columns | Query it serves |
|---|---|---|
| `idx_structure_connection_structure` | `structure_connection(structure_id)` | список зв'язків Структури (екран Схема) |

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
- `buildLayoutPosition({ structureId, cardId, x, y, status })` — позиція розкладки (D-131-наступне рішення: `x`/`y` відсоток канви замість `cellIndex`), за замовчуванням `status: 'active'`.
- `buildConnection({ structureId, cardIdA, cardIdB, directed })` — зв'язок між двома картками, за замовчуванням `directed: false` (звичайна лінія).
- `buildStructureHistoryEvent({ structureId, cardId, eventType, detail })` — подія літопису для тестів AC-07/AC-12/AC-15. `detail` для `eventType: 'moved'` тепер несе `"pos_x -> N, pos_y -> M, prev_x -> ..., prev_y -> ..."` (../app/move-card.ts formatMovedDetail), не `"cell_index -> N"`.

## Дрейф (drift)

Greenfield-фіча — жодного домену `structure` в коді ще немає (той самий стан, що й `life-area-card` до свого `data-model`), тож перевірка дрейфу код↔схема неактуальна цього разу.

## Відкриті питання (перенесено в spec.md §8, не дублюю тут)

- Перенесення метрики закритої картки в іншу картку — `life-area-card` ще не має acceptance criterion на прийом ([D-65](../../DECISIONS.md#d-65)).
- Реальне фізичне видалення картки з колоди — окремий приріст `life-area-card` ([D-66](../../DECISIONS.md#d-66)).
- Точна форма `structure_history_event.detail` — вирішується з майбутнім екраном перегляду літопису.
