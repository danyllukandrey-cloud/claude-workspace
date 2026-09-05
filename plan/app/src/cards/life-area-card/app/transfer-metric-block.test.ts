// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query). Інтеграційний тест проти
// справжньої Neon додасть орхестратор після злиття хвилі (спільний
// migrations.integration.test.ts, щоб уникнути конфлікту).

import { describe, it, expect, vi } from 'vitest';
import { transferMetricBlock } from './transfer-metric-block';
import type { Db } from '../infra/postgres-repo';

const SOURCE_CARD_ROW = {
  id: 'card-source',
  owner_user_id: 'user-1',
  name: 'Стара картка',
  description: 'опис',
  status: 'archived',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

const TARGET_CARD_ROW = {
  id: 'card-target',
  owner_user_id: 'user-1',
  name: 'Нова картка',
  description: 'опис',
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

const METRIC_BLOCK_ROW = {
  id: 'block-1',
  card_id: 'card-source',
  label: 'Пробіжка',
  unit: 'км',
  frequency: 'weekly',
  target_count: '5',
  is_ongoing: false,
  target_date: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

const OTHER_METRIC_BLOCK_ROW = {
  ...METRIC_BLOCK_ROW,
  id: 'block-other',
  label: 'Плавання',
};

function updatedBlockRow(overrides: Partial<typeof METRIC_BLOCK_ROW> = {}) {
  return { ...METRIC_BLOCK_ROW, card_id: 'card-target', ...overrides };
}

describe('transferMetricBlock use-case', () => {
  // AC-14 happy path: обидві картки належать власнику, колізії немає --
  // updateMetricBlock({cardId, label}) виконується ПЕРЕД reassignEntriesToCard,
  // з правильними id/targetCardId.
  it('transfers the block and its entries when there is no label+unit collision', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] }) // findCardById(source)
      .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] }) // findCardById(target)
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard(source)
      .mockResolvedValueOnce({ rows: [] }) // findMetricBlockByCardLabelUnit -- no collision
      .mockResolvedValueOnce({ rows: [updatedBlockRow()] }) // updateMetricBlock
      .mockResolvedValueOnce({ rows: [] }); // reassignEntriesToCard
    const db: Db = { query };

    const result = await transferMetricBlock(db, {
      ownerUserId: 'user-1',
      sourceCardId: 'card-source',
      targetCardId: 'card-target',
      metricBlockId: 'block-1',
    });

    expect(result.cardId).toBe('card-target');
    expect(result.label).toBe('Пробіжка');
    expect(query).toHaveBeenCalledTimes(6);

    // findMetricBlockByCardLabelUnit -- перевіряємо під поточною назвою блоку (newLabel не передано).
    expect(query.mock.calls[3][0]).toMatch(/FROM metric_block WHERE card_id = \$1 AND label = \$2 AND unit = \$3/);
    expect(query.mock.calls[3][1]).toEqual(['card-target', 'Пробіжка', 'км']);

    // updateMetricBlock -- card_id і label серед параметрів UPDATE.
    expect(query.mock.calls[4][0]).toMatch(/UPDATE metric_block/);
    expect(query.mock.calls[4][1]).toEqual(expect.arrayContaining(['card-target', 'Пробіжка', 'block-1']));

    // reassignEntriesToCard -- саме після updateMetricBlock, з тим самим metricBlockId і targetCardId.
    expect(query.mock.calls[5][0]).toMatch(/UPDATE entry SET card_id = \$1 WHERE metric_block_id = \$2/);
    expect(query.mock.calls[5][1]).toEqual(['card-target', 'block-1']);
  });

  // AC-15: колізія назва+одиниця в картці-призначенні без newLabel -- відхиляється,
  // updateMetricBlock/reassignEntriesToCard НЕ викликаються (не зливаємо мовчки).
  it('rejects with a collision error and never writes when the target card already has the same label+unit and no newLabel is given', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] }) // findCardById(source)
      .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] }) // findCardById(target)
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard(source)
      .mockResolvedValueOnce({ rows: [OTHER_METRIC_BLOCK_ROW] }); // findMetricBlockByCardLabelUnit -- collision
    const db: Db = { query };

    await expect(
      transferMetricBlock(db, {
        ownerUserId: 'user-1',
        sourceCardId: 'card-source',
        targetCardId: 'card-target',
        metricBlockId: 'block-1',
      })
    ).rejects.toMatchObject({ code: 'metric_block.name_collision', httpStatus: 409 });

    expect(query).toHaveBeenCalledTimes(4); // жодного UPDATE після колізії
    expect(query.mock.calls.some((call) => /UPDATE metric_block/.test(String(call[0])))).toBe(false);
    expect(query.mock.calls.some((call) => /UPDATE entry/.test(String(call[0])))).toBe(false);
  });

  // AC-15: колізія з наданим newLabel -- перенесення завершується під новою назвою.
  it('completes the transfer under newLabel when the caller already resolved the collision', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] }) // findCardById(source)
      .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] }) // findCardById(target)
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard(source)
      .mockResolvedValueOnce({ rows: [] }) // findMetricBlockByCardLabelUnit(newLabel) -- no collision under new name
      .mockResolvedValueOnce({ rows: [updatedBlockRow({ label: 'Пробіжка (2)' })] }) // updateMetricBlock
      .mockResolvedValueOnce({ rows: [] }); // reassignEntriesToCard
    const db: Db = { query };

    const result = await transferMetricBlock(db, {
      ownerUserId: 'user-1',
      sourceCardId: 'card-source',
      targetCardId: 'card-target',
      metricBlockId: 'block-1',
      newLabel: 'Пробіжка (2)',
    });

    expect(result.label).toBe('Пробіжка (2)');
    expect(result.cardId).toBe('card-target');

    // Колізію перевіряємо під НОВОЮ назвою, не старою.
    expect(query.mock.calls[3][1]).toEqual(['card-target', 'Пробіжка (2)', 'км']);
    expect(query.mock.calls[4][1]).toEqual(expect.arrayContaining(['card-target', 'Пробіжка (2)', 'block-1']));
    expect(query.mock.calls[5][1]).toEqual(['card-target', 'block-1']);
  });

  // AC-15: newLabel передано, але й ВОНА теж зайнята в картці-призначенні --
  // та сама помилка, нову назву теж не можна мовчки поглинути.
  it('rejects even when the given newLabel itself collides in the target card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [OTHER_METRIC_BLOCK_ROW] }); // collision under newLabel too
    const db: Db = { query };

    await expect(
      transferMetricBlock(db, {
        ownerUserId: 'user-1',
        sourceCardId: 'card-source',
        targetCardId: 'card-target',
        metricBlockId: 'block-1',
        newLabel: 'Плавання',
      })
    ).rejects.toMatchObject({ code: 'metric_block.name_collision', httpStatus: 409 });
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка-джерело -- AppError('card.not_found', 404),
  // і жодного подальшого читання блоків.
  it('throws card.not_found for a foreign or missing source card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // findCardById(source) -- not found
      .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] }); // findCardById(target)
    const db: Db = { query };

    await expect(
      transferMetricBlock(db, {
        ownerUserId: 'user-1',
        sourceCardId: 'not-mine',
        targetCardId: 'card-target',
        metricBlockId: 'block-1',
      })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(2); // обидва findCardById виконались (Promise.all), далі нічого
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка-призначення -- та сама форма помилки.
  it('throws card.not_found for a foreign or missing target card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [] }); // findCardById(target) -- not found
    const db: Db = { query };

    await expect(
      transferMetricBlock(db, {
        ownerUserId: 'user-1',
        sourceCardId: 'card-source',
        targetCardId: 'not-mine',
        metricBlockId: 'block-1',
      })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  // Блок, що переноситься, не знайдено серед блоків картки-джерела -- окрема
  // помилка (не card.not_found), бо обидві картки коректні, бракує саме блоку.
  it('throws metric_block.not_found when the block does not belong to the source card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [OTHER_METRIC_BLOCK_ROW] }); // listMetricBlocksByCard -- no matching id
    const db: Db = { query };

    await expect(
      transferMetricBlock(db, {
        ownerUserId: 'user-1',
        sourceCardId: 'card-source',
        targetCardId: 'card-target',
        metricBlockId: 'block-does-not-exist',
      })
    ).rejects.toMatchObject({ code: 'metric_block.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(3);
  });
});
