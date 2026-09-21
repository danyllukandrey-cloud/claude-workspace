// Швидкий unit-тест restoreCard (T33) -- підроблений db (vi.fn), без мережі.
// Інтеграційні сценарії (реальна Neon) додасть орхестратор одним заходом
// після злиття хвилі, щоб уникнути конфлікту в спільному
// migrations.integration.test.ts (див. tasks/t33-app-restore-card.md).

import { describe, it, expect, vi } from 'vitest';
import { restoreCard } from './restore-card';
import { AppError } from '../../../shared/errors';
import type { CardRecord, Db } from '../infra/postgres-repo';

const ownerUserId = 'owner-1';
const cardId = 'card-1';

function makeArchivedCardRow(): CardRecord {
  return {
    id: cardId,
    ownerUserId,
    name: 'Здоров’я',
    description: 'опис',
    status: 'archived',
    trackingMode: 'goals',
    healthState: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function makeActiveCardRow(): CardRecord {
  return { ...makeArchivedCardRow(), status: 'active' };
}

describe('restoreCard', () => {
  // AC-17 happy path: архівована картка -> status active, подія 'restored'
  // пишеться в Літопис.
  it('restores an archived card and writes a "restored" lifecycle event', async () => {
    const restoredRow: CardRecord = { ...makeActiveCardRow(), updatedAt: new Date('2026-01-02T00:00:00Z') };
    const db: Db = { query: vi.fn() };

    // findCardById -> updateCard -> insertLifecycleEvent, у цьому порядку.
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [toRawCardRow(makeArchivedCardRow())] }) // findCardById
      .mockResolvedValueOnce({ rows: [toRawCardRow(restoredRow)] }) // updateCard
      .mockResolvedValueOnce({ rows: [toRawLifecycleEventRow()] }); // insertLifecycleEvent

    const result = await restoreCard(db, ownerUserId, cardId);

    expect(result.status).toBe('active');
    expect(db.query).toHaveBeenCalledTimes(3);
    const lifecycleCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(lifecycleCall[0]).toMatch(/INSERT INTO card_lifecycle_event/);
    expect(lifecycleCall[1]).toEqual([expect.any(String), cardId, 'restored']);
  });

  // Definition of Done (T33): картка вже активна (не архівована) -> card.not_archived,
  // insertLifecycleEvent НЕ викликається -- нічого не пишеться.
  it('throws card.not_archived for an already-active card and writes nothing', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [toRawCardRow(makeActiveCardRow())] }); // findCardById

    await expect(restoreCard(db, ownerUserId, cardId)).rejects.toMatchObject({
      code: 'card.not_archived',
      httpStatus: 409,
    });
    // Лише findCardById -- жодного UPDATE, жодного insertLifecycleEvent.
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  // Non-disclosure (AC-04): чужа/неіснуюча картка -- card.not_found, той самий
  // шаблон, що узгоджений для T14/T15.
  it('throws card.not_found when the card does not exist or belongs to another owner', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] }); // findCardById -> null

    await expect(restoreCard(db, ownerUserId, cardId)).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('throws card.not_found if the card disappears between the read and the update (race)', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [toRawCardRow(makeArchivedCardRow())] }) // findCardById
      .mockResolvedValueOnce({ rows: [] }); // updateCard -> null

    await expect(restoreCard(db, ownerUserId, cardId)).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('rejects with AppError instances, not bare errors', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await expect(restoreCard(db, ownerUserId, cardId)).rejects.toBeInstanceOf(AppError);
  });
});

// --- допоміжне: канонічні "сирі" рядки бази (snake_case), як повертає pg ---

function toRawCardRow(card: CardRecord) {
  return {
    id: card.id,
    owner_user_id: card.ownerUserId,
    name: card.name,
    description: card.description,
    status: card.status,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
  };
}

function toRawLifecycleEventRow() {
  return {
    id: crypto.randomUUID(),
    card_id: cardId,
    transition: 'restored',
    occurred_at: new Date('2026-01-02T00:00:00Z'),
  };
}
