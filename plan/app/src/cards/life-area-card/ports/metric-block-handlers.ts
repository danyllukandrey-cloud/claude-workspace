// Ports-шар (T22 + D-106): HTTP-хендлери блоків-метрик за контрактом
// (docs/features/life-area-card/contracts/openapi.yaml, шляхи
// /api/v1/cards/{cardId}/metric-blocks (GET+POST) і
// /api/v1/cards/{cardId}/metric-blocks/transfer).
//
// Framework-agnostic: у репо ще немає жодного HTTP-фреймворку (Express/Fastify
// навмисно не встановлені -- T30 підключить конкретний транспорт пізніше).
// Хендлер тут -- звичайна async-функція (db, ownerUserId, параметри шляху,
// тіло) -> об'єкт відповідної схеми контракту. Композицію (сам `db`,
// `ownerUserId` із сесії) робить викликач (composition root/транспорт),
// не цей файл (ADR-0004, DI).
//
// Помилки: use-case шар (../app/create-metric-block.ts, ../app/transfer-metric-block.ts)
// уже кидає AppError із кодом і httpStatus, виставленими по контракту --
// цей файл лише пропускає її нагору (не глушить, не мапить у власні коди,
// не вигадує нових).
//
// Мапінг полів (MetricBlockRecord -> MetricBlock схема контракту) --
// майже прямий (camelCase), з одним неочевидним місцем: postgres-repo.ts
// повертає createdAt/updatedAt/targetDate як `Date` (сирий тип драйвера
// `pg`), а контракт вимагає рядок (`date-time` для createdAt/updatedAt,
// `date` для targetDate) -- toMetricBlock() серіалізує їх тут, на межі
// порту, а не в репозиторії (репозиторій навмисно лишається "сирим" шаром
// над `pg`, серіалізація під конкретний контракт -- відповідальність порту).
//
// `progress`/`overGoalAmount` зі схеми MetricBlock контракту цей файл ніде
// НЕ заповнює -- навіть у listMetricBlocks нижче (D-106, закриває ISS-39):
// прогрес і далі рахує PWA клієнтськи з сирих подій (feature ADR-0001 --
// docs/features/life-area-card/adr/0001-recompute-progress-from-raw-events.md,
// не плутати з кореневим docs/adr/0001-frontend-stack.md; sad.md Critical
// flow 4/6), не бекенд. listMetricBlocks віддає лише метадані
// (label/unit/targetCount/isOngoing/frequency) -- те, чого досі не було
// способу прочитати взагалі (T26, хвиля 7, потребує списку блоків картки).
// Клієнт кешує ці метадані повним заміщенням (local-cache.ts
// cacheMetricBlocks, T11+D-106) -- відкриття картки офлайн НЕ залежить від
// цього ендпоінту, лише перша синхронізація на новому пристрої (QG-1).
//
// targetDate -- ЛОКАЛЬНІ ґеттери (getFullYear/getMonth/getDate), НЕ
// toISOString() (виправлено, blocker критика хвилі 6): target_date у БД --
// колонка типу DATE, а драйвер `pg` парсить її як ЛОКАЛЬНУ північ
// (new Date(year, month, day), пакет postgres-date), не UTC. TZ проєкту --
// Europe/Kyiv (UTC+2/+3, попереду UTC), тож toISOString() (яка конвертує в
// UTC) систематично зсувала календарну дату на день назад для КОЖНОГО
// targetDate. toDateOnlyString() нижче читає ті самі локальні поля, з яких
// pg побудував об'єкт, -- жодної конвертації часового поясу.

import { createMetricBlock as createMetricBlockUseCase } from '../app/create-metric-block';
import { transferMetricBlock as transferMetricBlockUseCase } from '../app/transfer-metric-block';
import { archiveMetricBlock as archiveMetricBlockUseCase } from '../app/archive-metric-block';
import type { RecordAction } from '../app/archive-metric-block';
import { findCardById, listMetricBlocksByCard } from '../infra/postgres-repo';
import type { Db, MetricBlockRecord } from '../infra/postgres-repo';
import { AppError } from '../../../shared/errors';

/** Тіло POST /api/v1/cards/{cardId}/metric-blocks (openapi.yaml MetricBlockCreate). */
export interface MetricBlockCreateBody {
  label: string;
  unit: string;
  frequency?: string | null;
  targetCount?: number | null;
  isOngoing?: boolean;
  targetDate?: string | null;
}

/** Тіло POST /api/v1/cards/{cardId}/metric-blocks/transfer (openapi.yaml MetricBlockTransferRequest). */
export interface MetricBlockTransferRequestBody {
  sourceMetricBlockId: string;
  /** NULL, доки колізія не виявлена (openapi.yaml) -- трактується як "не надано". */
  newLabel?: string | null;
}

/** Відповідь за схемою MetricBlock контракту (openapi.yaml) -- без ownerUserId, він не публічний. */
export interface MetricBlock {
  id: string;
  cardId: string;
  label: string;
  unit: string;
  frequency: string | null;
  targetCount: number | null;
  isOngoing: boolean;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** D-127 -- мʼяка архівація окремого блоку-метрики (US-17/AC-20), той самий підхід, що card.status. */
  status: 'active' | 'archived';
}

