// RED (T8) -- Ports: HTTP-хендлери пунктів плану, contracts/openapi.yaml
// (`/api/v1/plan-items`, `/api/v1/plan-items/{planItemId}`).
//
// Той самий fake-Db-за-текстом-SQL стиль, що
// ../../structure/ports/connection-handlers.test.ts: `db.query` -- vi.fn(),
// який віддає канонічні snake_case-рядки, тож тест пінить реальний ланцюг
// port -> use-case -> repo -> SQL, а не лише передачу функції далі.
//
// Перевіряємо саме те, чого немає в жодному шарі нижче:
//   - форму DTO контракту (`additionalProperties: false` -- owner_user_id,
//     status і updated_at НЕ мають просочитись у відповідь);
//   - курсорну пагінацію `PlanItemPage` (DoD T8);
//   - код помилки, який транспорт мапить у 422/404/400.

import { describe, it, expect, vi } from 'vitest';
import {
  listPlanItems,
  createPlanItem,
  updatePlanItem,
  deletePlanItem,
} from './plan-item-handlers';
import { PlanItemValidationError } from '../domain/plan-item';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'user-42';

function planItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-item-1',
    owner_user_id: OWNER,
    horizon: 'tactical',
    plan_text: 'Пробігти півмарафон',
    done: false,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('listPlanItems handler -- GET /api/v1/plan-items (AC-08, AC-11)', () => {
  it('returns a PlanItemPage whose items carry exactly the contract fields', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [planItemRow()] });
    const db: Db = { query };

    const page = await listPlanItems(db, OWNER);

    expect(page).toEqual({
      items: [
        {
          id: 'plan-item-1',
          horizon: 'tactical',
          planText: 'Пробігти півмарафон',
          done: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      has_next: false,
      has_prev: false,
      next_cursor: null,
    });
    // AC-07 non-disclosure: власник пунктів приходить з авторизованого
    // контексту й ніколи не повертається клієнту.
    expect(Object.keys(page.items[0])).toEqual(['id', 'horizon', 'planText', 'done', 'createdAt']);
    expect(query.mock.calls[0][1]).toEqual([OWNER]);
  });

  it('is an empty page, not an error, for a first-time user (AC-11)', async () => {
    const db: Db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await expect(listPlanItems(db, OWNER)).resolves.toEqual({
      items: [],
      has_next: false,
      has_prev: false,
      next_cursor: null,
    });
  });

  it('orders items by horizon (tactical -> operational -> strategic), then by date added (AC-08)', async () => {
    // База сортує алфавітно (operational, strategic, tactical) -- показовий
    // порядок трьох горизонтів народжується вище, і саме він має дійти до
    // клієнта.
    const db: Db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          planItemRow({ id: 'op-1', horizon: 'operational', created_at: new Date('2026-01-02T00:00:00Z') }),
          planItemRow({ id: 'st-1', horizon: 'strategic', created_at: new Date('2026-01-03T00:00:00Z') }),
          planItemRow({ id: 'ta-2', horizon: 'tactical', created_at: new Date('2026-01-05T00:00:00Z') }),
          planItemRow({ id: 'ta-1', horizon: 'tactical', created_at: new Date('2026-01-04T00:00:00Z') }),
        ],
      }),
    };

    const page = await listPlanItems(db, OWNER);

    expect(page.items.map((item) => item.id)).toEqual(['ta-1', 'ta-2', 'op-1', 'st-1']);
  });

  it('cuts the page at `limit` and points `next_cursor` at the last item of it', async () => {
    const db: Db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          planItemRow({ id: 'ta-1', created_at: new Date('2026-01-01T00:00:00Z') }),
          planItemRow({ id: 'ta-2', created_at: new Date('2026-01-02T00:00:00Z') }),
          planItemRow({ id: 'ta-3', created_at: new Date('2026-01-03T00:00:00Z') }),
        ],
      }),
    };

    const page = await listPlanItems(db, OWNER, { limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual(['ta-1', 'ta-2']);
    expect(page).toMatchObject({ has_next: true, has_prev: false, next_cursor: 'ta-2' });
  });

  it('continues after the `after` cursor and reports has_prev', async () => {
    const db: Db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          planItemRow({ id: 'ta-1', created_at: new Date('2026-01-01T00:00:00Z') }),
          planItemRow({ id: 'ta-2', created_at: new Date('2026-01-02T00:00:00Z') }),
          planItemRow({ id: 'ta-3', created_at: new Date('2026-01-03T00:00:00Z') }),
        ],
      }),
    };

    const page = await listPlanItems(db, OWNER, { after: 'ta-2', limit: 2 });

    expect(page.items.map((item) => item.id)).toEqual(['ta-3']);
    expect(page).toMatchObject({ has_next: false, has_prev: true, next_cursor: null });
  });
});

