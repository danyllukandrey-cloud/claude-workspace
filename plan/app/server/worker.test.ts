// Review fix -- worker.ts is new wiring (composition root that was entirely
// missing: generate-report.ts/daily-sync.ts existed, fully tested, but
// nothing called them). This suite exercises the extracted tick logic
// (`runOnce`) directly against a fake Db, the same "route by SQL text"
// convention that generate-report.test.ts/daily-sync.test.ts already use --
// it does not test the setInterval plumbing in startWorker (untestable
// glue, not logic).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../src/agent-worker/infra/schedule';
import { runOnce } from './worker';

const NOW = new Date('2026-09-12T10:00:00.000Z'); // -> referenceDate '2026-09-12'
const USER_OK = 'user-ok';
const USER_BROKEN = 'user-broken';

/**
 * Fake Db routed by SQL text, same approach as generate-report.test.ts's
 * fakeDb: enumerates two app_user rows, one of which fails the moment
 * generateReport tries to read its activity (simulating a per-user failure
 * that must not stop the other user's reports or the sync pass).
 */
function fakeDb(): { db: Db; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const upper = text.trim().toUpperCase();

    if (upper.startsWith('SELECT ID FROM APP_USER')) {
      return { rows: [{ id: USER_BROKEN }, { id: USER_OK }] };
    }
    if (upper.startsWith('SELECT') && text.includes('FROM entry')) {
      const userId = params?.[0];
      if (userId === USER_BROKEN) {
        throw new Error('connection terminated unexpectedly');
      }
      return { rows: [] }; // empty activity is valid (generate-report.test.ts)
    }
    if (upper.startsWith('INSERT INTO ACTIVITY_REPORT')) {
      return { rows: [{ id: params?.[0] }] }; // always inserts -> 'generated'
    }
    if (text.includes('FROM sync_resource')) {
      return { rows: [] }; // no due resources this tick
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { db: { query: query as unknown as Db['query'] }, query };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runOnce -- AC-11/AC-18 worker tick', () => {
  it('generates a report per (user, period type) for a healthy user, keeps going past a broken user, and never throws', async () => {
    const { db, query } = fakeDb();
    const writeToResource = vi.fn().mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runOnce({
      db,
      sleep: async () => {},
      writeToResource,
      now: () => NOW,
    });

    // Healthy user: 3 period types (weekly/monthly/quarterly), each a fresh
    // insert (idempotency handled by the unique index, not a "due" check
    // here) -> all 'generated'.
    expect(result.reportsGenerated).toBe(3);
    expect(result.reportsDuplicate).toBe(0);
    expect(result.reportsDeadLetter).toBe(0);

    // Broken user: all 3 period types fail (activity read throws) --
    // counted as failures, not silently dropped, and NOT mixed into the
    // healthy user's counts.
    expect(result.reportFailures).toBe(3);

    // No sync_resource rows were due this tick.
    expect(result.syncOutcomes).toBe(0);
    expect(result.syncFailures).toBe(0);

    // The broken user's failure was logged, not swallowed silently.
    expect(errorSpy).toHaveBeenCalled();
    const loggedBrokenUser = errorSpy.mock.calls.some(([msg]) =>
      typeof msg === 'string' && msg.includes(USER_BROKEN)
    );
    expect(loggedBrokenUser).toBe(true);

    // The healthy user's 3 inserts actually happened (proof the broken
    // user's earlier failure did not stop the loop).
    const inserts = (query.mock.calls as [string, unknown[]?][]).filter(([text]) =>
      text.trim().toUpperCase().startsWith('INSERT INTO ACTIVITY_REPORT')
    );
    expect(inserts).toHaveLength(3);

    // A per-tick summary is logged.
    expect(logSpy).toHaveBeenCalled();

    // writeToResource was never called -- nothing was due for sync.
    expect(writeToResource).not.toHaveBeenCalled();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('never throws and produces an empty result when listing app_user itself fails', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.trim().toUpperCase().startsWith('SELECT ID FROM APP_USER')) {
        throw new Error('pool exhausted');
      }
      if (text.includes('FROM sync_resource')) {
        return { rows: [] };
      }
      throw new Error(`Непередбачений запит у тесті: ${text}`);
    });
    const db: Db = { query: query as unknown as Db['query'] };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      runOnce({ db, sleep: async () => {}, writeToResource: vi.fn(), now: () => NOW })
    ).resolves.toMatchObject({
      reportsGenerated: 0,
      reportsDuplicate: 0,
      reportsDeadLetter: 0,
      reportFailures: 0,
      syncOutcomes: 0,
      syncFailures: 0,
    });

    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('counts a failed sync outcome without throwing (AC-18b)', async () => {
    const query = vi.fn(async (text: string) => {
      const upper = text.trim().toUpperCase();
      if (upper.startsWith('SELECT ID FROM APP_USER')) {
        return { rows: [] }; // no users -> report loop is a no-op this test
      }
      if (text.includes('FROM sync_resource')) {
        return {
          rows: [
            {
              id: 'resource-1',
              user_id: 'user-ok',
              url: 'https://docs.example.test/doc-1',
              status: 'active',
              last_synced_at: null, // never synced -> due
            },
          ],
        };
      }
      // cards/entries/structure snapshot reads for the due resource's owner.
      if (text.includes('FROM card')) return { rows: [] };
      if (text.includes('FROM structure')) return { rows: [] };
      if (upper.startsWith('UPDATE SYNC_RESOURCE')) return { rows: [] };
      if (upper.startsWith('INSERT INTO AGENT_AUDIT_EVENT')) return { rows: [] };
      throw new Error(`Непередбачений запит у тесті: ${text}`);
    });
    const db: Db = { query: query as unknown as Db['query'] };
    const writeToResource = vi.fn().mockRejectedValue(new Error('access revoked'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await runOnce({ db, sleep: async () => {}, writeToResource, now: () => NOW });

    expect(result.syncOutcomes).toBe(1);
    expect(result.syncFailures).toBe(1);
    expect(writeToResource).toHaveBeenCalledWith('https://docs.example.test/doc-1', expect.any(String));

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
