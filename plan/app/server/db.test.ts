// RED (T40, review 2026-09-07 B5): server/db.ts гейнить withTransaction --
// pool.connect() + try/finally release, явний ROLLBACK при помилці колбека.
// Коментар у archive-card.ts вже стверджував "та сама транзакція (той самий
// db -- виклик composition root обгортає обидва кроки в BEGIN/COMMIT)", але
// цього коду не існувало ніде -- рев'ю (B5) підтвердило: жодного BEGIN/COMMIT
// у всьому проєкті.
//
// Unit tier: 'pg' замокано (vi.mock) -- лише контроль потоку (порядок
// BEGIN/COMMIT/ROLLBACK, release завжди викликається), без реального
// зʼєднання. Реальна атомарність проти Neon (обидва писи в одній транзакції)
// -- окремо, server/archive-transaction.integration.test.ts (HTTP-рівень,
// та сама вимога DoD T40: "не лише що колаборатор був викликаний").

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};
const mockPoolConnect = vi.fn(async () => mockClient);

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: mockPoolConnect,
    query: vi.fn(),
    end: vi.fn(),
  })),
}));

// createDb() кидає без DATABASE_URL_POOLED (db.ts) -- задаємо ДО імпорту,
// той самий підхід, що решта проєкту (env перевіряється лише на виклику
// createDb(), не на завантаженні модуля).
process.env.DATABASE_URL_POOLED = 'postgres://unit-test-do-not-connect';

const { createDb } = await import('./db');

describe('createDb().withTransaction (T40, review B5)', () => {
  beforeEach(() => {
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPoolConnect.mockClear();
  });

  it('BEGIN -> fn(txDb) -> COMMIT -> release, у цьому порядку, повертає результат fn', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    const db = createDb();

    const result = await db.withTransaction(async (txDb) => {
      await txDb.query('UPDATE card SET status = $1 WHERE id = $2', ['archived', 'card-1']);
      return 'use-case result';
    });

    expect(result).toBe('use-case result');
    expect(mockPoolConnect).toHaveBeenCalledTimes(1);

    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(['BEGIN', 'UPDATE card SET status = $1 WHERE id = $2', 'COMMIT']);
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('колбек, що використовує txDb, ходить через client.query того самого зʼєднання, що BEGIN/COMMIT', async () => {
    mockClient.query.mockResolvedValue({ rows: [{ id: 'row-1' }] });
    const db = createDb();

    await db.withTransaction(async (txDb) => {
      const { rows } = await txDb.query('SELECT 1');
      expect(rows).toEqual([{ id: 'row-1' }]);
    });

    // BEGIN, SELECT, COMMIT -- усі три через ОДИН mockClient.query, не через pool.query.
    expect(mockClient.query).toHaveBeenCalledTimes(3);
  });

  it('явний ROLLBACK і release при падінні колбека -- прокидає оригінальну помилку, COMMIT не викликається', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });
    const db = createDb();
    const boom = new Error('closeStructurePosition failed mid-transaction');

    await expect(
      db.withTransaction(async () => {
        throw boom;
      })
    ).rejects.toThrow(boom);

    const calls = mockClient.query.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls).toContain('ROLLBACK');
    expect(calls).not.toContain('COMMIT');
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });
});
