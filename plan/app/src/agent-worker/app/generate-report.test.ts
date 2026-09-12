// T19 -- App (agent-worker): generate-report use-case (US-08, AC-11,
// sad.md Critical flow 14).
// RED (unit level, mocked Db -- same convention as ./daily-sync.test.ts and
// ../../agent/app/developer-report.test.ts): DoD (tracker.md T19) calls this
// an "integration test" -- real Postgres is unavailable in this sandbox, so
// this documents the intended real-DB behaviour against a mocked Db, routing
// by SQL text and params, never a live connection.
//
// DoD: "due period produces a passive activity_report row with no outbound
// notification; a failed write after retries is marked dead_letter".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '../infra/schedule';
import { generateReport } from './generate-report';

const USER_ID = 'user-1';
const REPORT_ID = 'report-1';
// referenceDate 2026-09-12 (Sat) falls in the ISO week 2026-09-07 (Mon) .. 2026-09-13 (Sun).

function activityRow() {
  return {
    id: 'entry-1',
    card_id: 'card-1',
    amount: '5',
    raw_text: 'біг 5 км',
    recorded_at: new Date('2026-09-08T10:00:00Z'),
  };
}

/**
 * Підроблена база -- маршрутизує запит за текстом SQL, той самий підхід, що
 * ./daily-sync.test.ts і ../../agent/app/developer-report.test.ts уже
 * застосовують. `insertOutcome`:
 * - 'success' -- звичайний запис (schedule.ts's saveActivityReport) вставляє
 *   рядок одразу;
 * - 'writes_always_fail' -- звичайний запис кожного разу кидає (симулює
 *   недоступну БД, наприклад тимчасовий constraint/збій на боці провайдера),
 *   а окремий dead-letter запис (розпізнається за літералом `dead_letter` у
 *   SQL-тексті, distinct від звичайного INSERT) завжди встигає пройти --
 *   так тест перевіряє, що generateReport після вичерпаних спроб явно
 *   позначає рядок, а не просто продовжує безуспішно повторювати той самий
 *   запис.
 */
function fakeDb(opts: {
  activity: ReturnType<typeof activityRow>[];
  insertOutcome: 'success' | 'writes_always_fail';
}): {
  db: Db;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    const upper = text.trim().toUpperCase();

    if (upper.startsWith('SELECT') && text.includes('FROM entry')) {
      return { rows: opts.activity };
    }
    if (upper.startsWith('INSERT INTO ACTIVITY_REPORT')) {
      const isDeadLetterWrite = text.includes('dead_letter');
      if (opts.insertOutcome === 'writes_always_fail' && !isDeadLetterWrite) {
        throw Object.assign(new Error('connection terminated unexpectedly'), { code: 'ECONNRESET' });
      }
      return { rows: [{ id: params?.[0] }] };
    }
    throw new Error(`Непередбачений запит у тесті: ${text}`);
  });
  return { db: { query: query as unknown as Db['query'] }, query };
}

function insertCalls(query: ReturnType<typeof vi.fn>) {
  return (query.mock.calls as [string, unknown[]?][]).filter(([text]) =>
    text.trim().toUpperCase().startsWith('INSERT INTO ACTIVITY_REPORT')
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateReport -- AC-11 happy path', () => {
  it('a due period produces exactly one passive activity_report row, status generated, no outbound notification', async () => {
    const { db, query } = fakeDb({ activity: [activityRow()], insertOutcome: 'success' });

    const outcome = await generateReport(
      { db, sleep: async () => {} },
      { userId: USER_ID, periodType: 'weekly', referenceDate: '2026-09-12', reportId: REPORT_ID }
    );

    expect(outcome.status).toBe('generated');
    expect(outcome.reportId).toBe(REPORT_ID);

    const inserts = insertCalls(query);
    expect(inserts).toHaveLength(1);
    const [sql, params] = inserts[0];
    expect(sql).toMatch(/INSERT INTO activity_report/);
    expect(sql).not.toMatch(/dead_letter/); // default status column, not overridden
    expect(params).toEqual([REPORT_ID, USER_ID, 'weekly', '2026-09-07', '2026-09-13', expect.any(String)]);
    expect(params?.[5]).toContain('5 км'); // report content reflects the read activity

    // Passive record only -- generateReport performs no email/webhook/push call
    // of any kind; the only side effect visible to the fake Db is the one
    // SELECT + one INSERT below.
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('a period with no activity still produces a report row (empty activity is a valid, not an error)', async () => {
    const { db, query } = fakeDb({ activity: [], insertOutcome: 'success' });

    const outcome = await generateReport(
      { db, sleep: async () => {} },
      { userId: USER_ID, periodType: 'weekly', referenceDate: '2026-09-12', reportId: REPORT_ID }
    );

    expect(outcome.status).toBe('generated');
    expect(insertCalls(query)).toHaveLength(1);
  });
});

describe('generateReport -- AC-11 dead-letter path (Flow 14: "retry N разів з backoff" then dead-letter)', () => {
  it('a write that keeps failing is retried, then persisted with status=dead_letter after retries are exhausted', async () => {
    const { db, query } = fakeDb({ activity: [activityRow()], insertOutcome: 'writes_always_fail' });
    const sleep = vi.fn(async () => {});

    const outcome = await generateReport(
      { db, sleep },
      { userId: USER_ID, periodType: 'weekly', referenceDate: '2026-09-12', reportId: REPORT_ID }
    );

    expect(outcome.status).toBe('dead_letter');
    expect(outcome.reportId).toBe(REPORT_ID);

    // More than one write attempt happened -- this was retried, not given up
    // on the first failure.
    const inserts = insertCalls(query);
    expect(inserts.length).toBeGreaterThan(1);

    // Backoff between attempts (sad.md Flow 14: "retry N разів з backoff").
    expect(sleep).toHaveBeenCalled();

    // The final, dead-letter-marked attempt explicitly sets status.
    const lastInsert = inserts[inserts.length - 1];
    expect(lastInsert[0]).toMatch(/dead_letter/);

    // Still no outbound notification of any kind on failure either -- the
    // dead-letter row is the sole passive record (D-70/D-43).
    expect(query.mock.calls.every(([text]) => text.includes('SELECT') || text.includes('INSERT'))).toBe(true);
  });

  it('never throws to the caller even when every write attempt fails', async () => {
    const { db } = fakeDb({ activity: [activityRow()], insertOutcome: 'writes_always_fail' });

    await expect(
      generateReport(
        { db, sleep: async () => {} },
        { userId: USER_ID, periodType: 'weekly', referenceDate: '2026-09-12', reportId: REPORT_ID }
      )
    ).resolves.toMatchObject({ status: 'dead_letter' });
  });
});
