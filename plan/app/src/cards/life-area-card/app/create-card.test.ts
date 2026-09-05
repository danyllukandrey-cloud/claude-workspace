// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), що повертає
// канонічні рядки-обʼєкти (як реальний pg.Pool.query). Інтеграційний тест проти
// справжньої Neon додасть орхестратор після злиття хвилі (спільний
// migrations.integration.test.ts, щоб уникнути конфлікту).

import { describe, it, expect, vi } from 'vitest';
import { createCard } from './create-card';
import { CardValidationError } from '../domain/card';
import type { Db } from '../infra/postgres-repo';

const CARD_ROW = {
  id: 'card-1',
  owner_user_id: 'user-1',
  name: 'Здоров’я',
  description: null,
  status: 'active',
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

const LIFECYCLE_ROW = {
  id: 'event-1',
  card_id: 'card-1',
  transition: 'created',
  occurred_at: new Date('2026-01-01T00:00:00Z'),
};

describe('createCard use-case', () => {
  // AC-02 happy path: валідна назва -- insertCard, потім подія "created".
  it('creates a card and records a "created" lifecycle event', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [CARD_ROW] })
      .mockResolvedValueOnce({ rows: [LIFECYCLE_ROW] });
    const db: Db = { query };

    const record = await createCard(db, { ownerUserId: 'user-1', name: 'Здоров’я' });

    expect(record.name).toBe('Здоров’я');
    expect(record.status).toBe('active');
    expect(query).toHaveBeenCalledTimes(2);

    // Перший запит -- INSERT INTO card, другий -- INSERT INTO card_lifecycle_event
    // з transition='created'.
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO card/);
    expect(query.mock.calls[1][0]).toMatch(/INSERT INTO card_lifecycle_event/);
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining(['created']));
  });

  // AC-02: порожня назва відхиляється БЕЗ жодного запису в базу -- саме цю
  // поведінку пізніше повторить інтеграційний тест орхестратора.
  it('rejects an empty name before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(createCard(db, { ownerUserId: 'user-1', name: '' })).rejects.toBeInstanceOf(CardValidationError);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name before any db call', async () => {
    const query = vi.fn();
    const db: Db = { query };

    await expect(createCard(db, { ownerUserId: 'user-1', name: '   ' })).rejects.toMatchObject({
      code: 'card.name_required',
    });
    expect(query).not.toHaveBeenCalled();
  });
});
