// T44 -- Unit-тест (без мережі) для ports-хендлерів GET/POST/DELETE
// /sync-resources (docs/features/agent/contracts/openapi.yaml). Той самий
// підхід, що ./rules-handler.test.ts -- підробляємо `db` через vi.fn(),
// що повертає канонічні рядки-об'єкти (як реальний pg.Pool.query).
//
// DoD (tasks.json T44): "Handlers return 200/201/204/404/422 exactly per
// contract (sync_resource.url_invalid on 422)". "200/201/204" тут -- форма
// значення, що хендлер повертає (масив / DTO-об'єкт / void), бо жоден HTTP-
// фреймворк ще не підключений (той самий коментар, що rules-handler.ts) --
// сам HTTP-статус проставить майбутній транспортний шар з цього значення.

import { describe, it, expect, vi } from 'vitest';
import { AppError } from '../../shared/errors';
import { listSyncResources, createSyncResource, deleteSyncResource } from './sync-resource-handler';
import type { Db } from '../app/sync-resources';

const USER = 'user-1';

function rawRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'resource-1',
    user_id: USER,
    url: 'https://docs.google.com/document/d/abc',
    status: 'active',
    last_synced_at: null,
    last_error: null,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('listSyncResources handler (AC-18, GET /api/v1/sync-resources) -- 200', () => {
  it('returns a contract-shaped SyncResource array, without userId', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [rawRow(), rawRow({ id: 'resource-2', status: 'error', last_error: 'access revoked' })] });
    const db: Db = { query };

    const result = await listSyncResources(db, USER);

    expect(result).toEqual([
      {
        id: 'resource-1',
        url: 'https://docs.google.com/document/d/abc',
        status: 'active',
        lastSyncedAt: null,
        lastError: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'resource-2',
        url: 'https://docs.google.com/document/d/abc',
        status: 'error',
        lastSyncedAt: null,
        lastError: 'access revoked',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    expect(result[0]).not.toHaveProperty('userId');
  });

  it('returns an empty array for a user with no resources', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };

    await expect(listSyncResources(db, USER)).resolves.toEqual([]);
  });
});

describe('createSyncResource handler (AC-18, POST /api/v1/sync-resources) -- 201/422', () => {
  it('returns a contract-shaped SyncResource on success', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [rawRow()] }); // INSERT ... RETURNING
    const db: Db = { query };

    const result = await createSyncResource(db, USER, { url: 'https://docs.google.com/document/d/abc' });

    expect(result).toEqual({
      id: 'resource-1',
      url: 'https://docs.google.com/document/d/abc',
      status: 'active',
      lastSyncedAt: null,
      lastError: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(query.mock.calls[0][1]).toContain(USER);
    expect(query.mock.calls[0][1]).toContain('https://docs.google.com/document/d/abc');
  });

  it.each(['', '   ', 'not a url', 'ftp://legacy.example.com/file'])(
    'rejects %j with sync_resource.url_invalid, 422, and never touches the database',
    async (badUrl) => {
      const query = vi.fn();
      const db: Db = { query };

      await expect(createSyncResource(db, USER, { url: badUrl })).rejects.toMatchObject({
        code: 'sync_resource.url_invalid',
        httpStatus: 422,
      });
      await expect(createSyncResource(db, USER, { url: badUrl })).rejects.toBeInstanceOf(AppError);
      expect(db.query).not.toHaveBeenCalled();
    }
  );
});

describe('deleteSyncResource handler (AC-18, DELETE /api/v1/sync-resources/{resourceId}) -- 204/404', () => {
  it('resolves with no value when the resource belongs to the caller', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: 'resource-1' }] }); // DELETE ... RETURNING
    const db: Db = { query };

    await expect(deleteSyncResource(db, USER, 'resource-1')).resolves.toBeUndefined();
    expect(query.mock.calls[0][1]).toContain('resource-1');
    expect(query.mock.calls[0][1]).toContain(USER);
  });

  it('rejects with sync_resource.not_found, 404, when the resource is missing or belongs to another user', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const db: Db = { query };

    await expect(deleteSyncResource(db, USER, 'someone-elses-resource')).rejects.toMatchObject({
      code: 'sync_resource.not_found',
      httpStatus: 404,
    });
  });
});