/**
 * Формує YYYY-MM-DD з ЛОКАЛЬНИХ полів Date, не з toISOString() (яка йде
 * через UTC і може зсунути календарну дату -- див. коментар на початку файлу).
 */
function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toMetricBlock(record: MetricBlockRecord): MetricBlock {
  return {
    id: record.id,
    cardId: record.cardId,
    label: record.label,
    unit: record.unit,
    frequency: record.frequency,
    targetCount: record.targetCount,
    isOngoing: record.isOngoing,
    targetDate: record.targetDate ? toDateOnlyString(record.targetDate) : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    status: record.status,
  };
}

/**
 * GET /api/v1/cards/{cardId}/metric-blocks (D-106, закриває ISS-39) --
 * список метаданих блоків картки, БЕЗ прогресу (PWA рахує сама, sad.md
 * Critical flow 4/6). Non-disclosure (AC-04): findCardById перевіряється
 * ПЕРЕД читанням блоків -- чужа й неіснуюча картка дають однаковий
 * card.not_found (CardNotFound), той самий підхід, що listEntries (T23).
 * Без пагінації -- припущення MVP-масштабу (одиниці блоків на картку), НЕ
 * письмове обмеження з spec.md/screens.md (openapi.yaml, той самий опис
 * дослівно) -- переглянути, якщо практика покаже інше.
 *
 * D-127 (US-17/AC-20): архівовані блоки (status: 'archived') відфільтровано
 * тут, у порт-шарі -- той самий "зникає зі звичайного списку" підхід, що
 * listActiveCardsByOwner для архівованих карток колоди. Фільтр in-memory, не
 * SQL-запитом (listMetricBlocksByCard лишається без статусного фільтра, бо
 * інші викликачі -- app/create-entry.ts, agent/app/handle-message.ts --
 * досі потребують УСІХ блоків картки, не лише активних).
 */
export async function listMetricBlocks(db: Db, ownerUserId: string, cardId: string): Promise<MetricBlock[]> {
  const card = await findCardById(db, ownerUserId, cardId);
  if (!card) {
    throw new AppError('card.not_found', 'Картку не знайдено', 404);
  }

  const blocks = await listMetricBlocksByCard(db, cardId);
  return blocks.filter((block) => block.status === 'active').map(toMetricBlock);
}

/**
 * POST /api/v1/cards/{cardId}/metric-blocks -- додає блок-метрику до картки
 * (AC-05/AC-07/AC-08). Кидає (пропускає) AppError('card.not_found', ..., 404)
 * від use-case шару для чужої чи неіснуючої картки (non-disclosure, AC-04).
 */
export async function createMetricBlock(
  db: Db,
  ownerUserId: string,
  cardId: string,
  body: MetricBlockCreateBody,
  recordAction?: RecordAction
): Promise<MetricBlock> {
  const record = await createMetricBlockUseCase(
    db,
    {
      ownerUserId,
      cardId,
      label: body.label,
      unit: body.unit,
      frequency: body.frequency,
      targetCount: body.targetCount,
      isOngoing: body.isOngoing,
      targetDate: body.targetDate,
    },
    recordAction
  );
  return toMetricBlock(record);
}

/**
 * POST /api/v1/cards/{cardId}/metric-blocks/transfer -- переносить блок-метрику
 * (і всю історію записів) на картку зі шляху (AC-14/AC-15).
 *
 * Увага: `cardId` зі шляху -- це `targetCardId` use-case (картка-ПРИЗНАЧЕННЯ),
 * НЕ картка-джерело -- use-case сам визначає джерело за `body.sourceMetricBlockId`
 * (ISS-30), тому картка-джерело в цьому хендлері взагалі не фігурує.
 *
 * Пропускає нагору AppError від use-case: 404 card.not_found (ціль чи блок-
 * джерело не знайдені/чужі, non-disclosure AC-04); 409 metric_block.name_collision
 * (AC-15, колізія назва+одиниця в картці-призначенні).
 */
export async function transferMetricBlock(
  db: Db,
  ownerUserId: string,
  cardId: string,
  body: MetricBlockTransferRequestBody,
  recordAction?: RecordAction
): Promise<MetricBlock> {
  const record = await transferMetricBlockUseCase(
    db,
    {
      ownerUserId,
      targetCardId: cardId,
      metricBlockId: body.sourceMetricBlockId,
      newLabel: body.newLabel ?? undefined,
    },
    recordAction
  );
  return toMetricBlock(record);
}

/**
 * DELETE /api/v1/cards/{cardId}/metric-blocks/{metricBlockId} (US-17/AC-20, D-127) --
 * мʼяка архівація ОДНОГО блоку-метрики (не всієї картки). Пропускає нагору
 * AppError від use-case: 404 card.not_found -- один код на "блок не існує",
 * "блок чужий" і "cardId зі шляху не відповідає справжній картці блоку"
 * (non-disclosure AC-04, той самий код, що ISS-30 уже встановив для transfer).
 */
export async function archiveMetricBlock(
  db: Db,
  ownerUserId: string,
  cardId: string,
  metricBlockId: string,
  recordAction?: RecordAction
): Promise<MetricBlock> {
  const record = await archiveMetricBlockUseCase(db, { ownerUserId, cardId, metricBlockId }, recordAction);
  return toMetricBlock(record);
}
