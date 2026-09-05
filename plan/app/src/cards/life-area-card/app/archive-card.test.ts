// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query). Інтеграційний тест проти
// справжньої Neon додасть орхестратор після злиття хвилі (спільний
// migrations.integration.test.ts, щоб уникнути конфлікту).

import { describe, it, expect, vi } from 'vitest';
import { archiveCard } from './archive-card';
import { AppError } from '../../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const ARCHIVED_CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-1',
  name: 'Здоров’я',
  description: 'опис',
  status: 'archived',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-02T00:00:00Z'),
};

const LIFECYCLE_ROW = {
  id: 'event-1',
  card_id: 'card-1',
  transition: 'archived',
  occurred_at: new Date('2026-01-02T00:00:00Z'),
};

describe('archiveCard use-case', () => {
  // AC-16 happy path: updateCard позначає status='archived', потім подія "archived".
  it('archives an owned card and records an "archived" lifecycle event', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [ARCHIVED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [LIFECYCLE_ROW] });
    const db: Db = { query };

    const record = await archiveCard(db, { ownerUserId: 'user-1', cardId: 'card-1' });

    expect(record).not.toBeNull();
    expect(record?.status).toBe('archived');
    expect(query).toHaveBeenCalledTimes(2);

    // Перший запит -- UPDATE card ... SET status = ..., з переданим 'archived'
    // серед параметрів; другий -- INSERT INTO card_lifecycle_event з transition='archived'.
    expect(query.mock.calls[0][0]).toMatch(/UPDATE card/);
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['archived']));
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO card_lifecycle_event/);
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining(['archived']));
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка -- updateCard повертає null,
  // use-case кидає AppError('card.not_found', 404) (та сама форма, що T14/T33),
  // і insertLifecycleEvent НЕ викликається -- нема що архівувати.
  it('throws card.not_found and never writes a lifecycle event for a foreign or missing card', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] }); // кожен виклик -- порожньо, не лише перший
    const db: Db = { query };

    await expect(archiveCard(db, { ownerUserId: 'user-1', cardId: 'not-mine' })).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    await expect(archiveCard(db, { ownerUserId: 'user-1', cardId: 'not-mine' })).rejects.toBeInstanceOf(AppError);
    expect(query).toHaveBeenCalledTimes(2); // два виклики expect вище -- по одному UPDATE кожен
    expect(query.mock.calls[0][0]).toMatch(/UPDATE card/);
  });

  // D-69/D-103 (закриває ISS-26): успішна архівація викликає інжектований
  // closeStructurePosition з тим самим db і id архівованої картки.
  it('calls closeStructurePosition with the archived card id on success', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [ARCHIVED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [LIFECYCLE_ROW] });
    const db: Db = { query };
    const closeStructurePosition = vi.fn().mockResolvedValue(undefined);

    await archiveCard(db, { ownerUserId: 'user-1', cardId: 'card-1' }, closeStructurePosition);

    expect(closeStructurePosition).toHaveBeenCalledTimes(1);
    expect(closeStructurePosition).toHaveBeenCalledWith(db, 'card-1');
  });

  // Без переданого closeStructurePosition (composition root ще не підключив
  // структуру, чи тест) -- use-case просто не робить цей крок, не падає.
  it('does not fail when closeStructurePosition is not provided', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [ARCHIVED_CARD_ROW] })
      .mockResolvedValueOnce({ rows: [LIFECYCLE_ROW] });
    const db: Db = { query };

    await expect(archiveCard(db, { ownerUserId: 'user-1', cardId: 'card-1' })).resolves.toMatchObject({
      status: 'archived',
    });
  });

  // Non-disclosure: чужа/неіснуюча картка -- closeStructurePosition НЕ
  // викликається (нема що закривати, помилка кидається раніше).
  it('never calls closeStructurePosition for a foreign or missing card', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };
    const closeStructurePosition = vi.fn().mockResolvedValue(undefined);

    await expect(archiveCard(db, { ownerUserId: 'user-1', cardId: 'not-mine' }, closeStructurePosition)).rejects.toThrow(
      AppError
    );
    expect(closeStructurePosition).not.toHaveBeenCalled();
  });
});
