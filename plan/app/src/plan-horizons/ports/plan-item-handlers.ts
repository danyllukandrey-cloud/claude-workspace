// T8 -- Ports: HTTP-хендлери пунктів плану, contracts/openapi.yaml
// (`/api/v1/plan-items` -- listPlanItems/createPlanItem,
// `/api/v1/plan-items/{planItemId}` -- updatePlanItem/deletePlanItem).
//
// Framework-agnostic (той самий підхід, що ../../structure/ports/*.ts і
// ../../cards/life-area-card/ports/*.ts): звичайна async-функція
// (db, ownerUserId, ...параметри шляху/query, тіло) -> DTO відповідної схеми
// контракту. Express живе окремо, у composition root (server/app.ts), і саме
// він мапить код помилки на HTTP-статус -- тут помилки НЕ перехоплюються:
// PlanItemValidationError (422) і AppError (404/400) летять нагору як є.
//
// `ownerUserId` -- окремий позиційний параметр, не поле тіла: його дає
// авторизований контекст запиту (AC-07 вбудовано у форму сигнатури), той
// самий порядок аргументів, що в app/*.ts і infra/postgres-repo.ts цієї фічі.

import { listPlanItems as listPlanItemsUseCase } from '../app/list-plan-items';
import { createPlanItem as createPlanItemUseCase } from '../app/create-plan-item';
import { updatePlanItem as updatePlanItemUseCase } from '../app/update-plan-item';
import { deletePlanItem as deletePlanItemUseCase } from '../app/delete-plan-item';
import type { RecordAction } from '../app/create-plan-item';
import { PLAN_HORIZONS, PlanItemValidationError } from '../domain/plan-item';
import type { PlanHorizon, PlanItem } from '../domain/plan-item';
import type { Db } from '../infra/postgres-repo';

export type { RecordAction };

// --- DTO -- форма відповіді, camelCase, точно як components.schemas.PlanItem --
// `additionalProperties: false` у контракті -- ownerUserId, status і updatedAt
// навмисно відсіюються тут і НЕ потрапляють у відповідь.

export interface PlanItemDto {
  id: string;
  horizon: PlanHorizon;
  planText: string;
  done: boolean;
  /** Дата додавання пункту (AC-01/AC-08) -- незмінна після створення. */
  createdAt: string;
}

export interface PlanItemPageDto {
  items: PlanItemDto[];
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
}

function toPlanItemDto(item: PlanItem): PlanItemDto {
  return {
    id: item.id,
    horizon: item.horizon,
    planText: item.planText,
    done: item.done,
    createdAt: item.createdAt,
  };
}

/**
 * Тіло запиту приходить з мережі -- `planText` може бути чим завгодно, не
 * лише рядком. Нерядкове значення трактуємо як "тексту немає": для клієнта це
 * та сама помилка `plan_item.text_required` (422), що й порожній рядок, і
 * далі в домен ніколи не потрапляє значення, на якому `.trim()` кинув би
 * сирий TypeError (тобто 500 замість контрактної відповіді).
 */
function readPlanText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// --- listPlanItems -- GET /api/v1/plan-items -------------------------------

export interface ListPlanItemsQuery {
  /** uuid-курсор попередньої сторінки (id останнього побаченого пункту). */
  after?: string;
  /** 1..100, default 50. */
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
}

/**
 * Use-case (T7) віддає пункти згрупованими по горизонтах -- це форма, зручна
 * екрану. Контракт же віддає ОДИН плоский список із курсором (PlanItemPage),
 * тож розгортання живе тут, на межі: порядок горизонтів показовий (тактичний
 * -> оперативний -> стратегічний, PLAN_HORIZONS), усередині горизонту -- за
 * датою додавання (AC-08, use-case уже відсортував).
 *
 * Порожня сторінка -- легітимний стан (AC-11), не помилка.
 */
export async function listPlanItems(
  db: Db,
  ownerUserId: string,
  query: ListPlanItemsQuery = {}
): Promise<PlanItemPageDto> {
  const grouped = await listPlanItemsUseCase(db, ownerUserId);
  const items = PLAN_HORIZONS.flatMap((horizon) => grouped[horizon]);
  const limit = clampLimit(query.limit);

  let startIndex = 0;
  if (query.after) {
    const afterIndex = items.findIndex((item) => item.id === query.after);
    // Курсор не знайдено (пункт могли прибрати між двома запитами) -- контракт
    // коду помилки для цього не визначає, тож читаємо з початку списку. Та
    // сама лінієнтна поведінка, що в card-handlers.ts/entry-handlers.ts.
    if (afterIndex !== -1) {
      startIndex = afterIndex + 1;
    }
  }

  const page = items.slice(startIndex, startIndex + limit);
  const hasNext = startIndex + limit < items.length;

  return {
    items: page.map(toPlanItemDto),
    has_next: hasNext,
    has_prev: startIndex > 0,
    next_cursor: hasNext ? page[page.length - 1].id : null,
  };
}

// --- createPlanItem -- POST /api/v1/plan-items ------------------------------

export interface CreatePlanItemBody {
  horizon?: unknown;
  planText?: unknown;
}

/**
 * Вікно ідемпотентності -- 5 хвилин, рівно як оголошує контракт
 * (contracts/openapi.yaml, заголовок `Idempotency-Key`). Вимога spec.md §6 --
 * «два натискання Зберегти в межах 1 секунди не створюють дублю»; 5 хвилин --
 * свідомий запас на реальні мережеві повтори.
 */
const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

