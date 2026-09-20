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

import { describe, it, expect, vi, afterEach } from 'vitest';
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

// RED (T14) -- ідемпотентність створення пункту (spec.md §6 NFR: два натискання
// «Зберегти» в межах 1 секунди не створюють дублю; контракт дає на це запас у
// 5 хвилин через обов'язковий заголовок Idempotency-Key).
//
// Перевіряємо не «функція викликалась», а саме те, від чого захищаємось:
// скільки рядків народилось у базі. Лічильник db.query -- це і є кількість
// INSERT-ів, тож «один рядок» тут доказовий, а не декларативний.
describe('createPlanItem handler -- ідемпотентність за Idempotency-Key (T14, spec.md §6 NFR)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Кожен виклик віддає СВІЙ id -- дубль у базі був би одразу видно за різними id. */
  function insertingDb(): { db: Db; query: ReturnType<typeof vi.fn> } {
    let n = 0;
    const query = vi.fn().mockImplementation(async () => {
      n += 1;
      return { rows: [planItemRow({ id: `plan-item-${n}` })] };
    });
    return { db: { query }, query };
  }

  const BODY = { horizon: 'tactical', planText: 'Пробігти півмарафон' };

  it('returns the first result and writes a single row for a repeat of the same key within 1 second', async () => {
    const { db, query } = insertingDb();

    const first = await createPlanItem(db, OWNER, BODY, undefined, 'key-double-save');
    const second = await createPlanItem(db, OWNER, BODY, undefined, 'key-double-save');

    expect(second).toEqual(first);
    expect(second.id).toBe('plan-item-1');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('collapses two simultaneous in-flight saves with the same key into one row', async () => {
    const { db, query } = insertingDb();

    const [first, second] = await Promise.all([
      createPlanItem(db, OWNER, BODY, undefined, 'key-in-flight'),
      createPlanItem(db, OWNER, BODY, undefined, 'key-in-flight'),
    ]);

    expect(second).toEqual(first);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('records the action log only once for the deduplicated save (AC-05)', async () => {
    const { db } = insertingDb();
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await createPlanItem(db, OWNER, BODY, recordAction, 'key-log-once');
    await createPlanItem(db, OWNER, BODY, recordAction, 'key-log-once');

    expect(recordAction).toHaveBeenCalledTimes(1);
  });

  it('creates separate rows for different keys -- no false deduplication', async () => {
    const { db, query } = insertingDb();

    const first = await createPlanItem(db, OWNER, BODY, undefined, 'key-a');
    const second = await createPlanItem(db, OWNER, BODY, undefined, 'key-b');

    expect(first.id).toBe('plan-item-1');
    expect(second.id).toBe('plan-item-2');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('never deduplicates across owners -- the same key from another user is another row (AC-07)', async () => {
    const { db, query } = insertingDb();

    const mine = await createPlanItem(db, OWNER, BODY, undefined, 'key-shared');
    const theirs = await createPlanItem(db, 'user-77', BODY, undefined, 'key-shared');

    expect(theirs.id).not.toBe(mine.id);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not deduplicate when no key is given -- two deliberate saves stay two rows', async () => {
    const { db, query } = insertingDb();

    const first = await createPlanItem(db, OWNER, BODY);
    const second = await createPlanItem(db, OWNER, BODY);

    expect(first.id).toBe('plan-item-1');
    expect(second.id).toBe('plan-item-2');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('forgets the key after the 5-minute contract window', async () => {
    vi.useFakeTimers();
    const { db, query } = insertingDb();

    const first = await createPlanItem(db, OWNER, BODY, undefined, 'key-expiring');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const later = await createPlanItem(db, OWNER, BODY, undefined, 'key-expiring');

    expect(later.id).not.toBe(first.id);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed save -- a retry with the same key reaches the database', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('З\'єднання з базою впало'))
      .mockResolvedValueOnce({ rows: [planItemRow()] });
    const db: Db = { query };

    await expect(createPlanItem(db, OWNER, BODY, undefined, 'key-retry')).rejects.toThrow();
    await expect(createPlanItem(db, OWNER, BODY, undefined, 'key-retry')).resolves.toMatchObject({
      id: 'plan-item-1',
    });
    expect(query).toHaveBeenCalledTimes(2);
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
