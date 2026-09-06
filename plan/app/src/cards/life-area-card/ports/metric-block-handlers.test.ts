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
import { createMetricBlock, transferMetricBlock } from './metric-block-handlers';
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
};

const OTHER_METRIC_BLOCK_ROW = { ...SOURCE_METRIC_BLOCK_ROW, id: 'block-other', label: 'Плавання' };

function transferredBlockRow(overrides: Partial<typeof SOURCE_METRIC_BLOCK_ROW> = {}) {
  return { ...SOURCE_METRIC_BLOCK_ROW, card_id: 'card-target', ...overrides };
}

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
    });
    // additionalProperties: false в контракті -- жодного зайвого поля (ownerUserId, progress, overGoalAmount).
    expect(Object.keys(result).sort()).toEqual(
      ['id', 'cardId', 'label', 'unit', 'frequency', 'targetCount', 'isOngoing', 'targetDate', 'createdAt', 'updatedAt'].sort()
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
