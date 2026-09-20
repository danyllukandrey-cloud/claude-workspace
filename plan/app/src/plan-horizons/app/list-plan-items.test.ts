// T7 -- unit-тест use-case "прочитати активні пункти плану" (AC-08/AC-11).
// Той самий стиль, що ./delete-plan-item.test.ts і
// cards/life-area-card/app/list-cards.test.ts: db підробляється через vi.fn().
//
// Мок навмисно віддає рядки в "поганому" порядку (горизонти впереміш,
// created_at не за зростанням). Якби тест подавав уже відсортований набір,
// він доводив би лише порядок ORDER BY у репозиторії, а не те, що САМЕ цей
// шар відповідає за показовий порядок горизонтів і за порядок додавання
// всередині кожного з них.

import { describe, it, expect, vi } from 'vitest';
import { listPlanItems } from './list-plan-items';
import type { Db } from '../infra/postgres-repo';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-item-1',
    owner_user_id: 'user-1',
    horizon: 'tactical',
    plan_text: 'Пробігти півмарафон',
    done: false,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Мок сховища: віддає задані рядки лише "своєму" власнику (AC-07). */
function fakeDb(rows: ReturnType<typeof row>[]) {
  const query = vi.fn(async (_text: string, params: unknown[] = []) => {
    const [ownerUserId] = params as string[];
    return { rows: rows.filter((r) => r.owner_user_id === ownerUserId && r.status === 'active') };
  });
  return { db: { query } as unknown as Db, query };
}

describe('listPlanItems use-case', () => {
  // AC-08, головне твердження: усі три горизонти, кожен зі своїм списком,
  // у показовому порядку тактичний -> оперативний -> стратегічний.
  it('groups active plan-items into the three horizons in display order', async () => {
    const { db } = fakeDb([
      row({ id: 'strat-1', horizon: 'strategic', created_at: new Date('2026-01-05T00:00:00Z') }),
      row({ id: 'tact-1', horizon: 'tactical', created_at: new Date('2026-01-01T00:00:00Z') }),
      row({ id: 'oper-1', horizon: 'operational', created_at: new Date('2026-01-03T00:00:00Z') }),
    ]);

    const result = await listPlanItems(db, 'user-1');

    expect(Object.keys(result)).toEqual(['tactical', 'operational', 'strategic']);
    expect(result.tactical.map((item) => item.id)).toEqual(['tact-1']);
    expect(result.operational.map((item) => item.id)).toEqual(['oper-1']);
    expect(result.strategic.map((item) => item.id)).toEqual(['strat-1']);
  });

  // AC-08: усередині горизонту -- порядок додавання (created_at за
  // зростанням), незалежно від того, в якому порядку рядки прийшли.
  it('orders the plan-items inside every horizon by the date they were added', async () => {
    const { db } = fakeDb([
      row({ id: 'tact-3', horizon: 'tactical', created_at: new Date('2026-01-09T00:00:00Z') }),
      row({ id: 'tact-1', horizon: 'tactical', created_at: new Date('2026-01-01T00:00:00Z') }),
      row({ id: 'tact-2', horizon: 'tactical', created_at: new Date('2026-01-05T00:00:00Z') }),
    ]);

    const result = await listPlanItems(db, 'user-1');

    expect(result.tactical.map((item) => item.id)).toEqual(['tact-1', 'tact-2', 'tact-3']);
    expect(result.operational).toEqual([]);
    expect(result.strategic).toEqual([]);
  });

  // AC-08: кожен пункт несе стан чекбокса й дату додавання -- саме те, що
  // сторінка ПЛАН показує біля тексту.
  it('carries the done state and the date each plan-item was added', async () => {
    const { db } = fakeDb([
      row({ id: 'tact-1', done: true, created_at: new Date('2026-01-01T00:00:00Z') }),
    ]);

    const result = await listPlanItems(db, 'user-1');

    expect(result.tactical[0]).toMatchObject({
      id: 'tact-1',
      planText: 'Пробігти півмарафон',
      done: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  // AC-11: перший запуск -- три порожні горизонти, не помилка й не undefined.
  it('returns three empty horizons for a first-time user instead of failing', async () => {
    const { db } = fakeDb([]);

    await expect(listPlanItems(db, 'user-new')).resolves.toEqual({
      tactical: [],
      operational: [],
      strategic: [],
    });
  });

  // AC-11 (продовження): горизонт без пунктів лишається присутнім ключем,
  // навіть коли в інших пункти є -- інакше ui/ отримав би undefined замість
  // порожнього списку й показав би зламаний екран замість кнопки "+".
  it('keeps an empty horizon present when the other horizons have plan-items', async () => {
    const { db } = fakeDb([row({ id: 'tact-1', horizon: 'tactical' })]);

    const result = await listPlanItems(db, 'user-1');

    expect(result.operational).toEqual([]);
    expect(result.strategic).toEqual([]);
  });

  // Non-disclosure (AC-07, успадковане від репозиторію): чужі пункти не
  // потрапляють у відповідь, і чужий список -- порожній, а не виняток.
  it("never leaks another user's plan-items and reads scoped to the owner", async () => {
    const { db, query } = fakeDb([
      row({ id: 'tact-1', horizon: 'tactical', owner_user_id: 'user-1' }),
      row({ id: 'foreign-1', horizon: 'tactical', owner_user_id: 'user-2' }),
    ]);

    const mine = await listPlanItems(db, 'user-1');
    expect(mine.tactical.map((item) => item.id)).toEqual(['tact-1']);

    await expect(listPlanItems(db, 'user-3')).resolves.toEqual({
      tactical: [],
      operational: [],
      strategic: [],
    });
    expect(query.mock.calls.every((call) => (call[1] as string[])[0] !== undefined)).toBe(true);
  });

  // Читання -- один запит до сховища, не по запиту на горизонт: інакше
  // сторінка ПЛАН коштувала б трьох походів у базу замість одного (spec.md §6,
  // p95 ≤ 500 ms).
  it('reads all three horizons with a single query', async () => {
    const { db, query } = fakeDb([
      row({ id: 'tact-1', horizon: 'tactical' }),
      row({ id: 'oper-1', horizon: 'operational' }),
      row({ id: 'strat-1', horizon: 'strategic' }),
    ]);

    await listPlanItems(db, 'user-1');

    expect(query).toHaveBeenCalledTimes(1);
  });
});