/**
 * Пам'ять ключів -- у процесі, не в базі: `plan_item` (data-model.md) колонки
 * під ключ не має, і заводити заради дебаунсу окрему таблицю з міграцією
 * означало б платити схемою за захист від подвійного кліку. Наслідок названо
 * прямо: рестарт сервера вікно обнуляє, і при кількох інстансах дедуплікація
 * не спільна. Для одноосібного застосунку (spec.md §6, Throughput: N/A) цього
 * досить; якщо інстансів стане більше -- ключ переїде в сховище, а форма
 * виклику лишиться та сама.
 *
 * Зберігаємо саме ПРОМІС, а не готовий результат: два одночасні запити (клік
 * двічі поспіль -- це і є типовий випадок) тоді чекають один і той самий
 * INSERT, а не встигають обидва дійти до бази.
 */
const inFlightCreates = new Map<string, { expiresAt: number; result: Promise<PlanItemDto> }>();

/** Ключ клієнта дійсний лише в межах його власника -- чужий ключ ніколи не віддасть чужий пункт (AC-07). */
function idempotencyCacheKey(ownerUserId: string, idempotencyKey: string): string {
  return `${ownerUserId}\u0000${idempotencyKey}`;
}

function forgetExpired(now: number): void {
  for (const [key, entry] of inFlightCreates) {
    if (entry.expiresAt <= now) {
      inFlightCreates.delete(key);
    }
  }
}

/**
 * AC-01/AC-09: той самий виклик для прямого введення й для тексту,
 * підтвердженого в чаті з агентом -- сервер джерела тексту не розрізняє.
 *
 * Валідація (непорожній текст AC-02, відомий горизонт) лишається в домені --
 * тут лише звуження типів з мережі, жодного власного правила.
 *
 * `idempotencyKey` -- значення заголовка `Idempotency-Key`. Повтор того самого
 * ключа протягом вікна віддає ПЕРШИЙ результат і другого рядка в базі не
 * створює (spec.md §6 NFR). Ключа немає -- дедуплікації немає: два свідомі
 * збереження лишаються двома пунктами, і мовчки злити їх було б гірше, ніж
 * пропустити дубль.
 */
export async function createPlanItem(
  db: Db,
  ownerUserId: string,
  body: CreatePlanItemBody,
  recordAction?: RecordAction,
  idempotencyKey?: string
): Promise<PlanItemDto> {
  const runCreate = async (): Promise<PlanItemDto> => {
    const created = await createPlanItemUseCase(
      db,
      ownerUserId,
      {
        horizon: body.horizon as PlanHorizon,
        // `?? ''` -- відсутній і нерядковий planText доходять до тієї самої
        // доменної перевірки, що й порожній рядок (plan_item.text_required).
        planText: readPlanText(body.planText) ?? '',
      },
      recordAction
    );

    return toPlanItemDto(created);
  };

  if (!idempotencyKey) {
    return runCreate();
  }

  const now = Date.now();
  forgetExpired(now);

  const cacheKey = idempotencyCacheKey(ownerUserId, idempotencyKey);
  const seen = inFlightCreates.get(cacheKey);
  if (seen) {
    return seen.result;
  }

  const result = runCreate();
  inFlightCreates.set(cacheKey, { expiresAt: now + IDEMPOTENCY_WINDOW_MS, result });

  // Невдале збереження не запам'ятовуємо: повтор після впалої бази має дійти
  // до неї знову, інакше ключ на 5 хвилин «залипне» на помилці. `catch` тут
  // лише прибирає запис -- сама помилка летить викликачу як є.
  result.catch(() => {
    inFlightCreates.delete(cacheKey);
  });

  return result;
}

// --- updatePlanItem -- PATCH /api/v1/plan-items/{planItemId} ----------------

export interface UpdatePlanItemBody {
  planText?: unknown;
  done?: unknown;
}

/**
 * Часткове оновлення: `done` -- реверсивний тумблер (AC-03b), `planText` --
 * має бути непорожнім (AC-03). Прибирання пункту йде окремим DELETE нижче, не
 * порожнім planText тут (use-case це правило й тримає).
 *
 * `horizon` навмисно не читається з тіла: перенесення між горизонтами
 * відкладено на v2 (spec.md §3), і мовчки пропустити його далі означало б
 * дати клієнту недокументовану можливість.
 */
export async function updatePlanItem(
  db: Db,
  ownerUserId: string,
  planItemId: string,
  body: UpdatePlanItemBody,
  recordAction?: RecordAction
): Promise<PlanItemDto> {
  // Нерядковий planText -- та сама контрактна 422, що й порожній (див.
  // readPlanText); мовчки проігнорувати його було б гірше: клієнт отримав би
  // 200 на запит, який нічого не змінив.
  if (body.planText !== undefined && readPlanText(body.planText) === undefined) {
    throw new PlanItemValidationError('plan_item.text_required', 'Пункт плану не може бути без тексту');
  }

  const updated = await updatePlanItemUseCase(
    db,
    ownerUserId,
    planItemId,
    {
      planText: readPlanText(body.planText),
      done: typeof body.done === 'boolean' ? body.done : undefined,
    },
    recordAction
  );

  return toPlanItemDto(updated);
}

// --- deletePlanItem -- DELETE /api/v1/plan-items/{planItemId} ---------------

/**
 * AC-04: м'яке прибирання (status = 'removed'), ніколи фізичне видалення.
 * Повертає void -- контракт відповідає 204 без тіла.
 */
export async function deletePlanItem(
  db: Db,
  ownerUserId: string,
  planItemId: string,
  recordAction?: RecordAction
): Promise<void> {
  await deletePlanItemUseCase(db, ownerUserId, planItemId, recordAction);
}
