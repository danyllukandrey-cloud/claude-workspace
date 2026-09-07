// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query). Перекладає кожен
// DoD-пункт задачі T19 (написаний як "Integration test: ...") на unit-рівень
// з підробленим db -- так само зробили в archive-card.test.ts для T15.
// Інтеграційний тест проти справжньої Neon додасть орхестратор після злиття
// хвилі (спільний migrations.integration.test.ts, щоб уникнути конфлікту).
//
// Порядок запитів (ISS-32): findEntryById спочатку (query[0]), потім
// findCardById(record.cardId) лише якщо запис знайдено (query[1]).

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
  // підтверджується одним викликом status:'confirmed' після повернення агента.
  it('confirms a pending entry via domain confirmEntry (AC-11)', async () => {
    const updatedRow = { ...PENDING_ENTRY_ROW, status: 'confirmed', confirmed_at: new Date('2026-01-03T00:10:00Z') };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [PENDING_ENTRY_ROW] }) // findEntryById
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateEntryStatus
    const db: Db = { query };

    const result = await resolveEntry(db, { ownerUserId: 'user-1', entryId: 'entry-1', status: 'confirmed' });

    expect(result.status).toBe('confirmed');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0][0]).toMatch(/FROM entry WHERE id = \$1/);
    expect(query.mock.calls[2][0]).toMatch(/UPDATE entry/);
    expect(query.mock.calls[2][1]).toEqual(['confirmed', 'entry-1']);
  });

  // AC-12: виправлення з історії -- запис, що вже був підтверджений,
  // відкочується одним викликом status:'rejected'; сам рядок (за поверненим
  // значенням) лишається читомим, не null -- ніяке видалення не відбувається.
  it('rejects an already-confirmed entry via domain rejectEntry, row stays readable (AC-12)', async () => {
    const updatedRow = { ...CONFIRMED_ENTRY_ROW, status: 'rejected' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CONFIRMED_ENTRY_ROW] }) // findEntryById
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById
      .mockResolvedValueOnce({ rows: [updatedRow] }); // updateEntryStatus
    const db: Db = { query };

    const result = await resolveEntry(db, { ownerUserId: 'user-1', entryId: 'entry-2', status: 'rejected' });

    expect(result).not.toBeNull();
    expect(result.status).toBe('rejected');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toMatch(/UPDATE entry/);
    expect(query.mock.calls[2][1]).toEqual(['rejected', 'entry-2']);
  });

  // AC-06: вирішення конфліктної пари -- викликач (agent API) робить ДВА
  // виклики resolveEntry з протилежними status, по одному на кожен запис пари.
  it('resolves a conflicting pair -- one confirmed, one rejected, via two calls', async () => {
    const pairA = { ...PENDING_ENTRY_ROW, id: 'entry-pair-a', status: 'pending' };
    const pairB = { ...PENDING_ENTRY_ROW, id: 'entry-pair-b', status: 'pending', source_device_id: 'device-b' };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [pairA] }) // findEntryById -- виклик 1
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById -- виклик 1
      .mockResolvedValueOnce({ rows: [{ ...pairA, status: 'confirmed' }] }) // updateEntryStatus -- виклик 1
      .mockResolvedValueOnce({ rows: [pairB] }) // findEntryById -- виклик 2
      .mockResolvedValueOnce({ rows: [CARD_ROW] }) // findCardById -- виклик 2
      .mockResolvedValueOnce({ rows: [{ ...pairB, status: 'rejected' }] }); // updateEntryStatus -- виклик 2
    const db: Db = { query };

    const confirmed = await resolveEntry(db, { ownerUserId: 'user-1', entryId: 'entry-pair-a', status: 'confirmed' });
    const rejected = await resolveEntry(db, { ownerUserId: 'user-1', entryId: 'entry-pair-b', status: 'rejected' });

    expect(confirmed.status).toBe('confirmed');
    expect(rejected.status).toBe('rejected');
    expect(query.mock.calls[2][1]).toEqual(['confirmed', 'entry-pair-a']);
    expect(query.mock.calls[5][1]).toEqual(['rejected', 'entry-pair-b']);
  });

  // Non-disclosure (ISS-32): entryId, що взагалі не існує -- ОДИН код 404
  // (entry.not_found), findCardById НЕ викликається (нема чий власник звіряти).
  it('throws entry.not_found for a missing entry, without writing anything', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }); // findEntryById -- not found
    const db: Db = { query };

    await expect(resolveEntry(db, { ownerUserId: 'user-1', entryId: 'not-mine', status: 'confirmed' })).rejects.toMatchObject({
      code: 'entry.not_found',
      httpStatus: 404,
    });
    expect(query).toHaveBeenCalledTimes(1); // жодного другого/третього виклику не було
  });

  // Non-disclosure (ISS-32): запис існує, але належить картці ІНШОГО власника --
  // findCardById поверне null, той самий код entry.not_found, що й для
  // неіснуючого запису -- не можна розрізнити ці два випадки ззовні.
  it('throws entry.not_found when the entry belongs to a foreign card, without writing anything', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [PENDING_ENTRY_ROW] }) // findEntryById -- існує
      .mockResolvedValueOnce({ rows: [] }); // findCardById -- чужа картка, non-disclosure null
    const db: Db = { query };

    await expect(resolveEntry(db, { ownerUserId: 'user-1', entryId: 'entry-1', status: 'confirmed' })).rejects.toMatchObject({
      code: 'entry.not_found',
      httpStatus: 404,
    });
    expect(query).toHaveBeenCalledTimes(2); // без UPDATE
  });

  // Review 2026-09-07 (backend hardening, T50): ports-шар не валідує `status`
  // проти enum контракту (EntryResolve.status: [confirmed, rejected]) до
  // виклику -- будь-який рядок, що не є ЛІТЕРАЛЬНО 'confirmed', мовчки падав
  // у rejectEntry (`input.status === 'confirmed' ? confirmEntry : rejectEntry`).
  // Типо "pendin" чи навіть валідне на вигляд "pending" відхиляло б запис
  // замість очікуваної помилки.
  it('rejects a status outside the confirmed/rejected enum, before any write', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [PENDING_ENTRY_ROW] }).mockResolvedValueOnce({ rows: [CARD_ROW] });
    const db: Db = { query };

    await expect(
      resolveEntry(db, { ownerUserId: 'user-1', entryId: 'entry-1', status: 'pending' as unknown as 'confirmed' })
    ).rejects.toMatchObject({ code: 'entry.invalid_status', httpStatus: 422 });

    expect(query.mock.calls.some((call) => /UPDATE entry/.test(call[0] as string))).toBe(false);
  });

  it('throws AppError for a foreign or missing entry', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };

    await expect(resolveEntry(db, { ownerUserId: 'user-1', entryId: 'not-mine', status: 'confirmed' })).rejects.toBeInstanceOf(
      AppError
    );
  });
});
