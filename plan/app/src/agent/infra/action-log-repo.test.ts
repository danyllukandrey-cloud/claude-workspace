// Швидкий unit-тест (без мережі) -- підробляємо db через vi.fn(), той самий
// підхід, що ../infra/postgres-repo.test.ts.

import { describe, it, expect, vi } from 'vitest';
import { insertActionLogEntry, findActionLogByOwner } from './action-log-repo';
import type { Db } from './action-log-repo';

const ACTION_LOG_ROW = {
  id: 'log-1',
  owner_user_id: 'user-1',
  action: 'Створено картку «Спорт»',
  occurred_at: new Date('2026-09-15T10:00:00Z'),
};

describe('action-log-repo', () => {
  it('insertActionLogEntry inserts a row and returns the camelCase record', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [ACTION_LOG_ROW] });
    const db: Db = { query };

    const record = await insertActionLogEntry(db, { id: 'log-1', ownerUserId: 'user-1', action: 'Створено картку «Спорт»' });

    expect(record).toEqual({
      id: 'log-1',
      ownerUserId: 'user-1',
      action: 'Створено картку «Спорт»',
      occurredAt: ACTION_LOG_ROW.occurred_at,
    });
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO action_log/);
    expect(query.mock.calls[0][1]).toEqual(['log-1', 'user-1', 'Створено картку «Спорт»']);
  });

  it('findActionLogByOwner scopes by owner_user_id and orders newest first', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [ACTION_LOG_ROW] });
    const db: Db = { query };

    const records = await findActionLogByOwner(db, 'user-1');

    expect(records).toEqual([
      {
        id: 'log-1',
        ownerUserId: 'user-1',
        action: 'Створено картку «Спорт»',
        occurredAt: ACTION_LOG_ROW.occurred_at,
      },
    ]);
    expect(query.mock.calls[0][0]).toMatch(/WHERE owner_user_id = \$1/);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY occurred_at DESC/);
    expect(query.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('findActionLogByOwner returns an empty list when the owner has no rows', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await expect(findActionLogByOwner(db, 'user-1')).resolves.toEqual([]);
  });
});
