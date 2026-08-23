# Data-model audit — life-area-card — 2026-08-23

## Прогалина, знайдена й закрита перед стартом

Технологія БД мінімального бекенда (D-24) ніколи не була обрана — ADR-0003 згадувала PostgreSQL/SQLite лише як відхилений варіант з версії «бекенда взагалі нема» (2026-07-02). Закрито продуктовим [ADR-0005](../../adr/0005-backend-datastore.md) + [D-59](../../DECISIONS.md#d-59): **PostgreSQL**. `architecture-map.md` оновлено (стек + новий розділ `§Migrations`).

## Конвенції — greenfield, підтверджено з Андрієм 2026-08-23

Жодного сигналу з репозиторію (жоден бекенд-код чи міграція ще не існують) — усі нижче підтверджені в Socratic-проході, не за замовчуванням:

- PK: UUID, `crypto.randomUUID()` в app-шарі (уже було в architecture-map.md §Конвенції — не нове).
- 4 сутності всередині картки (root: `card`): `metric_block`, `entry`, `card_lifecycle_event` — усі підпорядковані.
- Видалення/відкат запису (AC-12): **статус `rejected`, фізичне видалення ніколи** — зберігає слід для історії (US-12).
- CHECK-обмеження використані (`entry.status`, `card_lifecycle_event.transition`) — greenfield-рішення цієї сесії, не нав'язана філософія.

## Стагінг-міграції

Усі під `docs/features/life-area-card/migrations/`, фіче-локальна нумерація `01`…`04`. **Не в живому дереві `migrations/`** — `implement` призначить реальний номер/інструмент при промоції (конкретний інструмент міграцій для Postgres ще не обраний, `architecture-map.md §Migrations`).

| # | Файл | Сутність |
|---|---|---|
| 01 | `01_create_card.up.sql` / `.down.sql` | `card` |
| 02 | `02_create_metric_block.up.sql` / `.down.sql` | `metric_block` |
| 03 | `03_create_entry.up.sql` / `.down.sql` | `entry` |
| 04 | `04_create_card_lifecycle_event.up.sql` / `.down.sql` | `card_lifecycle_event` |

**Промоційна підказка:** інструмент міграцій для Postgres не обраний (`architecture-map.md §Migrations`) — `implement` вибере його разом з першим підняттям бекенда й призначить реальні номери в порядку `01`→`04`.

## Незакриті TBD (свідомо, не забуті)

- `card.owner_user_id` — без DB-рівня FK: таблиця `users`/автентифікації не належить цій фічі (D-33), FK додасться, коли її створить власна фіча (ймовірно `agent`).
- `metric_block.target_date` vs `is_ongoing` — взаємовиключність не забезпечена CHECK, лише позначена нотаткою; рішення — чи вартий DB CHECK, чи досить перевірки в domain-коді — лишається на `implement`.
- Конкретний інструмент міграцій для Postgres (node-pg-migrate / Prisma Migrate / інше) — обирається, коли бекенд вперше scaffold-иться.

## Дрейф (крок 11)

N/A — коду картки ще немає (лише scaffold-заглушки), Explore-скан домену не знайшов існуючих полів для звірки.

## Самоперевірка (крок 12, 4 обов'язкові)

- ✅ **Найменування** — жодної попередньої конвенції в репозиторії не було (greenfield); встановлено тут: `snake_case` таблиці й колонки, стандартна Postgres-практика.
- ✅ **Reversibility** — кожен `CREATE TABLE` має парний `DROP TABLE`, кожен `CREATE INDEX` — парний `DROP INDEX` (перевірено по всіх 4 парах файлів).
- ✅ **FK-індекси** — кожен `REFERENCES` має індекс на FK-колонці: `metric_block.card_id` → `idx_metric_block_card`; `entry.metric_block_id` → `idx_entry_metric_block`; `entry.card_id` → покрито композитними `idx_entry_card_recorded`/`idx_entry_card_pending`; `card_lifecycle_event.card_id` → `idx_lifecycle_card_time`.
- ✅ **Відповідність конвенції** — конвенції встановлені цією сесією (немає попередньої, з якою звіряти); відхилень від architecture-map.md немає, PK-стратегія (`crypto.randomUUID()`) — точне продовження вже чинної конвенції.

## Наступний крок

`/sdd:api life-area-card` — контракт ендпоінтів картки (створення, запис події, читання історії/прогресу, перевірка конфлікту).
