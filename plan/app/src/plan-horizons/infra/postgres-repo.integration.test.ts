// T3 -- Infra: репозиторій `plan_item` (CRUD + non-disclosure), рівень
// інтеграції проти РЕАЛЬНОЇ Neon (ADR-0006, server/db.ts createDb()) -- та
// сама конвенція, що вже використовує ../../structure/app/move-card.integration.test.ts.
//
// DoD (tasks/T3-postgres-repo.md):
// - round-trip create -> list -> update -> soft-delete
// - читання/зміна чужого plan_item повертає порожньо, без винятку (AC-07)
// - EXPLAIN підтверджує, що idx_plan_item_owner_active реально обслуговує
//   запит списку (AC-08)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPlanItem } from '../domain/plan-item';
import {
  insertPlanItem,
  listActivePlanItems,
  updatePlanItem,
  softDeletePlanItem,
  LIST_ACTIVE_PLAN_ITEMS_SQL,
} from './postgres-repo';
import { createDb, type DbWithTransaction } from '../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('plan_item postgres-repo (integration) -- AC-01/AC-04/AC-07/AC-08 проти реальної Neon', () => {
  let db: DbWithTransaction;
  let ownerId: string;
  let strangerId: string;

  async function createUser(label: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      id,
      `test-t3-${label}-${id}`,
      `t3-${label}-${id}@example.test`,
    ]);
    return id;
  }

  beforeAll(async () => {
    db = createDb();
    ownerId = await createUser('owner');
    strangerId = await createUser('stranger');
  });

  afterAll(async () => {
    // каскадно прибирає всі plan_item обох користувачів (FK ON DELETE CASCADE)
    await db.query('DELETE FROM app_user WHERE id = ANY($1)', [[ownerId, strangerId]]);
    await db.end();
  });

  it('round-trips create -> list -> update -> soft-delete (AC-01, AC-04, AC-08)', async () => {
    const first = createPlanItem({
      id: crypto.randomUUID(),
      ownerUserId: ownerId,
      horizon: 'tactical',
      planText: 'Скласти список справ на тиждень',
      createdAt: '2026-09-20T09:00:00.000Z',
    });
    const second = createPlanItem({
      id: crypto.randomUUID(),
      ownerUserId: ownerId,
      horizon: 'tactical',
      planText: 'Записатись до лікаря',
      createdAt: '2026-09-20T10:00:00.000Z',
    });
    const strategic = createPlanItem({
      id: crypto.randomUUID(),
      ownerUserId: ownerId,
      horizon: 'strategic',
      planText: 'Визначити напрям на пʼять років',
      createdAt: '2026-09-20T08:00:00.000Z',
    });

    // CREATE -- повертає те саме, що домен збудував (AC-01: не виконаний,
    // з датою додавання)
    const stored = await insertPlanItem(db, first);
    expect(stored).toEqual(first);
    expect(stored.done).toBe(false);
    expect(stored.status).toBe('active');

    await insertPlanItem(db, second);
    await insertPlanItem(db, strategic);

    // LIST -- усі активні пункти власника, у порядку додавання ВСЕРЕДИНІ
    // горизонту (AC-08). Порядок самих горизонтів тут службовий (алфавітний,
    // як в індексі): показовий порядок тактичний -> оперативний ->
    // стратегічний -- справа use-case списку (T7), не репозиторію.
    const listed = await listActivePlanItems(db, ownerId);
    expect(listed.map((item) => item.id)).toEqual([strategic.id, first.id, second.id]);
    expect(listed.map((item) => item.createdAt)).toEqual([
      '2026-09-20T08:00:00.000Z',
      '2026-09-20T09:00:00.000Z',
      '2026-09-20T10:00:00.000Z',
    ]);

    // UPDATE -- текст і чекбокс (AC-03/AC-03b проходять через цей самий шлях)
    const updated = await updatePlanItem(
      db,
      ownerId,
      first.id,
      { planText: 'Скласти список справ на місяць', done: true },
      '2026-09-21T11:00:00.000Z'
    );
    expect(updated).toMatchObject({
      id: first.id,
      planText: 'Скласти список справ на місяць',
      done: true,
      updatedAt: '2026-09-21T11:00:00.000Z',
    });

    // SOFT-DELETE (AC-04) -- пункт зникає зі списку, але лишається в базі
    const removed = await softDeletePlanItem(db, ownerId, second.id, '2026-09-21T12:00:00.000Z');
    expect(removed).toBe(true);

    const afterRemoval = await listActivePlanItems(db, ownerId);
    expect(afterRemoval.map((item) => item.id)).toEqual([strategic.id, first.id]);

    const { rows } = await db.query<{ status: string }>('SELECT status FROM plan_item WHERE id = $1', [second.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('removed');
  });

  it("does not disclose or touch another user's plan-item (AC-07)", async () => {
    const mine = createPlanItem({
      id: crypto.randomUUID(),
      ownerUserId: ownerId,
      horizon: 'operational',
      planText: 'Пункт власника, недоступний іншому',
      createdAt: '2026-09-20T13:00:00.000Z',
    });
    await insertPlanItem(db, mine);

    // Чужий список -- порожній, без винятку: "не існує" і "належить іншому"
    // виглядають однаково.
    const strangerView = await listActivePlanItems(db, strangerId);
    expect(strangerView.find((item) => item.id === mine.id)).toBeUndefined();

    await expect(
      updatePlanItem(db, strangerId, mine.id, { planText: 'викрадено', done: true }, '2026-09-21T13:00:00.000Z')
    ).resolves.toBeNull();

    await expect(softDeletePlanItem(db, strangerId, mine.id, '2026-09-21T13:00:00.000Z')).resolves.toBe(false);

    // Запис не змінився жодним із чужих викликів.
    const { rows } = await db.query<{ plan_text: string; done: boolean; status: string }>(
      'SELECT plan_text, done, status FROM plan_item WHERE id = $1',
      [mine.id]
    );
    expect(rows[0]).toMatchObject({
      plan_text: 'Пункт власника, недоступний іншому',
      done: false,
      status: 'active',
    });
  });

  // DoD: EXPLAIN-перевірка, що idx_plan_item_owner_active реально обслуговує
  // запит списку. `SET LOCAL enable_seqscan = off` -- навмисно: на тестовій
  // таблиці з кількома рядками планувальник завжди обере seq scan за вартістю,
  // і тест був би про розмір даних, а не про те, що нас цікавить -- чи індекс
  // взагалі ПІДХОДИТЬ під форму запиту (той самий набір і порядок колонок,
  // той самий частковий предикат status = 'active').
  it('serves the list query through idx_plan_item_owner_active (AC-08)', async () => {
    const plan = await db.withTransaction(async (tx) => {
      await tx.query('SET LOCAL enable_seqscan = off');
      const { rows } = await tx.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${LIST_ACTIVE_PLAN_ITEMS_SQL}`, [ownerId]);
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

    expect(plan).toContain('idx_plan_item_owner_active');
  });
});
