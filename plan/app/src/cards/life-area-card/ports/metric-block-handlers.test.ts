// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query), той самий стиль, що
// й у app/create-metric-block.test.ts та app/transfer-metric-block.test.ts.
//
// Мета цього тесту -- не переперевіряти правила use-case шару (вже покриті
// власними тестами), а звірити ПОРТ: (1) відповідь відповідає схемі MetricBlock
// контракту (camelCase, дати -- рядками, без ownerUserId/progress/overGoalAmount);
// (2) cardId зі шляху потрапляє в targetCardId use-case, а не трактується як
// картка-джерело; (3) AppError use-case шару проходить нагору без змін.

import { describe, it, expect, vi } from 'vitest';
import { createMetricBlock, transferMetricBlock, listMetricBlocks, archiveMetricBlock, updateMetricBlock } from './metric-block-handlers';
import { AppError } from '../../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNED_CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-1',
  name: 'Здоров’я',
  description: 'опис',
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

const CREATED_METRIC_BLOCK_ROW = {
  id: 'block-1',
  card_id: 'card-1',
  label: 'Книги',
  unit: 'книги',
  frequency: null,
  target_count: '12',
  is_ongoing: false,
  // ВАЖЛИВО (blocker критика хвилі 6): справжній драйвер `pg` парсить
  // колонку типу DATE як ЛОКАЛЬНУ північ (new Date(year, month, day)),
  // НЕ як UTC-рядок -- new Date('2026-03-15T00:00:00.000Z') моделював би
  // поведінку неправильно й не зловив би зсув дати в toMetricBlock().
  target_date: new Date(2026, 2, 15),
  created_at: new Date('2026-01-02T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
  status: 'active',
};

const TARGET_CARD_ROW = {
  id: 'card-target',
  owner_user_id: 'user-1',
  name: 'Нова картка',
  description: 'опис',
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

const SOURCE_CARD_ROW = {
  id: 'card-source',
  owner_user_id: 'user-1',
  name: 'Стара картка',
  description: 'опис',
  status: 'archived',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
};

const SOURCE_METRIC_BLOCK_ROW = {
  id: 'block-1',
  card_id: 'card-source',
  label: 'Пробіжка',
  unit: 'км',
  frequency: 'weekly',
  target_count: '5',
  is_ongoing: false,
  target_date: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-02T00:00:00.000Z'),
  status: 'active',
};

const OTHER_METRIC_BLOCK_ROW = { ...SOURCE_METRIC_BLOCK_ROW, id: 'block-other', label: 'Плавання' };

function transferredBlockRow(overrides: Partial<typeof SOURCE_METRIC_BLOCK_ROW> = {}) {
  return { ...SOURCE_METRIC_BLOCK_ROW, card_id: 'card-target', ...overrides };
}

// --- listMetricBlocks (D-106, закриває ISS-39) ------------------------------

describe('listMetricBlocks port', () => {
  // DoD (D-106): метадані блоків картки, БЕЗ progress/overGoalAmount --
  // прогрес рахує PWA клієнтськи (sad.md Critical flow 4/6), не цей ендпоінт.
  it('returns metric-block metadata for the card, without progress/overGoalAmount fields', async () => {
    const OTHER_BLOCK_ROW = { ...CREATED_METRIC_BLOCK_ROW, id: 'block-2', label: 'Фільми', target_date: null };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [CREATED_METRIC_BLOCK_ROW, OTHER_BLOCK_ROW] }); // listMetricBlocksByCard
    const db: Db = { query };

    const result = await listMetricBlocks(db, 'user-1', 'card-1');

    expect(result).toEqual([
      {
        id: 'block-1',
        cardId: 'card-1',
        label: 'Книги',
        unit: 'книги',
        frequency: null,
        targetCount: 12,
        isOngoing: false,
        targetDate: '2026-03-15',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        status: 'active',
      },
      expect.objectContaining({ id: 'block-2', label: 'Фільми', status: 'active' }),
    ]);
    // additionalProperties: false в контракті -- жодного progress/overGoalAmount, як і create/transfer.
    result.forEach((block) => {
      expect(block).not.toHaveProperty('progress');
      expect(block).not.toHaveProperty('overGoalAmount');
    });
  });

  // Картка без жодного блоку -- порожній масив, не помилка (AC-08, декларативна картка).
  it('returns an empty array for a card with no metric blocks', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }).mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };

    const result = await listMetricBlocks(db, 'user-1', 'card-1');

    expect(result).toEqual([]);
  });

  // D-127 (US-17/AC-20): архівований блок зникає зі звичайного списку -- той
  // самий підхід, що listActiveCardsByOwner для архівованих карток колоди.
  it('excludes archived metric blocks from the list (D-127)', async () => {
    const archivedBlockRow = { ...CREATED_METRIC_BLOCK_ROW, id: 'block-archived', status: 'archived' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [CREATED_METRIC_BLOCK_ROW, archivedBlockRow] }); // listMetricBlocksByCard
    const db: Db = { query };

    const result = await listMetricBlocks(db, 'user-1', 'card-1');

    expect(result.map((block) => block.id)).toEqual(['block-1']);
    expect(result.every((block) => block.status === 'active')).toBe(true);
  });

  // 404 card.not_found -- та сама форма для "не існує" й "чуже" (AC-04),
  // перевірено перед будь-яким читанням блоків.
  it('returns the identical 404 for a missing card and for another user\'s card', async () => {
    const missingQuery = vi.fn().mockResolvedValue({ rows: [] });
    const foreignQuery = vi.fn().mockResolvedValue({ rows: [] });

    const missingError = await listMetricBlocks({ query: missingQuery }, 'owner-a', 'nonexistent-card').catch((e) => e);
    const foreignError = await listMetricBlocks({ query: foreignQuery }, 'owner-b', 'card-1').catch((e) => e);

    expect(missingError).toBeInstanceOf(AppError);
    expect(foreignError).toBeInstanceOf(AppError);
    expect(missingError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(foreignError).toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    // non-disclosure: жодного другого запиту (listMetricBlocksByCard) при відсутній картці.
    expect(missingQuery).toHaveBeenCalledTimes(1);
  });
});

