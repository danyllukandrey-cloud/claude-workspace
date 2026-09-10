// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query). Інтеграційний тест проти
// справжньої Neon додасть орхестратор після злиття хвилі (спільний
// migrations.integration.test.ts, щоб уникнути конфлікту).

import { describe, it, expect, vi } from 'vitest';
import { createMetricBlock } from './create-metric-block';
import { AppError } from '../../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNED_CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-1',
  name: 'Здоров’я',
  description: 'опис',
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const FIXED_TARGET_METRIC_BLOCK_ROW = {
  id: 'block-1',
  card_id: 'card-1',
  label: 'Книги',
  unit: 'книги',
  frequency: null,
  target_count: '12',
  is_ongoing: false,
  target_date: null,
  created_at: new Date('2026-01-02T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

const ONGOING_METRIC_BLOCK_ROW = {
  id: 'block-2',
  card_id: 'card-1',
  label: 'Медитація',
  unit: 'хвилини',
  frequency: 'daily',
  target_count: null,
  is_ongoing: true,
  target_date: null,
  created_at: new Date('2026-01-02T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

describe('createMetricBlock use-case', () => {
  // DoD: блок з фіксованою ціллю створюється -- insertMetricBlock викликано
  // з targetCount, без isOngoing.
  it('creates a metric-block with a fixed target count', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [FIXED_TARGET_METRIC_BLOCK_ROW] }); // insertMetricBlock
    const db: Db = { query };

    const record = await createMetricBlock(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      label: 'Книги',
      unit: 'книги',
      targetCount: 12,
    });

    expect(record.targetCount).toBe(12);
    expect(record.isOngoing).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);

    expect(query.mock.calls[0][0]).toMatch(/FROM card/);
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO metric_block/);
    // targetCount(12) переданий серед параметрів; isOngoing відсутній у вводі
    // -> insertMetricBlock падає на дефолт (false), не true.
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining([12]));
    expect(query.mock.calls[1][1]).not.toEqual(expect.arrayContaining([true]));
  });

  // DoD: is_ongoing: true створюється без target_date -- insertMetricBlock
  // викликано з isOngoing: true, targetDate відсутній/null.
  it('creates an ongoing metric-block without a target date', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [ONGOING_METRIC_BLOCK_ROW] });
    const db: Db = { query };

    const record = await createMetricBlock(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      label: 'Медитація',
      unit: 'хвилини',
      frequency: 'daily',
      isOngoing: true,
    });

    expect(record.isOngoing).toBe(true);
    expect(record.targetDate).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);

    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO metric_block/);
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining([true]));
    // targetDate не передали у вводі -> insertMetricBlock отримує null.
    const insertParams = query.mock.calls[1][1] as unknown[];
    expect(insertParams[insertParams.length - 1]).toBeNull();
  });

  // DoD: чужа/неіснуюча картка -- AppError card.not_found 404,
  // insertMetricBlock НЕ викликано (non-disclosure, AC-04).
  it('throws card.not_found and never inserts a metric-block for a foreign or missing card', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] }); // кожен виклик -- порожньо
    const db: Db = { query };

    await expect(
      createMetricBlock(db, { ownerUserId: 'user-1', cardId: 'not-mine', label: 'Книги', unit: 'книги', targetCount: 5 })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    await expect(
      createMetricBlock(db, { ownerUserId: 'user-1', cardId: 'not-mine', label: 'Книги', unit: 'книги', targetCount: 5 })
    ).rejects.toBeInstanceOf(AppError);

    expect(query).toHaveBeenCalledTimes(2); // два виклики expect вище -- по одному findCardById кожен
    expect(query.mock.calls[0][0]).toMatch(/FROM card/);
    expect(query.mock.calls.some((call) => /INSERT INTO metric_block/.test(call[0] as string))).toBe(false);
  });

  // Review 2026-09-07 B6: targetCount<=0 -- "отруйний" запис, що бриктує
  // картку назавжди (кожне наступне GET /cards/{id} падає з 500 у
  // computeProgress). Відхиляємо ДО insertMetricBlock -- жодного запису
  // в БД, insertMetricBlock не викликано.
  it('rejects a non-positive targetCount before any write', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }); // лише findCardById
    const db: Db = { query };

    await expect(
      createMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', label: 'Книги', unit: 'книги', targetCount: 0 })
    ).rejects.toMatchObject({ code: 'metric_block.invalid_target_count', httpStatus: 422 });

    expect(query.mock.calls.some((call) => /INSERT INTO metric_block/.test(call[0] as string))).toBe(false);
  });

  it('rejects a negative targetCount before any write', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] });
    const db: Db = { query };

    await expect(
      createMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', label: 'Книги', unit: 'книги', targetCount: -5 })
    ).rejects.toMatchObject({ code: 'metric_block.invalid_target_count', httpStatus: 422 });
  });

  // AC-08: цей use-case ніколи не чіпає таблицю card (лише читає її для
  // ownership-перевірки) -- жоден виклик query не є UPDATE/INSERT на card,
  // тож картка без блоку лишається декларативною автоматично.
  it('never writes to the card table -- only reads it for ownership', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [FIXED_TARGET_METRIC_BLOCK_ROW] });
    const db: Db = { query };

    await createMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', label: 'Книги', unit: 'книги', targetCount: 12 });

    const cardWriteCalls = query.mock.calls.filter((call) => /(UPDATE|INSERT INTO)\s+card\b/i.test(call[0] as string));
    expect(cardWriteCalls).toHaveLength(0);
  });
});
