// App: createConnection use-case (вимоги 4/5, чат 2026-09-15).

import { describe, it, expect, vi } from 'vitest';
import { createConnection } from './create-connection';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function positionRow(cardId: string) {
  return {
    id: `position-${cardId}`,
    structure_id: STRUCTURE_ID,
    card_id: cardId,
    position_x: 10,
    position_y: 10,
    status: 'active' as const,
    position_updated_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date('2026-01-01T00:00:00Z'),
  };
}

function fakeDb(activePositions: ReturnType<typeof positionRow>[]): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    const sql = text.trim().toUpperCase();
    if (text.includes('structure_layout_position') && sql.startsWith('SELECT')) {
      return { rows: activePositions };
    }
    if (text.includes('structure_connection') && sql.startsWith('INSERT')) {
      return {
        rows: [
          {
            id: 'connection-1',
            structure_id: STRUCTURE_ID,
            card_id_a: 'card-a',
            card_id_b: 'card-b',
            directed: false,
            created_at: new Date('2026-01-02T00:00:00Z'),
          },
        ],
      };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

describe('createConnection -- happy path (лінія/стрілка)', () => {
  it('creates an undirected line between two owned cards', async () => {
    const db = fakeDb([positionRow('card-a'), positionRow('card-b')]);

    const created = await createConnection(db, { ownerUserId: OWNER, cardIdA: 'card-a', cardIdB: 'card-b', directed: false });

    expect(created).toMatchObject({ cardIdA: 'card-a', cardIdB: 'card-b', directed: false });
  });

  it('creates a directed arrow when directed: true', async () => {
    const db = fakeDb([positionRow('card-a'), positionRow('card-b')]);

    await createConnection(db, { ownerUserId: OWNER, cardIdA: 'card-a', cardIdB: 'card-b', directed: true });

    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
    const insert = calls.find(([text]) => text.includes('structure_connection') && text.trim().toUpperCase().startsWith('INSERT'))!;
    expect(insert[1]).toContain(true);
  });
});

describe('createConnection -- validation', () => {
  it('rejects connecting a card to itself with 422', async () => {
    const db = fakeDb([positionRow('card-a')]);

    await expect(
      createConnection(db, { ownerUserId: OWNER, cardIdA: 'card-a', cardIdB: 'card-a', directed: false }),
    ).rejects.toMatchObject({ code: 'structure.connection_requires_two_cards', httpStatus: 422 });
  });
});

describe('createConnection -- AC-03 non-disclosure', () => {
  it('rejects with structure.card_not_found when either card has no active position for this owner', async () => {
    const db = fakeDb([positionRow('card-a')]); // card-b missing

    await expect(
      createConnection(db, { ownerUserId: OWNER, cardIdA: 'card-a', cardIdB: 'card-b', directed: false }),
    ).rejects.toMatchObject({ code: 'structure.card_not_found', httpStatus: 404 });
  });

  it('rejects with the same code for a card belonging to a different owner', async () => {
    const db = fakeDb([]); // owner scoping already excluded both from the list

    await expect(
      createConnection(db, { ownerUserId: OWNER, cardIdA: 'not-mine', cardIdB: 'also-not-mine', directed: false }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
