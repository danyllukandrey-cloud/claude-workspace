// Ports: HTTP-хендлери зв'язків Структури (вимоги 4/5, чат 2026-09-15).
// Той самий fake-Db-за-текстом-SQL стиль, що ./layout-handlers.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { listConnections, createConnection, deleteConnection } from './connection-handlers';
import { AppError } from '../../shared/errors';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';
const STRUCTURE_ID = 'structure-1';

function connectionRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'connection-1',
    structure_id: STRUCTURE_ID,
    card_id_a: 'card-a',
    card_id_b: 'card-b',
    directed: false,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

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

describe('listConnections handler', () => {
  it('returns every connection as a ConnectionDto matching the contract shape', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [connectionRow()] });
    const db: Db = { query };

    const items = await listConnections(db, OWNER);

    expect(items).toEqual([
      { id: 'connection-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: false, createdAt: expect.any(String) },
    ]);
  });
});

describe('createConnection handler', () => {
  it('creates a connection and returns the DTO', async () => {
    const query = vi.fn(async (text: string) => {
      const sql = text.trim().toUpperCase();
      if (text.includes('structure_layout_position') && sql.startsWith('SELECT')) {
        return { rows: [positionRow('card-a'), positionRow('card-b')] };
      }
      if (text.includes('structure_connection') && sql.startsWith('INSERT')) {
        return { rows: [connectionRow({ directed: true })] };
      }
      throw new Error(`Непередбачений запит у тесті: ${text}`);
    });
    const db: Db = { query: query as unknown as Db['query'] };

    const dto = await createConnection(db, OWNER, { cardIdA: 'card-a', cardIdB: 'card-b', directed: true });

    expect(dto).toEqual({ id: 'connection-1', cardIdA: 'card-a', cardIdB: 'card-b', directed: true, createdAt: expect.any(String) });
  });

  it('propagates structure.card_not_found for a card outside this owner (AC-03)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(
      createConnection(db, OWNER, { cardIdA: 'ghost-a', cardIdB: 'ghost-b', directed: false }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('deleteConnection handler', () => {
  it('deletes an owned connection', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'connection-1' }] });
    const db: Db = { query };

    await expect(deleteConnection(db, OWNER, 'connection-1')).resolves.toBeUndefined();
  });

  it('rejects with structure.connection_not_found for a missing or not-owned connection', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(deleteConnection(db, OWNER, 'someone-elses')).rejects.toMatchObject({
      code: 'structure.connection_not_found',
      httpStatus: 404,
    });
  });
});
