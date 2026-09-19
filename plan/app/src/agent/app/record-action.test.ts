import { describe, it, expect, vi } from 'vitest';
import { recordAction } from './record-action';
import type { Db } from './record-action';

describe('recordAction', () => {
  it('inserts one action_log row for the given owner and description', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'log-1', owner_user_id: 'user-1', action: 'Створено картку «Спорт»', occurred_at: new Date() }] });
    const db: Db = { query };

    await recordAction(db, { ownerUserId: 'user-1', action: 'Створено картку «Спорт»' });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO action_log/);
    expect(query.mock.calls[0][1]).toEqual([expect.any(String), 'user-1', 'Створено картку «Спорт»']);
  });
});