describe('createPlanItem handler -- POST /api/v1/plan-items (AC-01, AC-02, AC-05)', () => {
  it('creates the item and returns it in the contract shape', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [planItemRow()] });
    const db: Db = { query };

    const dto = await createPlanItem(db, OWNER, { horizon: 'tactical', planText: 'Пробігти півмарафон' });

    expect(dto).toEqual({
      id: 'plan-item-1',
      horizon: 'tactical',
      planText: 'Пробігти півмарафон',
      done: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    // Власник -- з авторизованого контексту, не з тіла (AC-07).
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([OWNER]));
  });

  it('passes the optional recordAction through to the use-case (AC-05)', async () => {
    const db: Db = { query: vi.fn().mockResolvedValue({ rows: [planItemRow()] }) };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await createPlanItem(db, OWNER, { horizon: 'tactical', planText: 'Пробігти півмарафон' }, recordAction);

    expect(recordAction).toHaveBeenCalledWith(db, {
      ownerUserId: OWNER,
      action: expect.stringContaining('Пробігти півмарафон'),
    });
  });

  it.each([
    { label: 'порожній текст', body: { horizon: 'tactical', planText: '' } },
    { label: 'лише пробіли', body: { horizon: 'tactical', planText: '   ' } },
    { label: 'поля planText немає взагалі', body: { horizon: 'tactical' } },
    { label: 'planText не рядок', body: { horizon: 'tactical', planText: 42 } },
  ])('rejects $label with plan_item.text_required and never touches the database (AC-02)', async ({ body }) => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(createPlanItem(db, OWNER, body as never)).rejects.toMatchObject({
      code: 'plan_item.text_required',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an unknown horizon with plan_item.horizon_invalid', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(
      createPlanItem(db, OWNER, { horizon: 'yearly', planText: 'Щось' } as never)
    ).rejects.toBeInstanceOf(PlanItemValidationError);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('updatePlanItem handler -- PATCH /api/v1/plan-items/{id} (AC-03, AC-03b)', () => {
  it('flips the "done" checkbox on and returns the updated item', async () => {
    const db: Db = { query: vi.fn().mockResolvedValue({ rows: [planItemRow({ done: true })] }) };

    const dto = await updatePlanItem(db, OWNER, 'plan-item-1', { done: true });

    expect(dto).toMatchObject({ id: 'plan-item-1', done: true });
  });

  it('flips the "done" checkbox back off -- the toggle is reversible (AC-03b)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [planItemRow({ done: false })] });
    const db: Db = { query };

    const dto = await updatePlanItem(db, OWNER, 'plan-item-1', { done: false });

    expect(dto.done).toBe(false);
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([false]));
  });

  it('updates the text of an existing item (AC-03)', async () => {
    const db: Db = {
      query: vi.fn().mockResolvedValue({ rows: [planItemRow({ plan_text: 'Пробігти марафон' })] }),
    };

    const dto = await updatePlanItem(db, OWNER, 'plan-item-1', { planText: 'Пробігти марафон' });

    expect(dto.planText).toBe('Пробігти марафон');
  });

  it('rejects a whitespace-only planText with plan_item.text_required, without touching the database', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(updatePlanItem(db, OWNER, 'plan-item-1', { planText: '   ' })).rejects.toMatchObject({
      code: 'plan_item.text_required',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an empty patch with a 400 AppError -- nothing to update', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(updatePlanItem(db, OWNER, 'plan-item-1', {})).rejects.toMatchObject({
      code: 'plan_item.nothing_to_update',
      httpStatus: 400,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('is the contract 404 plan_item.not_found for a missing or not-owned item (AC-07)', async () => {
    const db: Db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await expect(updatePlanItem(db, OWNER, 'someone-elses-item', { done: true })).rejects.toMatchObject({
      code: 'plan_item.not_found',
      httpStatus: 404,
    });
  });
});

describe('deletePlanItem handler -- DELETE /api/v1/plan-items/{id} (AC-04)', () => {
  it('soft-deletes an owned item and returns nothing (204 has no body)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'plan-item-1' }] });
    const db: Db = { query };

    await expect(deletePlanItem(db, OWNER, 'plan-item-1')).resolves.toBeUndefined();
    // М'яке видалення -- UPDATE status='removed', ніколи DELETE FROM.
    expect(query.mock.calls[0][0]).toContain("status = 'removed'");
    expect(query.mock.calls[0][0]).not.toContain('DELETE FROM');
  });

  it('is the contract 404 plan_item.not_found for a missing or not-owned item (AC-07)', async () => {
    const db: Db = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    await expect(deletePlanItem(db, OWNER, 'someone-elses-item')).rejects.toBeInstanceOf(AppError);
    await expect(deletePlanItem(db, OWNER, 'someone-elses-item')).rejects.toMatchObject({
      code: 'plan_item.not_found',
      httpStatus: 404,
    });
  });

  it('passes the optional recordAction through to the use-case (AC-05)', async () => {
    const db: Db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'plan-item-1' }] }) };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await deletePlanItem(db, OWNER, 'plan-item-1', recordAction);

    expect(recordAction).toHaveBeenCalledWith(db, { ownerUserId: OWNER, action: expect.any(String) });
  });
});
