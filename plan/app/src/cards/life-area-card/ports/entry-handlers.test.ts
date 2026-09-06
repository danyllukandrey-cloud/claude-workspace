// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query), той самий підхід, що
// app/create-entry.test.ts / app/resolve-entry.test.ts. Перевіряє T23 DoD:
// створення відповідає контракту (confirmed/pending), PATCH вирішує
// конфлікт/виправляє, історія повертається найновішими зверху (AC-13).

import { describe, it, expect, vi } from 'vitest';
import { createEntry, resolveEntry, listEntries } from './entry-handlers';
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

describe('createEntry handler', () => {
  // AC-01 happy path -- немає конфлікту, агент доступний (дефолт use-case) -> confirmed.
  it('returns a confirmed Entry on the happy path, contract-shaped', async () => {
    const insertedRow = entryRow({ id: 'entry-new', status: 'confirmed', source_device_id: 'device-b', amount: '3' });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard
      .mockResolvedValueOnce({ rows: [] }) // listEntriesByMetricBlock -- жодного конфлікту
      .mockResolvedValueOnce({ rows: [insertedRow] }); // insertEntry
    const db: Db = { query };

    const result = await createEntry(db, 'user-1', 'card-1', 'block-1', {
      amount: 3,
      rawText: 'пробіг 3 км',
      sourceDeviceId: 'device-b',
    });

    expect(result.status).toBe('confirmed');
    expect(result.cardId).toBe('card-1');
    expect(result.metricBlockId).toBe('block-1');
    expect(result.amount).toBe(3);
    // Публічна схема Entry не має ownerUserId -- перевіряємо, що поле відсутнє.
    expect(result).not.toHaveProperty('ownerUserId');
    // Date-поля -- ISO-рядок, не Date/timestamp.
    expect(typeof result.recordedAt).toBe('string');
    expect(typeof result.createdAt).toBe('string');
  });

  // AC-11: агент недоступний (use-case дефолт agentAvailable=true -- цей
  // сценарій свідомо покритий на рівні app/create-entry.test.ts, тут
  // достатньо AC-06 -- конфлікт близький за часом з іншого пристрою -> pending.
  it('returns a pending Entry when a same-window conflicting entry exists (AC-06)', async () => {
    const conflicting = entryRow({ id: 'entry-conflict', source_device_id: 'device-a', recorded_at: new Date('2026-02-01T12:00:10Z') });
    const insertedRow = entryRow({ id: 'entry-new', status: 'pending', source_device_id: 'device-b' });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [METRIC_BLOCK_ROW] }) // listMetricBlocksByCard
      .mockResolvedValueOnce({ rows: [conflicting] }) // listEntriesByMetricBlock -- конфлікт
      .mockResolvedValueOnce({ rows: [insertedRow] }) // insertEntry
      .mockResolvedValueOnce({ rows: [{ ...conflicting, status: 'pending' }] }); // updateEntryStatus на конфліктний
    const db: Db = { query };

    const result = await createEntry(db, 'user-1', 'card-1', 'block-1', {
      amount: 2,
      sourceDeviceId: 'device-b',
    });

    expect(result.status).toBe('pending');
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка чи блок -- один код 404.
  it('propagates metric_block.not_found for a foreign or missing card', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }); // findCardById -- нема
    const db: Db = { query };

    await expect(createEntry(db, 'user-1', 'not-mine', 'block-1', { amount: 1 })).rejects.toMatchObject({
      code: 'metric_block.not_found',
      httpStatus: 404,
    });
  });
});

