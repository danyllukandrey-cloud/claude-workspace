// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), той самий
// стиль, що archive-metric-block.test.ts/transfer-metric-block.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { updateMetricBlock } from './update-metric-block';
import { AppError } from '../../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNED_CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-1',
  name: 'Здоров’я',
  description: 'опис',
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

const METRIC_BLOCK_ROW = {
  id: 'block-1',
  card_id: 'card-1',
  label: 'Пробіжка',
  unit: 'км',
  frequency: 'weekly',
  target_count: '5',
  is_ongoing: false,
  target_date: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
  status: 'active',
};

describe('updateMetricBlock use-case (CH-03)', () => {
  it('renames the block when only label changes, no collision check triggered by unit alone', async () => {
    const updatedRow = { ...METRIC_BLOCK_ROW, label: 'Біг' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // findMetricBlockById
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [] }) // findMetricBlockByCardLabelUnit -- no collision
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateMetricBlock
    const db: Db = { query };

    const result = await updateMetricBlock(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      metricBlockId: 'block-1',
      label: 'Біг',
    });

    expect(result.label).toBe('Біг');
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3][0]).toMatch(/UPDATE metric_block/);
  });

  it('updates target/unit/frequency/isOngoing/targetDate without touching label', async () => {
    const updatedRow = { ...METRIC_BLOCK_ROW, target_count: '10', frequency: 'daily' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateMetricBlock -- нема collision-запиту (label/unit не змінились)
    const db: Db = { query };

    const result = await updateMetricBlock(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      metricBlockId: 'block-1',
      targetCount: 10,
      frequency: 'daily',
    });

    expect(result.targetCount).toBe(10);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('rejects a non-positive targetCount before any UPDATE', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] });
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1', targetCount: 0 })
    ).rejects.toMatchObject({ code: 'metric_block.invalid_target_count', httpStatus: 422 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('rejects a rename that collides with another block of the same card', async () => {
    const otherBlockRow = { ...METRIC_BLOCK_ROW, id: 'block-2', label: 'Плавання' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [otherBlockRow] }); // collision -- different id
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1', label: 'Плавання' })
    ).rejects.toMatchObject({ code: 'metric_block.name_collision', httpStatus: 409 });
    expect(query.mock.calls.some((call) => /UPDATE metric_block/.test(String(call[0])))).toBe(false);
  });

  it('does not treat the block colliding with itself as a collision (label unchanged, only unit changes)', async () => {
    const updatedRow = { ...METRIC_BLOCK_ROW, unit: 'миль' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // collision lookup finds itself (same label, OLD unit) -- id matches, not a real collision
      .mockResolvedValueOnce({ rows: [updatedRow] });
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1', unit: 'миль' })
    ).resolves.toMatchObject({ unit: 'миль' });
  });

  it('throws card.not_found when the metric block does not exist at all', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'does-not-exist', label: 'x' })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('throws card.not_found when the metric block belongs to a foreign card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [] }); // findCardById -- foreign, non-disclosure null
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1', label: 'x' })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('throws card.not_found when the path cardId does not match the block\'s real card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // card_id: 'card-1'
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] });
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-other', metricBlockId: 'block-1', label: 'x' })
    ).rejects.toBeInstanceOf(AppError);
    expect(query.mock.calls.some((call) => /UPDATE metric_block/.test(String(call[0])))).toBe(false);
  });

  it('records an action log entry on success', async () => {
    const updatedRow = { ...METRIC_BLOCK_ROW, label: 'Біг' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [updatedRow] });
    const db: Db = { query };
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await updateMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1', label: 'Біг' }, recordAction);

    expect(recordAction).toHaveBeenCalledWith(db, {
      ownerUserId: 'user-1',
      action: 'Змінено налаштування блоку-метрики «Біг» на картці «Здоров’я»',
    });
  });
});
