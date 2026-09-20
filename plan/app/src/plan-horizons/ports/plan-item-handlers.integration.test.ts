// T13 -- Наскрізна перевірка авторизації й non-disclosure (AC-07) на ВСІХ
// чотирьох ендпоінтах контракту, рівень портів, проти РЕАЛЬНОЇ Neon
// (ADR-0006, server/db.ts createDb()) -- та сама конвенція, що
// ../infra/postgres-repo.integration.test.ts і ../../structure/app/move-card.integration.test.ts.
//
// Чому окремо від ../infra/postgres-repo.integration.test.ts: там доведено, що
// фільтр за власником є в SQL репозиторію. Тут доводиться інше -- що ЖОДЕН з
// чотирьох хендлерів контракту не втрачає цю межу по дорозі (ports ->
// use-case -> repo) і що назовні виходить саме контрактна 404
// `plan_item.not_found`, однакова для "не існує" і для "належить іншому".
//
// Чому реальна БД, а не fake-Db: перевірка власника живе в тексті SQL. Підміна
// `db.query` довела б лише те, що тест сам і задав у мок-відповіді.
//
// DoD (tasks/T13-authz-test.md):
// - GET показує лише власні пункти
// - PATCH чужого пункту -> 404
// - DELETE чужого пункту -> 404

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { listPlanItems, createPlanItem, updatePlanItem, deletePlanItem } from './plan-item-handlers';
import { AppError } from '../../shared/errors';
import { createDb, type DbWithTransaction } from '../../../server/db';

beforeAll(() => {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // уже завантажено (напр. --env-file прокинутий викликачем) -- ігноруємо
  }
});

describe('plan-item handlers (integration) -- AC-07 на всіх 4 ендпоінтах', () => {
  let db: DbWithTransaction;
  let ownerId: string;
  let strangerId: string;
  let ownerItemId: string;

  async function createUser(label: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.query('INSERT INTO app_user (id, google_sub, email) VALUES ($1, $2, $3)', [
      id,
      `test-t13-${label}-${id}`,
      `t13-${label}-${id}@example.test`,
    ]);
    return id;
  }

  beforeAll(async () => {
    db = createDb();
    ownerId = await createUser('owner');
    strangerId = await createUser('stranger');

    // POST /api/v1/plan-items від імені власника -- єдиний пункт, який
    // чужинець далі намагатиметься побачити й змінити.
    const created = await createPlanItem(db, ownerId, {
      horizon: 'tactical',
      planText: 'Пункт власника, недоступний іншому',
    });
    ownerItemId = created.id;

    // Власний пункт чужинця -- щоб його порожній перегляд чужого не плутався
    // з "у нього взагалі нічого немає".
    await createPlanItem(db, strangerId, { horizon: 'strategic', planText: 'Власний пункт чужинця' });
  });

  afterAll(async () => {
    // каскадно прибирає всі plan_item обох користувачів (FK ON DELETE CASCADE)
    await db.query('DELETE FROM app_user WHERE id = ANY($1)', [[ownerId, strangerId]]);
    await db.end();
  });

  it('GET /plan-items -- сторінка чужинця містить лише його власні пункти', async () => {
    const strangerPage = await listPlanItems(db, strangerId);

    expect(strangerPage.items.map((item) => item.id)).not.toContain(ownerItemId);
    expect(strangerPage.items.map((item) => item.planText)).toEqual(['Власний пункт чужинця']);

    // Контроль: у власника той самий запит пункт показує -- тобто порожнеча
    // вище справді про межу власника, а не про зламаний запит.
    const ownerPage = await listPlanItems(db, ownerId);
    expect(ownerPage.items.map((item) => item.id)).toContain(ownerItemId);
  });

  it('PATCH /plan-items/{id} чужого пункту -- 404 plan_item.not_found, запис не змінено', async () => {
    await expect(
      updatePlanItem(db, strangerId, ownerItemId, { planText: 'викрадено', done: true })
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      updatePlanItem(db, strangerId, ownerItemId, { planText: 'викрадено', done: true })
    ).rejects.toMatchObject({ code: 'plan_item.not_found', httpStatus: 404 });

    const { rows } = await db.query<{ plan_text: string; done: boolean; status: string }>(
      'SELECT plan_text, done, status FROM plan_item WHERE id = $1',
      [ownerItemId]
    );
    expect(rows[0]).toMatchObject({
      plan_text: 'Пункт власника, недоступний іншому',
      done: false,
      status: 'active',
    });
  });

  it('DELETE /plan-items/{id} чужого пункту -- 404 plan_item.not_found, пункт лишається активним', async () => {
    await expect(deletePlanItem(db, strangerId, ownerItemId)).rejects.toBeInstanceOf(AppError);
    await expect(deletePlanItem(db, strangerId, ownerItemId)).rejects.toMatchObject({
      code: 'plan_item.not_found',
      httpStatus: 404,
    });

    const { rows } = await db.query<{ status: string }>('SELECT status FROM plan_item WHERE id = $1', [ownerItemId]);
    expect(rows[0]?.status).toBe('active');

    // Пункт і далі видно власнику -- чужий DELETE не прибрав його й "тихо".
    const ownerPage = await listPlanItems(db, ownerId);
    expect(ownerPage.items.map((item) => item.id)).toContain(ownerItemId);
  });

  it('POST /plan-items -- власник пункту береться з авторизованого контексту, а не з тіла', async () => {
    // Клієнт підсовує чужий owner_user_id у тілі: контракт такого поля не має,
    // і воно не повинно вплинути ні на що.
    const created = await createPlanItem(db, strangerId, {
      horizon: 'operational',
      planText: 'Спроба записати пункт на чужий ПЛАН',
      ownerUserId: ownerId,
    } as never);

    const { rows } = await db.query<{ owner_user_id: string }>('SELECT owner_user_id FROM plan_item WHERE id = $1', [
      created.id,
    ]);
    expect(rows[0]?.owner_user_id).toBe(strangerId);

    const ownerPage = await listPlanItems(db, ownerId);
    expect(ownerPage.items.map((item) => item.id)).not.toContain(created.id);
  });

  it('жоден з чотирьох хендлерів не повертає owner_user_id клієнту (non-disclosure)', async () => {
    const page = await listPlanItems(db, ownerId);
    const created = await createPlanItem(db, ownerId, { horizon: 'tactical', planText: 'Перевірка форми відповіді' });
    const updated = await updatePlanItem(db, ownerId, created.id, { done: true });

    for (const dto of [page.items[0], created, updated]) {
      expect(Object.keys(dto)).toEqual(['id', 'horizon', 'planText', 'done', 'createdAt']);
    }

    await expect(deletePlanItem(db, ownerId, created.id)).resolves.toBeUndefined();
  });
});
