// T40 -- App: sync-resource CRUD use-cases (US-12, AC-18).
//
// RED (unit level, mocked Db): real DB round-trip is out of scope for this
// task's files_hint (sync-resources.ts only) and unavailable in this sandbox
// (no live Postgres/.env) -- this suite documents the intended real-DB
// behaviour (DoD: "add/list/remove a resource; a malformed URL is rejected
// before any write") against a mocked Db, the same convention already used
// in ../infra/postgres-repo.test.ts and ../../structure/app/close-card.test.ts:
// a fake `Db.query` (vi.fn), routed by SQL text, asserted by SQL text + params.
//
// contracts/openapi.yaml (SyncResource/SyncResourceCreate, POST/GET/DELETE
// /api/v1/sync-resources): a resource carries id/url/status/lastSyncedAt/
// lastError/createdAt; an invalid url produces `sync_resource.url_invalid`
// (422); removing a resource that doesn't exist/belong to the caller
// produces `sync_resource.not_found` (404) -- same non-disclosure shape as
// ../infra/postgres-repo.ts (scoped by user_id in the SQL itself, never
// filtered after the fact).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '../../shared/errors';
import type { Db } from './sync-resources';
import { addSyncResource, listSyncResources, removeSyncResource } from './sync-resources';

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

/** Підроблена база -- маршрутизує запит за текстом SQL, той самий підхід, що
 * ../infra/postgres-repo.test.ts і ../../structure/app/close-card.test.ts. */
function fakeDb(opts: { rows?: Record<string, unknown>[] } = {}): Db {
  const query = vi.fn(async (text: string, _params?: unknown[]) => {
    const upper = text.trim().toUpperCase();
    if (upper.startsWith('INSERT INTO SYNC_RESOURCE')) {
      return { rows: [rawRow()] };
    }
    if (upper.startsWith('SELECT') && text.includes('sync_resource')) {
      return { rows: opts.rows ?? [] };
    }
    if (upper.startsWith('DELETE') && text.includes('sync_resource')) {
      return { rows: opts.rows ?? [] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { query: query as unknown as Db['query'] };
}

function queryCalls(db: Db) {
  return (db.query as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]?][];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('addSyncResource -- AC-18 happy path', () => {
  it('inserts a resource scoped to the caller and returns it', async () => {
    const db = fakeDb();

    const result = await addSyncResource(db, { userId: USER, url: 'https://docs.google.com/document/d/abc' });

    expect(result).toEqual({
      id: 'resource-1',
      userId: USER,
      url: 'https://docs.google.com/document/d/abc',
      status: 'active',
      lastSyncedAt: null,
      lastError: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const inserts = queryCalls(db).filter(([text]) => text.trim().toUpperCase().startsWith('INSERT'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toContain(USER);
    expect(inserts[0][1]).toContain('https://docs.google.com/document/d/abc');
  });
});

describe('addSyncResource -- AC-18b/contract error: malformed URL rejected before any write', () => {
  it.each(['', '   ', 'not a url', 'ftp://legacy.example.com/file'])(
    'rejects %j with sync_resource.url_invalid, 422, and never touches the database',
    async (badUrl) => {
      const db = fakeDb();

      await expect(addSyncResource(db, { userId: USER, url: badUrl })).rejects.toMatchObject({
        code: 'sync_resource.url_invalid',
        httpStatus: 422,
      });
      await expect(addSyncResource(db, { userId: USER, url: badUrl })).rejects.toBeInstanceOf(AppError);

      expect(db.query).not.toHaveBeenCalled();
    }
  );
});

describe('listSyncResources -- AC-18 happy path', () => {
  it("lists only the caller's resources", async () => {
    const rows = [rawRow({ id: 'r-1' }), rawRow({ id: 'r-2', status: 'error', last_error: 'access revoked' })];
    const db = fakeDb({ rows });

    const result = await listSyncResources(db, USER);

    expect(result).toEqual([
      {
        id: 'r-1',
        userId: USER,
        url: 'https://docs.google.com/document/d/abc',
        status: 'active',
        lastSyncedAt: null,
        lastError: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'r-2',
        userId: USER,
        url: 'https://docs.google.com/document/d/abc',
        status: 'error',
        lastSyncedAt: null,
        lastError: 'access revoked',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const selects = queryCalls(db).filter(([text]) => text.trim().toUpperCase().startsWith('SELECT'));
    expect(selects).toHaveLength(1);
    expect(selects[0][1]).toContain(USER);
  });

  it('returns an empty list for a user with none', async () => {
    const db = fakeDb({ rows: [] });

    await expect(listSyncResources(db, USER)).resolves.toEqual([]);
  });
});

describe('removeSyncResource -- AC-18 happy path + non-disclosure', () => {
  it('deletes a resource that belongs to the caller', async () => {
    const db = fakeDb({ rows: [{ id: 'resource-1' }] });

    await removeSyncResource(db, USER, 'resource-1');

    const deletes = queryCalls(db).filter(([text]) => text.trim().toUpperCase().startsWith('DELETE'));
    expect(deletes).toHaveLength(1);
    expect(deletes[0][1]).toContain('resource-1');
    expect(deletes[0][1]).toContain(USER);
  });

  it('rejects with sync_resource.not_found, 404, when the resource is missing or belongs to another user', async () => {
    const db = fakeDb({ rows: [] });

    await expect(removeSyncResource(db, USER, 'someone-elses-resource')).rejects.toMatchObject({
      code: 'sync_resource.not_found',
      httpStatus: 404,
    });
    await expect(removeSyncResource(db, USER, 'someone-elses-resource')).rejects.toBeInstanceOf(AppError);
  });
});
