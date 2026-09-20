// T7 -- App: use-case "прочитати активні пункти плану" (GET /api/v1/plan-items,
// contracts/openapi.yaml listPlanItems). Той самий тонкий шар над репозиторієм,
// що cards/life-area-card/app/list-cards.ts: репозиторій уже вміє SQL і фільтр
// власника, цей шар лише надає результату форму, в якій його показує екран.
//
// DI (ADR-0004): `db` приходить параметром, use-case сам зʼєднання не створює.
//
// `ownerUserId` -- окремий позиційний параметр, а не поле input: його дає
// авторизований контекст запиту, а не клієнт (AC-07 вбудовано в форму
// сигнатури), точно як у сусідніх use-case цієї фічі.
//
// Параметра `recordAction` тут НЕМАЄ -- на відміну від create/update/delete.
// Лог дій (AC-05) записує ЗМІНИ; відкриття сторінки нічого не змінює, і
// рядок "переглянув план" на кожне завантаження екрана лише засмітив би
// журнал, у якому користувач шукає, що з його планом сталося.

import { PLAN_HORIZONS } from '../domain/plan-item';
import type { PlanHorizon, PlanItem } from '../domain/plan-item';
import { listActivePlanItems } from '../infra/postgres-repo';
import type { Db } from '../infra/postgres-repo';

/**
 * AC-11: усі три ключі присутні ЗАВЖДИ, навіть порожні. Саме тому це
 * Record по всіх горизонтах, а не мапа лише з непорожніми: ui/ інакше
 * отримав би undefined замість порожнього списку й показав би зламаний
 * екран там, де має бути горизонт із кнопкою "+".
 */
export type PlanItemsByHorizon = Record<PlanHorizon, PlanItem[]>;

/**
 * AC-08/AC-11. Один запит на всі три горизонти (сторінка ПЛАН -- один похід
 * у базу, spec.md §6, p95 ≤ 500 ms), далі групування в пам'яті.
 *
 * Порядок горизонтів -- показовий (тактичний -> оперативний -> стратегічний,
 * PLAN_HORIZONS), а не алфавітний, як у SQL: база сортує так, як їй зручно
 * лягає індекс `idx_plan_item_owner_active`, і навʼязувати їй порядок екрана
 * означало б втратити безкоштовне сортування (див. LIST_ACTIVE_PLAN_ITEMS_SQL).
 *
 * Порядок усередині горизонту -- за датою додавання (AC-08; ручного
 * перевпорядкування у v1 немає, spec.md §3). Сортування тут дублює ORDER BY
 * репозиторію навмисно: форма результату -- обіцянка ЦЬОГО шару, і вона не
 * має тихо ламатись від того, що колись хтось змінить ORDER BY у SQL заради
 * іншого індексу.
 */
export async function listPlanItems(db: Db, ownerUserId: string): Promise<PlanItemsByHorizon> {
  const items = await listActivePlanItems(db, ownerUserId);

  const grouped = Object.fromEntries(PLAN_HORIZONS.map((horizon) => [horizon, [] as PlanItem[]])) as PlanItemsByHorizon;

  for (const item of items) {
    grouped[item.horizon].push(item);
  }

  for (const horizon of PLAN_HORIZONS) {
    // createdAt -- ISO 8601 в UTC (domain/plan-item.ts), тож лексикографічне
    // порівняння рядків збігається з хронологічним; `id` -- стабільний
    // тайбрейк для пунктів, створених в одну й ту саму мілісекунду.
    grouped[horizon].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  return grouped;
}