describe('createMetricBlock port', () => {
  // DoD: створення блоку відповідає контракту -- camelCase, дати рядками,
  // без ownerUserId/progress/overGoalAmount (жоден з них не в MetricBlockRecord,
  // тож не має потрапити у відповідь).
  it('returns a MetricBlock shaped exactly per the contract schema', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [OWNED_CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [CREATED_METRIC_BLOCK_ROW] }); // insertMetricBlock
    const db: Db = { query };

    const result = await createMetricBlock(db, 'user-1', 'card-1', {
      label: 'Книги',
      unit: 'книги',
      targetCount: 12,
      targetDate: '2026-03-15',
    });

    expect(result).toEqual({
      id: 'block-1',
      cardId: 'card-1',
      label: 'Книги',
      unit: 'книги',
      frequency: null,
      targetCount: 12,
      isOngoing: false,
      targetDate: '2026-03-15',
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      status: 'active',
    });
    // additionalProperties: false в контракті -- жодного зайвого поля (ownerUserId, progress, overGoalAmount).
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'cardId', 'label', 'unit', 'frequency', 'targetCount', 'isOngoing', 'targetDate', 'createdAt', 'updatedAt', 'status'].sort()
    );
  });

  // 404 card.not_found: use-case шар кидає AppError -- порт пропускає її як є,
  // не перехоплює й не переформульовує (non-disclosure AC-04).
  it('propagates card.not_found from the use-case unchanged', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(createMetricBlock(db, 'user-1', 'not-mine', { label: 'Книги', unit: 'книги', targetCount: 5 })).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    await expect(
      createMetricBlock(db, 'user-1', 'not-mine', { label: 'Книги', unit: 'книги', targetCount: 5 })
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('transferMetricBlock port', () => {
  // DoD + мапінг: cardId зі шляху потрапляє в targetCardId use-case (не в
  // джерело), body.sourceMetricBlockId -> metricBlockId use-case, newLabel: null
  // трактується як "не надано" (ефективна назва = поточна label блоку).
  it('maps path cardId to targetCardId and sourceMetricBlockId to metricBlockId, returning the contract shape', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_METRIC_BLOCK_ROW] }) // findMetricBlockById
      .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] }) // findCardById(target)
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] }) // findCardById(source, з block.cardId)
      .mockResolvedValueOnce({ rows: [] }) // findMetricBlockByCardLabelUnit -- no collision
      .mockResolvedValueOnce({ rows: [transferredBlockRow()] }) // updateMetricBlock
      .mockResolvedValueOnce({ rows: [] }); // reassignEntriesToCard
    const db: Db = { query };

    const result = await transferMetricBlock(db, 'user-1', 'card-target', {
      sourceMetricBlockId: 'block-1',
      newLabel: null,
    });

    expect(result).toEqual({
      id: 'block-1',
      cardId: 'card-target',
      label: 'Пробіжка',
      unit: 'км',
      frequency: 'weekly',
      targetCount: 5,
      isOngoing: false,
      targetDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      status: 'active',
    });

    // findCardById(target) звертається саме до 'card-target' -- шляховий cardId,
    // переданий як targetCardId use-case, не як джерело.
    expect(query.mock.calls[1][1]).toEqual(['card-target', 'user-1']);
    // Колізію перевіряємо під поточною назвою блоку -- newLabel: null трактовано як "не надано".
    expect(query.mock.calls[3][1]).toEqual(['card-target', 'Пробіжка', 'км']);
  });

  // AC-15, DoD "409 на колізію назви ... точно за прикладом": код і httpStatus
  // точно ті, що в openapi.yaml прикладі 409 (metric_block.name_collision) --
  // порт нічого не переформульовує, лише пропускає AppError use-case шару.
  it('propagates a 409 metric_block.name_collision exactly as the use-case raises it', async () => {
    function collisionDb(): Db {
      return {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [SOURCE_METRIC_BLOCK_ROW] })
          .mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] })
          .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] })
          .mockResolvedValueOnce({ rows: [OTHER_METRIC_BLOCK_ROW] }), // collision
      };
    }

    await expect(
      transferMetricBlock(collisionDb(), 'user-1', 'card-target', { sourceMetricBlockId: 'block-1' })
    ).rejects.toMatchObject({ code: 'metric_block.name_collision', httpStatus: 409 });
    await expect(
      transferMetricBlock(collisionDb(), 'user-1', 'card-target', { sourceMetricBlockId: 'block-1' })
    ).rejects.toBeInstanceOf(AppError);
  });

  // Non-disclosure (AC-04): неіснуючий sourceMetricBlockId чи чужа/неіснуюча
  // картка-призначення -- той самий card.not_found, порт пропускає як є.
  it('propagates card.not_found from the use-case unchanged', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [TARGET_CARD_ROW] });
    const db: Db = { query };

    await expect(
      transferMetricBlock(db, 'user-1', 'card-target', { sourceMetricBlockId: 'does-not-exist' })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
  });
});

