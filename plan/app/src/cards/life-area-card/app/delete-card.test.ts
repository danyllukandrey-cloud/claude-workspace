// CH-16 (docs/features/life-area-card/changes.md): unit-тест deleteCard --
// підроблений db (vi.fn), без мережі. Той самий стиль, що restore-card.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { deleteCard } from './delete-card';
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

describe('deleteCard', () => {
  it('permanently deletes an archived card (findCardById -> DELETE)', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [toRawCardRow(makeArchivedCardRow())] }) // findCardById
      .mockResolvedValueOnce({ rows: [{ id: cardId }] }); // deleteCard (postgres-repo) -- DELETE ... RETURNING id

    await deleteCard(db, ownerUserId, cardId);

    expect(db.query).toHaveBeenCalledTimes(2);
    const deleteCall = (db.query as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(deleteCall[0]).toMatch(/DELETE FROM card/);
    expect(deleteCall[1]).toEqual([cardId, ownerUserId]);
  });

  it('throws card.not_archived for an active card and writes nothing', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [toRawCardRow(makeActiveCardRow())] }); // findCardById

    await expect(deleteCard(db, ownerUserId, cardId)).rejects.toMatchObject({
      code: 'card.not_archived',
      httpStatus: 409,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('throws card.not_found when the card does not exist or belongs to another owner', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] }); // findCardById -> null

    await expect(deleteCard(db, ownerUserId, cardId)).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('throws card.not_found if the card disappears between the read and the delete (race)', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [toRawCardRow(makeArchivedCardRow())] }) // findCardById
      .mockResolvedValueOnce({ rows: [] }); // deleteCard -> false

    await expect(deleteCard(db, ownerUserId, cardId)).rejects.toMatchObject({
      code: 'card.not_found',
      httpStatus: 404,
    });
  });

  it('rejects with AppError instances, not bare errors', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [] });

    await expect(deleteCard(db, ownerUserId, cardId)).rejects.toBeInstanceOf(AppError);
  });

  it('calls recordAction with the card name after a successful delete', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [toRawCardRow(makeArchivedCardRow())] })
      .mockResolvedValueOnce({ rows: [{ id: cardId }] });
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await deleteCard(db, ownerUserId, cardId, recordAction);

    expect(recordAction).toHaveBeenCalledTimes(1);
    expect(recordAction).toHaveBeenCalledWith(db, { ownerUserId, action: expect.stringContaining('Здоров’я') });
  });

  it('does not fail when recordAction is not provided', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rows: [toRawCardRow(makeArchivedCardRow())] })
      .mockResolvedValueOnce({ rows: [{ id: cardId }] });

    await expect(deleteCard(db, ownerUserId, cardId)).resolves.toBeUndefined();
  });

  it('never calls recordAction when the card is already active', async () => {
    const db: Db = { query: vi.fn() };
    (db.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ rows: [toRawCardRow(makeActiveCardRow())] });
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await expect(deleteCard(db, ownerUserId, cardId, recordAction)).rejects.toMatchObject({ code: 'card.not_archived' });
    expect(recordAction).not.toHaveBeenCalled();
  });
});
