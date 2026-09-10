# Changelog — life-area-card

## life-area-card — перша фіча продукту «ПЛАН»: картки зон життя з відстеженням прогресу

**What:** Користувач може створити картку довільної зони життя (назва + Опис-«навіщо»), додати до неї один чи кілька блоків-метрик (кількість + частота + опційна ціль у часі), вносити записи (через агента, з підтвердженням), бачити обчислений прогрес по кожному блоку й агрегований прогрес картки, виправляти/скасовувати помилкові записи, переносити блок-метрику між картками, перейменовувати, архівувати й розархівовувати картку — усе через реальний бекенд (Express + Neon Postgres), захищене входом через Google.

**Why:** перша реалізація продуктової концепції «ПЛАН» — [Product_Brief.md](../../Product_Overview/Product_Brief.md); ключові рішення, що сформували підхід: генерик-архітектура картки замість жорсткого домену (D-23…D-33), прогрес рахується з сирих подій, не зі збереженого числа ([ADR-0001](../adr/0001-recompute-progress-from-raw-events.md)), непідтверджені записи не рахуються до підтвердження агентом ([ADR-0002](../adr/0002-hold-unconfirmed-records-pending.md)), архівація — м'яка (ніколи не видаляє фізично), розархівація не відновлює позицію в розкладці автоматично ([D-104](../../DECISIONS.md#d-104)).

**How to use:** `POST /api/v1/cards` → `POST /api/v1/cards/{cardId}/metric-blocks` → `POST /api/v1/cards/{cardId}/metric-blocks/{metricBlockId}/entries` → `GET /api/v1/cards/{cardId}` (повертає `aggregateProgress`, середнє арифметичне часток по bounded-блоках) — повний контракт: [openapi.yaml](../contracts/openapi.yaml). У браузері: вхід через Google → колода карток → створення картки → блок-метрика → запис → перегляд прогресу на картці.

**Operational notes:**
- Migration: 7 міграцій вже застосовані й промоучені в `plan/app/migrations/` (`create-card`, `create-metric-block`, `create-entry`, `create-card-lifecycle-event`, `add-card-status`, `add-card-restore`, `add-owner-fk`) — застосовуються автоматично на деплої (`npm run migrate`), відкат — `npm run migrate:down`.
- Feature flag / config: потрібні `.env`-змінні `DATABASE_URL`/`DATABASE_URL_POOLED`, `JWT_SECRET` (мінімальна довжина перевіряється, `server/jwt-config.ts`), `GOOGLE_CLIENT_ID` — без них `server/index.ts` кидає виняток при старті. `CLAUDE_API_KEY` опційний (fail-open — його відсутність не блокує жоден ендпоінт, лише вимикає AC-10 підказку про нестиковки).
- Rollback: `npm run migrate:down` (по одній) + revert деплою.

**Acceptance criteria delivered:** AC-01…AC-19 (+ AC-09b) — повний перелік із [spec.md §5](../spec.md#5-acceptance-criteria); 6 найкритичніших спот-перевірено вручну проти реального HTTP + реальної Neon (AC-02, AC-01, AC-09, AC-04, AC-16, AC-17) під час цього `/sdd:ship`, решта покрита 352 юніт- + 67 інтеграційними тестами.
