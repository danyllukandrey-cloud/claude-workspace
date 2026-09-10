// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query). Інтеграційний тест проти
// справжньої Neon додасть орхестратор після злиття хвилі (спільний
// migrations.integration.test.ts, щоб уникнути конфлікту).

import { describe, it, expect, vi } from 'vitest';
import { createEntry } from './create-entry';
import { AppError } from '../../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-1',
  name: 'Здоров’я',
  description: 'опис',
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const METRIC_BLOCK_ROW = {
  id: 'block-1',
  card_id: 'card-1',
  label: 'Пробіжка',
  unit: 'км',
  frequency: 'weekly',
  target_count: '20',
  is_ongoing: false,
  target_date: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

function entryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'entry-existing',
    metric_block_id: 'block-1',
    card_id: 'card-1',
    amount: '2',
    raw_text: null,
    status: 'confirmed',
    source_device_id: 'device-a',
    recorded_at: new Date('2026-02-01T12:00:00Z'),
    confirmed_at: new Date('2026-02-01T12:00:00Z'),
    created_at: new Date('2026-02-01T12:00:00Z'),
    ...overrides,
  };
}

const BASE_INPUT = {
  ownerUserId: 'user-1',
  cardId: 'card-1',
  metricBlockId: 'block-1',
  amount: 3,
  recordedAt: new Date('2026-02-01T12:00:30Z').getTime(), // 30s після конфліктного рядка -- у межах дефолтного windowMs
  sourceDeviceId: 'device-b',
};

