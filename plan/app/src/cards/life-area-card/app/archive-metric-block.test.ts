// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query), той самий стиль, що
// archive-card.test.ts / transfer-metric-block.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { archiveMetricBlock } from './archive-metric-block';
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

const ARCHIVED_BLOCK_ROW = { ...METRIC_BLOCK_ROW, status: 'archived' };

describe('archiveMetricBlock use-case', () => {
  // AC-20 happy path: блок належить власнику, cardId зі шляху збігається зі
  // справжньою карткою блоку -- updateMetricBlock({status:'archived'}) виконується.
  it('archives an owned metric-block and returns it with status archived', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // findMetricBlockById
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }) // findCardById(ownerUserId, block.cardId)
      .mockResolvedValueOnce({ rows: [ARCHIVED_BLOCK_ROW] }); // updateMetricBlock
    const db: Db = { query };

    const result = await archiveMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1' });

    expect(result.status).toBe('archived');
    expect(query).toHaveBeenCalledTimes(3);

    expect(query.mock.calls[0][0]).toMatch(/FROM metric_block WHERE id = \$1/);
    expect(query.mock.calls[0][1]).toEqual(['block-1']);
    expect(query.mock.calls[1][0]).toMatch(/FROM card WHERE/);
    expect(query.mock.calls[1][1]).toEqual(['card-1', 'user-1']);
    expect(query.mock.calls[2][0]).toMatch(/UPDATE metric_block/);
    expect(query.mock.calls[2][1]).toEqual(expect.arrayContaining(['archived', 'block-1']));
  });

  // Non-disclosure (ISS-30/AC-04): metricBlockId, що взагалі не існує -- 404
  // card.not_found, findCardById НЕ викликається (немає block.cardId, з яким звіряти).
  it('throws card.not_found when the metric block does not exist at all', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }); // findMetricBlockById -- not found
    const db: Db = { query };

    await expect(
      archiveMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'does-not-exist' })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    await expect(
      archiveMetricBlock(
        { query: vi.fn().mockResolvedValueOnce({ rows: [] }) },
        { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'does-not-exist' }
      )
    ).rejects.toBeInstanceOf(AppError);
    expect(query).toHaveBeenCalledTimes(1);
  });

  // Non-disclosure (ISS-30/AC-04): блок існує, але належить картці ІНШОГО
  // власника -- findCardById поверне null (non-disclosure), той самий код
  // card.not_found, жодного UPDATE не викликається.
  it('throws card.not_found when the metric block belongs to a foreign card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // findMetricBlockById -- існує
      .mockResolvedValueOnce({ rows: [] }); // findCardById -- чужа картка, non-disclosure null
    const db: Db = { query };

    await expect(
      archiveMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1' })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some((call) => /UPDATE metric_block/.test(String(call[0])))).toBe(false);
  });

  // Не довіряємо client cardId (ISS-30-стиль): блок реально належить власнику,
  // але через ІНШУ його картку, ніж та, що в шляху DELETE -- той самий код
  // 404, не розкриваємо, що блок насправді існує деінде.
  it('throws card.not_found when the path cardId does not match the block\'s real card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // findMetricBlockById -- card_id: 'card-1'
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }); // findCardById(ownerUserId, 'card-1') -- своя
    const db: Db = { query };

    await expect(
      archiveMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-other', metricBlockId: 'block-1' })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls.some((call) => /UPDATE metric_block/.test(String(call[0])))).toBe(false);
  });

  // Ідемпотентність (той самий підхід, що archiveCard): повторна архівація
  // вже архівованого блоку не кидає помилку, лише оновлює updated_at.
  it('does not fail when archiving an already archived metric-block', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [ARCHIVED_BLOCK_ROW] }) // findMetricBlockById -- вже archived
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [ARCHIVED_BLOCK_ROW] }); // updateMetricBlock
    const db: Db = { query };

    await expect(
      archiveMetricBlock(db, { ownerUserId: 'user-1', cardId: 'card-1', metricBlockId: 'block-1' })
    ).resolves.toMatchObject({ status: 'archived' });
  });
});
