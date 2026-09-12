// T15 -- Infra (agent-worker): schedule + report persistence (AC-11).
// RED (mocked Db, same convention as ./resource-writer.test.ts and
// ../../structure/infra/postgres-repo.test.ts): a fake db.query per call,
// asserted by SQL text and params -- no live network, no live Postgres
// (see file header comment in schedule.ts for why).

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './schedule';
import { readLifeAreaCardActivity, saveActivityReport } from './schedule';

const USER_ID = 'user-1';
const PERIOD_START = '2026-09-07';
const PERIOD_END = '2026-09-13';

describe('readLifeAreaCardActivity -- cross-feature read (AC-11, Flow 14)', () => {
  it('reads confirmed entries for the user across all their cards, scoped to the period', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'entry-1',
          card_id: 'card-1',
          amount: '5',
          raw_text: 'біг 5 км',
          recorded_at: new Date('2026-09-08T10:00:00Z'),
        },
      ],
    });
    const db: Db = { query };

    const activity = await readLifeAreaCardActivity(db, USER_ID, PERIOD_START, PERIOD_END);

    expect(activity).toEqual([
      {
        id: 'entry-1',
        cardId: 'card-1',
        amount: 5,
        rawText: 'біг 5 км',
        recordedAt: new Date('2026-09-08T10:00:00Z'),
      },
    ]);

    const [sql, params] = query.mock.calls[0];
    // cross-feature read: entry has no user_id of its own (life-area-card
    // data-model.md) -- must join back through card.owner_user_id.
    expect(sql).toMatch(/FROM entry/);
    expect(sql).toMatch(/JOIN card/);
    expect(sql).toMatch(/owner_user_id/);
    expect(sql).toMatch(/status = 'confirmed'/);
    expect(params).toEqual([USER_ID, PERIOD_START, PERIOD_END]);
  });

  it('a user with no activity in the period gets an empty list, not an error', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    const activity = await readLifeAreaCardActivity(db, USER_ID, PERIOD_START, PERIOD_END);

    expect(activity).toEqual([]);
  });
});

describe('saveActivityReport -- idempotent persistence (AC-11, Flow 14)', () => {
  const REPORT = {
    id: 'report-1',
    userId: USER_ID,
    periodType: 'weekly' as const,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    content: 'звіт за тиждень',
  };

  it('happy path: inserts the report row', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: REPORT.id }] });
    const db: Db = { query };

    const result = await saveActivityReport(db, REPORT);

    expect(result).toEqual({ inserted: true });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO activity_report/);
    expect(sql).toMatch(/ON CONFLICT/);
    expect(sql).toMatch(/DO NOTHING/);
    expect(params).toEqual([
      REPORT.id,
      REPORT.userId,
      REPORT.periodType,
      REPORT.periodStart,
      REPORT.periodEnd,
      REPORT.content,
    ]);
  });

  it('run twice for the same idempotency key: the second call reports inserted:false, never throws', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ id: REPORT.id }] }); // first run -- inserted
    query.mockResolvedValueOnce({ rows: [] }); // second run -- ON CONFLICT DO NOTHING, no row
    const db: Db = { query };

    const first = await saveActivityReport(db, REPORT);
    const second = await saveActivityReport(db, { ...REPORT, id: 'report-2' });

    expect(first).toEqual({ inserted: true });
    expect(second).toEqual({ inserted: false });
    expect(query).toHaveBeenCalledTimes(2);

    // both attempts target the same idempotency key
    // (user_id, period_type, period_start) -- data-model.md uq_activity_report_period.
    const [, firstParams] = query.mock.calls[0];
    const [, secondParams] = query.mock.calls[1];
    expect([firstParams[1], firstParams[2], firstParams[3]]).toEqual([
      secondParams[1],
      secondParams[2],
      secondParams[3],
    ]);
  });

  it('the unique index is the exact idempotency key from data-model.md (user_id, period_type, period_start)', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: REPORT.id }] });
    const db: Db = { query };

    await saveActivityReport(db, REPORT);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(user_id, period_type, period_start\)/);
  });
});