describe('createEntry use-case', () => {
  // AC-01 happy path: немає конфлікту, агент доступний -> новий запис 'confirmed'.
  it('inserts a confirmed entry on the happy path (no conflict, agent available)', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard
      .mockResolvedValueOnce({ rows: [] }) // listEntriesByMetricBlock -- немає існуючих записів
      .mockResolvedValueOnce({ rows: [entryRow({ id: 'entry-new', status: 'confirmed' })] }); // insertEntry
    const db: Db = { query };

    const result = await createEntry(db, { ...BASE_INPUT, agentAvailable: true });

    expect(result.status).toBe('confirmed');
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[3][0]).toMatch(/INSERT INTO entry/);
    expect(query.mock.calls[3][1]).toEqual(expect.arrayContaining(['confirmed']));
  });

  // AC-06: конфліктний запис (інший пристрій, у межах windowMs) -> новий запис
  // 'pending' І існуючий конфліктний запис (зараз 'confirmed') теж переводиться
  // в 'pending' -- обидва, не лише новий.
  it('marks both the new entry and the conflicting existing entry as pending', async () => {
    const conflicting = entryRow({ id: 'entry-existing', status: 'confirmed', source_device_id: 'device-a' });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard
      .mockResolvedValueOnce({ rows: [conflicting] }) // listEntriesByMetricBlock
      .mockResolvedValueOnce({ rows: [entryRow({ id: 'entry-new', status: 'pending', source_device_id: 'device-b' })] }) // insertEntry
      .mockResolvedValueOnce({ rows: [entryRow({ id: 'entry-existing', status: 'pending' })] }); // updateEntryStatus
    const db: Db = { query };

    const result = await createEntry(db, { ...BASE_INPUT, agentAvailable: true });

    expect(result.status).toBe('pending');
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[3][0]).toMatch(/INSERT INTO entry/);
    expect(query.mock.calls[3][1]).toEqual(expect.arrayContaining(['pending']));
    expect(query.mock.calls[4][0]).toMatch(/UPDATE entry/);
    expect(query.mock.calls[4][1]).toEqual(['pending', 'entry-existing']);
  });

  // AC-11: агент недоступний -> запис завжди pending, незалежно від конфлікту.
  // Тут конфлікту немає (порожній список існуючих), тож updateEntryStatus не
  // викликається -- нема кого переводити в pending, крім самого нового запису.
  it('marks the entry pending when the agent is unavailable, even without a conflict', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard
      .mockResolvedValueOnce({ rows: [] }) // listEntriesByMetricBlock -- немає конфлікту
      .mockResolvedValueOnce({ rows: [entryRow({ id: 'entry-new', status: 'pending' })] }); // insertEntry
    const db: Db = { query };

    const result = await createEntry(db, { ...BASE_INPUT, agentAvailable: false });

    expect(result.status).toBe('pending');
    expect(query).toHaveBeenCalledTimes(4); // немає п'ятого виклику -- updateEntryStatus не викликаний
    expect(query.mock.calls[3][1]).toEqual(expect.arrayContaining(['pending']));
  });

  // Конфліктний існуючий запис, що вже 'pending' -- updateEntryStatus не
  // викликається повторно (нема сенсу переводити pending у pending).
  it('does not call updateEntryStatus when the conflicting existing entry is already pending', async () => {
    const conflicting = entryRow({ id: 'entry-existing', status: 'pending', source_device_id: 'device-a' });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard
      .mockResolvedValueOnce({ rows: [conflicting] }) // listEntriesByMetricBlock
      .mockResolvedValueOnce({ rows: [entryRow({ id: 'entry-new', status: 'pending' })] }); // insertEntry
    const db: Db = { query };

    await createEntry(db, { ...BASE_INPUT, agentAvailable: true });

    expect(query).toHaveBeenCalledTimes(4); // без UPDATE
  });

  // AC-06 (виправлено по критиці): вже 'rejected' існуючий запис НЕ бере
  // участі в конфлікті -- новий, незалежний запис лишається 'confirmed',
  // а не мовчки стає 'pending' через давно вирішений рядок.
  it('ignores an already-rejected existing entry when detecting conflicts', async () => {
    const rejected = entryRow({ id: 'entry-existing', status: 'rejected', source_device_id: 'device-a' });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard
      .mockResolvedValueOnce({ rows: [rejected] }) // listEntriesByMetricBlock -- лише rejected
      .mockResolvedValueOnce({ rows: [entryRow({ id: 'entry-new', status: 'confirmed' })] }); // insertEntry
    const db: Db = { query };

    const result = await createEntry(db, { ...BASE_INPUT, agentAvailable: true });

    expect(result.status).toBe('confirmed');
    expect(query).toHaveBeenCalledTimes(4); // без UPDATE -- rejected-рядок не викликав конфлікт
    expect(query.mock.calls[3][1]).toEqual(expect.arrayContaining(['confirmed']));
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка -- AppError('metric_block.not_found', 404)
  // (той самий код 404, що документує contracts/openapi.yaml для цього ендпоінту),
  // і жоден подальший крок (list/insert/update) не виконується.
  it('throws metric_block.not_found for a foreign or missing card and writes nothing', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(createEntry(db, { ...BASE_INPUT, cardId: 'not-mine' })).rejects.toMatchObject({
      code: 'metric_block.not_found',
      httpStatus: 404,
    });
    await expect(createEntry(db, { ...BASE_INPUT, cardId: 'not-mine' })).rejects.toBeInstanceOf(AppError);
    expect(query).toHaveBeenCalledTimes(2); // два виклики expect вище -- по одному findCardById кожен
  });

  // AC-04 boundary: metricBlockId, що не належить (валідній, своїй) картці --
  // та сама форма помилки, і жоден подальший крок (list entries/insert) не
  // виконується. Це і є фікс блокера з рев'ю критика: раніше жодної такої
  // перевірки не було.
  it('throws metric_block.not_found when the metric block does not belong to the given card', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById -- картка своя
      .mockResolvedValueOnce({ rows: [] }); // listMetricBlocksByCard -- немає блоку з таким id
    const db: Db = { query };

    await expect(createEntry(db, { ...BASE_INPUT, metricBlockId: 'block-not-mine' })).rejects.toMatchObject({
      code: 'metric_block.not_found',
      httpStatus: 404,
    });
    expect(query).toHaveBeenCalledTimes(2); // без listEntriesByMetricBlock/insertEntry
  });
});