describe('resolveEntry handler', () => {
  // AC-11/AC-12: PATCH переводить статус і повертає контрактну форму.
  it('resolves an entry and returns it contract-shaped', async () => {
    const pendingRow = entryRow({ id: 'entry-1', status: 'pending', confirmed_at: null });
    const updatedRow = { ...pendingRow, status: 'confirmed', confirmed_at: new Date('2026-02-01T12:05:00Z') };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [pendingRow] }) // findEntryById
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateEntryStatus
    const db: Db = { query };

    const result = await resolveEntry(db, 'user-1', 'entry-1', { status: 'confirmed' });

    expect(result.status).toBe('confirmed');
    expect(result.confirmedAt).toBe('2026-02-01T12:05:00.000Z');
  });

  // Non-disclosure (AC-04/ISS-32): чужий/неіснуючий запис -- один код 404.
  it('propagates entry.not_found for a foreign or missing entry', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }); // findEntryById -- нема
    const db: Db = { query };

    await expect(resolveEntry(db, 'user-1', 'not-mine', { status: 'rejected' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('listEntries handler', () => {
  // AC-13: історія найновіші зверху -- repo вже сортує, хендлер лише читає й пагінує.
  it('returns entries newest-first as returned by the repo, within an EntryPage envelope', async () => {
    const newest = entryRow({ id: 'entry-3', recorded_at: new Date('2026-02-03T00:00:00Z') });
    const middle = entryRow({ id: 'entry-2', recorded_at: new Date('2026-02-02T00:00:00Z') });
    const oldest = entryRow({ id: 'entry-1', recorded_at: new Date('2026-02-01T00:00:00Z') });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [newest, middle, oldest] }); // listEntriesByCard -- уже DESC
    const db: Db = { query };

    const page = await listEntries(db, 'user-1', 'card-1');

    expect(page.items.map((entry) => entry.id)).toEqual(['entry-3', 'entry-2', 'entry-1']);
    expect(page.has_next).toBe(false);
    expect(page.has_prev).toBe(false);
    expect(page.next_cursor).toBeNull();
  });

  // Пагінація: limit ріже масив, next_cursor -- id останнього елемента сторінки.
  it('paginates with limit and returns a next_cursor when more entries remain', async () => {
    const rows = [
      entryRow({ id: 'entry-3', recorded_at: new Date('2026-02-03T00:00:00Z') }),
      entryRow({ id: 'entry-2', recorded_at: new Date('2026-02-02T00:00:00Z') }),
      entryRow({ id: 'entry-1', recorded_at: new Date('2026-02-01T00:00:00Z') }),
    ];
    const query = vi.fn().mockResolvedValueOnce({ rows: [CARD_ROW] }).mockResolvedValueOnce({ rows });
    const db: Db = { query };

    const page = await listEntries(db, 'user-1', 'card-1', { limit: 2 });

    expect(page.items.map((entry) => entry.id)).toEqual(['entry-3', 'entry-2']);
    expect(page.has_next).toBe(true);
    expect(page.has_prev).toBe(false);
    expect(page.next_cursor).toBe('entry-2');
  });

  // after-cursor продовжує з наступного елемента після нього.
  it('continues after the given cursor', async () => {
    const rows = [
      entryRow({ id: 'entry-3', recorded_at: new Date('2026-02-03T00:00:00Z') }),
      entryRow({ id: 'entry-2', recorded_at: new Date('2026-02-02T00:00:00Z') }),
      entryRow({ id: 'entry-1', recorded_at: new Date('2026-02-01T00:00:00Z') }),
    ];
    const query = vi.fn().mockResolvedValueOnce({ rows: [CARD_ROW] }).mockResolvedValueOnce({ rows });
    const db: Db = { query };

    const page = await listEntries(db, 'user-1', 'card-1', { after: 'entry-3', limit: 50 });

    expect(page.items.map((entry) => entry.id)).toEqual(['entry-2', 'entry-1']);
    expect(page.has_prev).toBe(true);
    expect(page.has_next).toBe(false);
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка -- card.not_found, історія не читається.
  it('throws card.not_found for a foreign or missing card, without reading entries', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }); // findCardById -- нема
    const db: Db = { query };

    await expect(listEntries(db, 'user-1', 'not-mine')).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
