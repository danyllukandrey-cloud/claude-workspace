// T3 -- Infra: репозиторій `plan_item` (data-model.md). Прямі SQL-запити без
// ORM -- той самий шар і той самий стиль, що ../../structure/infra/postgres-repo.ts
// і ../../cards/life-area-card/infra/postgres-repo.ts: RETURNING на кожному
// write, мапінг snake_case -> camelCase на межі, жодної нової абстракції.
//
// DI (ADR-0004): той самий мінімальний Db-контракт (query(text, params) ->
// {rows}) -- підходить і pg.Pool, і pg.Client, і клієнт усередині
// withTransaction (server/db.ts).
//
// Non-disclosure (AC-07): КОЖЕН запит фільтрує за owner_user_id прямо в SQL.
// Чужий пункт і неіснуючий пункт повертають однаковий результат (null /
// false / порожній список) -- різниця між "не існує" й "належить іншому"
// ніде не проступає, зокрема й через винятки.

import type { QueryResultRow } from 'pg';
import type { PlanHorizon, PlanItem, PlanItemStatus } from '../domain/plan-item';

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface RawPlanItemRow extends QueryResultRow {
  id: string;
  owner_user_id: string;
  horizon: PlanHorizon;
  plan_text: string;
  done: boolean;
  status: PlanItemStatus;
  created_at: Date;
  updated_at: Date;
}

const PLAN_ITEM_COLUMNS = 'id, owner_user_id, horizon, plan_text, done, status, created_at, updated_at';

/**
 * Домен тримає часові мітки як ISO 8601-рядки (domain/plan-item.ts), pg
 * віддає timestamptz як Date -- конвертація живе тут, на межі, а не в домені.
 */
function toPlanItem(row: RawPlanItemRow): PlanItem {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    horizon: row.horizon,
    planText: row.plan_text,
    done: row.done,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Експортований окремо, щоб інтеграційний тест міг прогнати рівно цей текст
 * через EXPLAIN і довести, що `idx_plan_item_owner_active` справді його
 * обслуговує -- копія запиту в тесті доводила б лише саму себе.
 *
 * ORDER BY horizon, created_at -- точно той порядок колонок, що в індексі
 * (owner_user_id, horizon, created_at) WHERE status = 'active', тож сортування
 * дістається безкоштовно. Порядок горизонтів тут АЛФАВІТНИЙ, службовий:
 * показовий порядок трьох горизонтів (тактичний -> оперативний ->
 * стратегічний) -- справа use-case списку (T7) і ui/, не бази.
 */
export const LIST_ACTIVE_PLAN_ITEMS_SQL = `SELECT ${PLAN_ITEM_COLUMNS}
     FROM plan_item
     WHERE owner_user_id = $1 AND status = 'active'
     ORDER BY horizon, created_at, id`;

/**
 * AC-01. Приймає вже зібраний доменом пункт (createPlanItem) цілком, а не
 * розсип полів: createdAt/updatedAt народжуються в домені, і дублювати той
 * самий момент часу ще й дефолтом колонки означало б два джерела правди.
 */
export async function insertPlanItem(db: Db, item: PlanItem): Promise<PlanItem> {
  const { rows } = await db.query<RawPlanItemRow>(
    `INSERT INTO plan_item (id, owner_user_id, horizon, plan_text, done, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PLAN_ITEM_COLUMNS}`,
    [item.id, item.ownerUserId, item.horizon, item.planText, item.done, item.status, item.createdAt, item.updatedAt]
  );
  return toPlanItem(rows[0]);
}

/**
 * AC-08/AC-11: активні пункти власника. Порожній результат -- нормальний стан
 * (користувач ще нічого не додав), не помилка.
 */
export async function listActivePlanItems(db: Db, ownerUserId: string): Promise<PlanItem[]> {
  const { rows } = await db.query<RawPlanItemRow>(LIST_ACTIVE_PLAN_ITEMS_SQL, [ownerUserId]);
  return rows.map(toPlanItem);
}

/**
 * Часткове оновлення (AC-03/AC-03b чекбокс, редагування тексту) -- міняються
 * лише передані поля, той самий підхід, що updateStructure у Структурі.
 * Non-disclosure (AC-07): чужий чи неіснуючий пункт -- null, нічого не пишеться.
 *
 * `status` тут навмисно НЕ оновлюється: м'яке видалення має власну функцію
 * нижче, щоб випадковий patch не міг зняти пункт з виду.
 */
export async function updatePlanItem(
  db: Db,
  ownerUserId: string,
  id: string,
  patch: { planText?: string; done?: boolean },
  updatedAt: string
): Promise<PlanItem | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  const assign = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.planText !== undefined) assign('plan_text', patch.planText);
  if (patch.done !== undefined) assign('done', patch.done);

  assign('updated_at', updatedAt);

  values.push(id, ownerUserId);
  const { rows } = await db.query<RawPlanItemRow>(
    `UPDATE plan_item SET ${sets.join(', ')}
     WHERE id = $${values.length - 1} AND owner_user_id = $${values.length} AND status = 'active'
     RETURNING ${PLAN_ITEM_COLUMNS}`,
    values
  );
  return rows[0] ? toPlanItem(rows[0]) : null;
}

/**
 * AC-04: єдиний спосіб прибрати пункт -- очистити його текст у редакторі, і
 * це ніколи не фізичне видалення. Рядок лишається в базі зі status 'removed',
 * просто не потрапляє в listActivePlanItems.
 *
 * Non-disclosure (AC-07): чужий чи неіснуючий пункт -- false, без винятку.
 * Повторний виклик на вже прибраному пункті теж false (status = 'active'
 * у WHERE) -- ідемпотентно й без побічного ефекту.
 */
export async function softDeletePlanItem(
  db: Db,
  ownerUserId: string,
  id: string,
  updatedAt: string
): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE plan_item SET status = 'removed', updated_at = $1
     WHERE id = $2 AND owner_user_id = $3 AND status = 'active'
     RETURNING id`,
    [updatedAt, id, ownerUserId]
  );
  return rows.length > 0;
}
