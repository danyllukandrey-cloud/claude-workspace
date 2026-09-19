// App: deleteConnection use-case (вимога 4, чат 2026-09-15 -- "можемо
// розєднати і перезєднати").

import { describe, it, expect, vi } from 'vitest';
import { deleteConnection } from './delete-connection';
import type { Db } from '../infra/postgres-repo';

const OWNER = 'owner-1';

function fakeDb(found: boolean): Db {
  const query = vi.fn(async () => ({ rows: found ? [{ id: 'connection-1' }] : [] }));
  return { query: query as unknown as Db['query'] };
}

describe('deleteConnection -- happy path', () => {
  it('deletes an owned connection', async () => {
    const db = fakeDb(true);
    await expect(deleteConnection(db, { ownerUserId: OWNER, connectionId: 'connection-1' })).resolves.toBeUndefined();
  });

  it('logs the action when recordAction is provided', async () => {
    const db = fakeDb(true);
    const recordAction = vi.fn().mockResolvedValue(undefined);

    await deleteConnection(db, { ownerUserId: OWNER, connectionId: 'connection-1' }, recordAction);

    expect(recordAction).toHaveBeenCalledWith(db, expect.objectContaining({ ownerUserId: OWNER }));
  });
});

describe('deleteConnection -- AC-03 non-disclosure', () => {
  it('rejects with structure.connection_not_found for a missing or not-owned connection', async () => {
    const db = fakeDb(false);

    await expect(
      deleteConnection(db, { ownerUserId: OWNER, connectionId: 'someone-elses-connection' }),
    ).rejects.toMatchObject({ code: 'structure.connection_not_found', httpStatus: 404 });
  });
});