// --- archiveMetricBlock (US-17/AC-20, D-127) --------------------------------

describe('archiveMetricBlock port', () => {
  // DoD + мапінг: cardId/metricBlockId зі шляху доходять до use-case як є,
  // відповідь -- точно форма MetricBlock контракту, зі status: 'archived'.
  it('returns the archived MetricBlock shaped exactly per the contract schema', async () => {
    const archivedRow = { ...SOURCE_METRIC_BLOCK_ROW, status: 'archived' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_METRIC_BLOCK_ROW] }) // findMetricBlockById
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] }) // findCardById(ownerUserId, block.cardId)
      .mockResolvedValueOnce({ rows: [archivedRow] }); // updateMetricBlock({status:'archived'})
    const db: Db = { query };

    const result = await archiveMetricBlock(db, 'user-1', 'card-source', 'block-1');

    expect(result).toEqual({
      id: 'block-1',
      cardId: 'card-source',
      label: 'Пробіжка',
      unit: 'км',
      frequency: 'weekly',
      targetCount: 5,
      isOngoing: false,
      targetDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      status: 'archived',
    });
  });

  // Non-disclosure (ISS-30-стиль): неіснуючий/чужий/неспівпадаючий cardId --
  // той самий card.not_found, порт пропускає AppError use-case шару як є.
  it('propagates card.not_found from the use-case unchanged', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }); // findMetricBlockById -- not found
    const db: Db = { query };

    await expect(archiveMetricBlock(db, 'user-1', 'card-1', 'does-not-exist')).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    await expect(
      archiveMetricBlock({ query: vi.fn().mockResolvedValueOnce({ rows: [] }) }, 'user-1', 'card-1', 'does-not-exist')
    ).rejects.toBeInstanceOf(AppError);
  });
});

// --- updateMetricBlock (CH-03, docs/features/life-area-card/changes.md) ----

describe('updateMetricBlock port', () => {
  it('returns the updated MetricBlock shaped exactly per the contract schema', async () => {
    const updatedRow = { ...SOURCE_METRIC_BLOCK_ROW, label: 'Біг' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_METRIC_BLOCK_ROW] }) // findMetricBlockById
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [] }) // findMetricBlockByCardLabelUnit -- no collision
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateMetricBlock
    const db: Db = { query };

    const result = await updateMetricBlock(db, 'user-1', 'card-source', 'block-1', { label: 'Біг' });

    expect(result).toEqual({
      id: 'block-1',
      cardId: 'card-source',
      label: 'Біг',
      unit: 'км',
      frequency: 'weekly',
      targetCount: 5,
      isOngoing: false,
      targetDate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      status: 'active',
    });
  });

  it('propagates card.not_found from the use-case unchanged', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };

    await expect(updateMetricBlock(db, 'user-1', 'card-1', 'does-not-exist', { label: 'x' })).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
  });

  it('propagates a 409 metric_block.name_collision exactly as the use-case raises it', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [OTHER_METRIC_BLOCK_ROW] }); // collision
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, 'user-1', 'card-source', 'block-1', { label: 'Плавання' })
    ).rejects.toMatchObject({ code: 'metric_block.name_collision', httpStatus: 409 });
  });

  it('propagates a 422 metric_block.invalid_target_count exactly as the use-case raises it', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [SOURCE_METRIC_BLOCK_ROW] })
      .mockResolvedValueOnce({ rows: [SOURCE_CARD_ROW] });
    const db: Db = { query };

    await expect(
      updateMetricBlock(db, 'user-1', 'card-source', 'block-1', { targetCount: 0 })
    ).rejects.toMatchObject({ code: 'metric_block.invalid_target_count', httpStatus: 422 });
  });
});
