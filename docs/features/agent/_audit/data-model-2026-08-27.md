# Data-model audit — agent — 2026-08-27

## Рішення, ухвалені перед стартом (з Андрієм)

- **`app_user` створюється саме тут.** `life-area-card` і `structure` обидва навмисно відклали FK на таблицю користувачів, позначивши власника «ймовірно `agent`» — тут дійсно живе `infra/auth.ts` (Google-вхід, D-33). Само FK-обмеження в `card.owner_user_id`/`structure.owner_user_id` **не додається цим проходом** — окрема міграція тих фіч пізніше.
- **`long_term_memory_fact` — м'яке видалення** (`status IN ('active','deleted')`), той самий підхід, що й `card.status`/`entry.status` в `life-area-card`.

## Конвенції — успадковані від двох попередніх фіч, не greenfield

На відміну від `life-area-card`/`structure` (де конвенції підтверджувались Socratic-проходом з нуля), тут репозиторій уже має встановлений стиль:

- PK: UUID, `crypto.randomUUID()` в app-шарі — без змін.
- `TEXT` замість `VARCHAR(N)`, `NUMERIC`, `TIMESTAMPTZ` — той самий словник типів.
- `CHECK`-обмеження на enum-подібні статуси — той самий підхід (`agent_proposal.status`, `imperative_rule.category`, `long_term_memory_fact.status`, `chat_message.role`, `agent_audit_event.event_type`/`subject_type`, `activity_report.period_type`/`status`).
- Append-only лог-таблиці (`chat_message`, `agent_audit_event`) без `updated_at` — той самий патерн, що й `card_lifecycle_event`/`structure_history_event`.
- Мутовні сутності (`agent_proposal`, `imperative_rule`, `long_term_memory_fact`) з `created_at`+`updated_at` — той самий патерн, що й `card`/`metric_block`/`structure`.

**Нове порівняно з попередніми фічами:** часткові UNIQUE-індекси для домен-інваріантів на рівні БД, не лише коду — `uq_agent_proposal_active_user` («одна активна пропозиція на користувача», §4 SAD/AC-03) і `uq_activity_report_period` (ідемпотентність автозвіту, AC-11). Обидва — пряме продовження стилю `idx_card_owner_active`/`idx_entry_card_pending` (частковий індекс з `WHERE`), лише з `UNIQUE`.

## Крос-фічева залежність порядку промоції (нове для проєкту)

`agent_proposal.card_id`/`.metric_block_id` і `imperative_rule.scope_card_id` — перші FK в проєкті, що перетинають межу фічі (посилаються на таблиці `life-area-card`). `/sdd:implement` має промотувати міграції `life-area-card` **раніше** за `agent`, інакше `CREATE TABLE ... REFERENCES card(id)` впаде на порожній базі. Задокументовано в `data-model.md` і тут — раніше такої залежності між фічами не було (кожна фіча мала власний, ізольований набір таблиць).

## Стагінг-міграції

Усі під `docs/features/agent/migrations/`, фіче-локальна нумерація `01`…`07`, **єдина плоска папка** (не як `structure/migrations/{backend,history-service}/`) — worker читає ту саму базу, що й backend-service (ADR-0002), окремого сховища немає. **Не в живому дереві `migrations/`** — `implement` призначить реальний номер/інструмент при промоції.

| # | Файл | Сутність |
|---|---|---|
| 01 | `01_create_app_user.up.sql` / `.down.sql` | `app_user` |
| 02 | `02_create_agent_proposal.up.sql` / `.down.sql` | `agent_proposal` |
| 03 | `03_create_imperative_rule.up.sql` / `.down.sql` | `imperative_rule` |
| 04 | `04_create_long_term_memory_fact.up.sql` / `.down.sql` | `long_term_memory_fact` |
| 05 | `05_create_chat_message.up.sql` / `.down.sql` | `chat_message` |
| 06 | `06_create_agent_audit_event.up.sql` / `.down.sql` | `agent_audit_event` |
| 07 | `07_create_activity_report.up.sql` / `.down.sql` | `activity_report` |

**Промоційна підказка:** інструмент міграцій для Postgres усе ще не обраний (`architecture-map.md §Migrations`) — `implement` вибере його разом з першим підняттям бекенда. Порядок промоції серед staged-файлів трьох фіч: `life-area-card` (01-05) → `agent` 01 (`app_user`) незалежний, але `agent` 02-03 залежать від `life-area-card` 01-02 (`card`/`metric_block`) уже існуючи в базі — `structure` (незалежна від `agent`) може йти в будь-якому місці цього ланцюжка.

## Незакриті TBD (свідомо, не забуті)

- `agent_audit_event.subject_id` — поліморфне посилання (на `agent_proposal.id` або `long_term_memory_fact.id`), без DB-рівня FK навмисно; цілісність — предмет `implement`.
- Конкретний інструмент міграцій для Postgres — обирається, коли бекенд вперше scaffold-иться (той самий TBD, що й у двох попередніх фічах).
- FK на `card.owner_user_id`/`structure.owner_user_id` → `app_user(id)` — власна майбутня міграція тих фіч, не написана цим проходом.

## Дрейф (крок 11)

N/A — коду агента ще немає (backend не scaffold-ився жодного разу, DELIVERY-PLAN «Розробка» 5%), Explore-скан домену не знайшов існуючих полів для звірки.

## Самоперевірка (крок 12, 4 обов'язкові)

- ✅ **Найменування** — узгоджено з уже встановленою конвенцією `life-area-card`/`structure`: `snake_case` таблиці/колонки, префікси `idx_`/`uq_`.
- ✅ **Reversibility** — кожен `CREATE TABLE` має парний `DROP TABLE`, кожен `CREATE INDEX`/`CREATE UNIQUE INDEX` — парний `DROP INDEX` (перевірено по всіх 7 пар файлів, включно з індексами, доданими після першого проходу самоперевірки).
- ✅ **FK-індекси** — кожен `REFERENCES` має покривний індекс на FK-колонці. Перший прохід пропустив 5 випадків, де композитний/частковий індекс не покривав FK повністю (`agent_proposal.user_id/card_id/metric_block_id`, `imperative_rule.scope_card_id`, `long_term_memory_fact.user_id`) — виправлено додаванням окремих індексів до фіналізації.
- ✅ **Відповідність конвенції** — жодного відхилення від встановленого репозиторієм стилю; нове (часткові UNIQUE для домен-інваріантів, крос-фічевий FK) — пряме продовження наявних патернів, не нова філософія.

## Наступний крок

`/sdd:api agent` — контракт ендпоінтів чату (повідомлення, підтвердження, правила, звіти активності).
