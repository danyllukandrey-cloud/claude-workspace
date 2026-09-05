// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query). Перекладає кожен
// DoD-пункт задачі T19 (написаний як "Integration test: ...") на unit-рівень
// з підробленим db -- так само зробили в archive-card.test.ts для T15.
// Інтеграційний тест проти справжньої Neon додасть орхестратор після злиття
// хвилі (спільний migrations.integration.test.ts, щоб уникнути конфлікту).

import { describe, it, expect, vi } from 'vitest';
import { resolveEntry } from './resolve-entry';
import { AppError } from '../../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-1',
  name: 'Здоров’я',
  description: 'опис',
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

const PENDING_ENTRY_ROW = {
  id: 'entry-1',
  metric_block_id: 'block-1',
  card_id: 'card-1',
  amount: '5',
  raw_text: 'пробіг 5 км',
  status: 'pending',
  source_device_id: 'device-a',
  recorded_at: new Date('2026-01-03T00:00:00Z'),
  confirmed_at: null,
  created_at: new Date('2026-01-03T00:00:00Z'),
};

const CONFIRMED_ENTRY_ROW = {
  ...PENDING_ENTRY_ROW,
  id: 'entry-2',
  status: 'confirmed',
  confirmed_at: new Date('2026-01-03T00:05:00Z'),
};

describe('resolveEntry use-case', () => {
  // AC-11: pending-запис, що накопичився, поки агент був недоступний,
  // підтверджується одним викликом 'confirm' після повернення агента.
  it('confirms a pending entry via domain confirmEntry (AC-11)', async () => {
    const updatedRow = { ...PENDING_ENTRY_ROW, status: 'confirmed', confirmed_at: new Date('2026-01-03T00:10:00Z') };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [PENDING_ENTRY_ROW] }) // listEntriesByCard
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateEntryStatus
    const db: Db = { query };

    const result = await resolveEntry(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      entryId: 'entry-1',
      resolution: 'confirm',
    });

    expect(result.status).toBe('confirmed');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toMatch(/UPDATE entry/);
    expect(query.mock.calls[2][1]).toEqual(['confirmed', 'entry-1']);
  });

  // AC-12: виправлення з історії -- запис, що вже був підтверджений,
  // відкочується одним викликом 'reject'; сам рядок (за поверненим
  // значенням) лишається читомим, не null -- ніяке видалення не відбувається.
  it('rejects an already-confirmed entry via domain rejectEntry, row stays readable (AC-12)', async () => {
    const updatedRow = { ...CONFIRMED_ENTRY_ROW, status: 'rejected' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [CONFIRMED_ENTRY_ROW] }) // listEntriesByCard
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateEntryStatus
    const db: Db = { query };

    const result = await resolveEntry(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      entryId: 'entry-2',
      resolution: 'reject',
    });

    expect(result).not.toBeNull();
    expect(result.status).toBe('rejected');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toMatch(/UPDATE entry/);
    expect(query.mock.calls[2][1]).toEqual(['rejected', 'entry-2']);
  });

  // AC-06: вирішення конфліктної пари -- викликач (agent API) робить ДВА
  // виклики resolveEntry з протилежними резолюціями, по одному на кожен
  // запис пари. Тут перевіряємо саме цю пару навпростець (DoD-пункт задачі,
  // раніше не мав власного тесту, лише окремо протестовані confirm/reject).
  it('resolves a conflicting pair -- one confirmed, one rejected, via two calls', async () => {
    const pairA = { ...PENDING_ENTRY_ROW, id: 'entry-pair-a', status: 'pending' };
    const pairB = { ...PENDING_ENTRY_ROW, id: 'entry-pair-b', status: 'pending', source_device_id: 'device-b' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById -- виклик 1
      .mockResolvedValueOnce({ rows: [pairA, pairB] }) // listEntriesByCard -- виклик 1
      .mockResolvedValueOnce({ rows: [{ ...pairA, status: 'confirmed' }] }) // updateEntryStatus -- виклик 1
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById -- виклик 2
      .mockResolvedValueOnce({ rows: [pairA, pairB] }) // listEntriesByCard -- виклик 2
      .mockResolvedValueOnce({ rows: [{ ...pairB, status: 'rejected' }] }); // updateEntryStatus -- виклик 2
    const db: Db = { query };

    const confirmed = await resolveEntry(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      entryId: 'entry-pair-a',
      resolution: 'confirm',
    });
    const rejected = await resolveEntry(db, {
      ownerUserId: 'user-1',
      cardId: 'card-1',
      entryId: 'entry-pair-b',
      resolution: 'reject',
    });

    expect(confirmed.status).toBe('confirmed');
    expect(rejected.status).toBe('rejected');
    expect(query.mock.calls[2][1]).toEqual(['confirmed', 'entry-pair-a']);
    expect(query.mock.calls[5][1]).toEqual(['rejected', 'entry-pair-b']);
  });

  // Non-disclosure межа для запису: entryId, що не належить цій картці
  // (чужий чи неіснуючий) -- listEntriesByCard не знаходить рядок, use-case
  // кидає AppError('entry.not_found', 404), updateEntryStatus НЕ викликається.
  it('throws entry.not_found for a foreign or missing entry, without writing anything', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [PENDING_ENTRY_ROW] }); // listEntriesByCard -- шуканого entryId серед них немає
    const db: Db = { query };

    await expect(
      resolveEntry(db, { ownerUserId: 'user-1', cardId: 'card-1', entryId: 'not-mine', resolution: 'confirm' })
    ).rejects.toMatchObject({ code: 'entry.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(2); // жодного третього виклику (UPDATE) не було
  });

  // Non-disclosure межа для картки (AC-04, той самий шаблон, що в archive-card.ts):
  // чужа/неіснуюча картка -- findCardById повертає null, use-case кидає
  // AppError('card.not_found', 404) РАНІШЕ за будь-яке читання записів.
  it('throws card.not_found for a foreign or missing card, without reading entries or writing anything', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      resolveEntry(db, { ownerUserId: 'user-1', cardId: 'not-mine', entryId: 'entry-1', resolution: 'confirm' })
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      resolveEntry(db, { ownerUserId: 'user-1', cardId: 'not-mine', entryId: 'entry-1', resolution: 'confirm' })
    ).rejects.toMatchObject({ code: 'card.not_found', httpStatus: 404 });
    expect(query).toHaveBeenCalledTimes(2); // два виклики expect вище -- по одному findCardById кожен
  });
});
