# Data-model audit — structure — 2026-08-24

## Staged migrations (NOT live — `implement` promotes them)

**База 1 — основний бекенд** (PostgreSQL, D-59; той самий інстанс, що `life-area-card`):
- `docs/features/structure/migrations/backend/01_create_structure.up.sql` / `.down.sql`
- `docs/features/structure/migrations/backend/02_create_structure_layout_position.up.sql` / `.down.sql`

**База 2 — сховище літопису Структури** (окрема схема/інстанс PostgreSQL, ADR-0004 + D-67):
- `docs/features/structure/migrations/history-service/01_create_structure_history_event.up.sql` / `.down.sql`

## Promote-time convention hint

Репозиторій ще жодного разу не піднімав жодну з двох баз (`architecture-map.md §Migrations` — «бекенд жодного разу не піднімався», DELIVERY-PLAN «Розробка» 5%) і конкретний інструмент міграцій (наприклад `node-pg-migrate` / `Prisma Migrate` / `golang-migrate`) ще не обраний. `life-area-card` уже застосувала фіче-локальну нумерацію `01_`, `02_`, `03_`, `04_` у своїй базі — Структура продовжує ту саму послідовність **у межах Бази 1** (`01_`, `02_`), незалежно нумерує Базу 2 (окрема фізична база, власна послідовність `01_`). `implement` призначить реальні номери/timestamp окремо для кожної бази, коли обиратиме інструмент і вперше піднімає відповідний деплой-юніт.

## Конвенції, яким слідували (виявлено з `life-area-card/data-model.md` + `migrations/`)

- PK: UUID, app-generated (`crypto.randomUUID()`), без DB-default.
- Рядки: `TEXT`, не `VARCHAR(N)`.
- Аудит-колонки: `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()` де поле дійсно редагується.
- Перелічувані значення — `CHECK` на `TEXT`-колонці, не окремий ENUM-тип.
- Видалення — **завжди м'яке** (статус-колонка), ніколи фізичне (`entry.status` → тут `structure_layout_position.status`, [D-66](../../DECISIONS.md#d-66)).
- `owner_user_id` без DB-рівня FK, доки нема таблиці users (D-33) — той самий TBD-стан, що й `card.owner_user_id`.
- `IF NOT EXISTS` на кожному CREATE — повторний прогін не падає.

## Свідоме відхилення від типового патерну — дві бази в одній фічі

Одна фіча зазвичай пише в одну базу. `structure` пише у дві (ADR-0004: сервіс літопису — окремий деплой-юніт з окремим сховищем). Тому:
- Дві секції в `data-model.md`, дві ER-діаграми, дві папки staged-міграцій (`migrations/backend/`, `migrations/history-service/`).
- `structure_id`/`card_id` у `structure_history_event` — **логічні** посилання, не DB FK (фізична межа бази робить справжній FK неможливим).

## Cross-feature FK

`structure_layout_position.card_id` — справжній FK на `card(id)` з `life-area-card` (та сама база). Можливо, бо `life-area-card` уже пройшла свій `data-model` і таблиця `card` реально існує в тій самій базі (D-59).

## Самоперевірка (4 обов'язкові)

- ✅ **Найменування** відповідає репозиторію (`snake_case`, `NN_create_<entity>.{up,down}.sql`).
- ✅ **Down-реверсивність** — кожен `CREATE TABLE` має `DROP TABLE`, кожен `CREATE INDEX` має `DROP INDEX` (перевірено вручну по кожній парі файлів).
- ✅ **Індекси на FK** — `structure_layout_position.structure_id` → `idx_layout_position_structure`; `.card_id` → `idx_layout_position_card`. (`structure.owner_user_id` без FK — свідомо, як і в `life-area-card`.)
- ✅ **Відповідність конвенціям репозиторію** — жодного нав'язаного стилю; єдине відхилення (дві бази) явно задокументоване вище, не мовчазне.

## Дрейф (drift)

Не застосовується — greenfield, робочого коду домену `structure` ще немає.

## `<!-- TBD -->` у документі

- `structure_history_event.detail` — точна форма (що саме зберігати як деталь події) вирішується разом з майбутнім екраном перегляду літопису, поза v1.

## Відкриті питання, що впливають на майбутні зміни схеми (не вирішую тут)

- [D-65](../../DECISIONS.md#d-65) — перенесення метрики закритої картки в іншу: коли `life-area-card` отримає відповідний AC, це, ймовірно, нова колонка/подія в **його** схемі, не в `structure`.
- [D-66](../../DECISIONS.md#d-66) — реальне фізичне видалення картки: коли `life-area-card` отримає стан «видалено», `structure_layout_position.card_id` ON DELETE CASCADE вже готовий це коректно відобразити (рядок позиції зникне разом із карткою).

**Наступний етап:** `/sdd:api structure`.
