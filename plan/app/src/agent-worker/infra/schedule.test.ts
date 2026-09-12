// T15 -- Infra (agent-worker): schedule + report persistence (AC-11).
// RED (mocked Db, same convention as ./resource-writer.test.ts and
// ../../structure/infra/postgres-repo.test.ts): a fake db.query per call,
// asserted by SQL text and params -- no live network, no live Postgres
// (see file header comment in schedule.ts for why).
//
// readLifeAreaCardActivity no longer hand-writes SQL against entry/card
// (life-area-card's own tables) -- it reuses life-area-card's own exported
// listCardsByOwner/listEntriesByCard (same precedent as
// ../app/daily-sync.ts's buildUserSnapshot). These tests assert the SQL
// text life-area-card's postgres-repo.ts itself issues for those two
// functions, not a bespoke join -- proving no duplicated schema knowledge
// (entry.status/card.owner_user_id) lives in this file any more.

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './schedule';
import { readLifeAreaCardActivity, saveActivityReport } from './schedule';

const USER_ID = 'user-1';
const PERIOD_START = '2026-09-07';
const PERIOD_END = '2026-09-13';

/** A fake `card` row shaped the way life-area-card/infra/postgres-repo.ts's CARD_COLUMNS returns it. */
function cardRow(id: string) {
  return {
    id,
    owner_user_id: USER_ID,
    name: `card ${id}`,
    description: null,
    status: 'active',
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-01T00:00:00Z'),
  };
}

/** A fake `entry` row shaped the way life-area-card/infra/postgres-repo.ts's ENTRY_COLUMNS returns it. */
function entryRow(overrides: {
  id: string;
  cardId: string;
  amount: string;
  status: 'pending' | 'confirmed' | 'rejected';
  recordedAt: Date;
  rawText?: string | null;
}) {
  return {
    id: overrides.id,
    metric_block_id: 'metric-block-1',
    card_id: overrides.cardId,
    amount: overrides.amount,
    raw_text: overrides.rawText ?? null,
    status: overrides.status,
    source_device_id: null,
    recorded_at: overrides.recordedAt,
    confirmed_at: overrides.status === 'confirmed' ? overrides.recordedAt : null,
    created_at: overrides.recordedAt,
  };
}

describe('readLifeAreaCardActivity -- cross-feature read (AC-11, Flow 14)', () => {
  it('reuses life-area-card own functions (no bespoke entry/card join) and returns confirmed entries in the period', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/FROM card/.test(sql)) {
        return { rows: [cardRow('card-1')] };
      }
      if (/FROM entry/.test(sql)) {
        return {
          rows: [
            entryRow({
              id: 'entry-1',
              cardId: 'card-1',
              amount: '5',
              status: 'confirmed',
              recordedAt: new Date('2026-09-08T10:00:00Z'),
              rawText: 'біг 5 км',
            }),
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const db: Db = { query: query as unknown as Db['query'] };

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

    // This file must not hand-write knowledge of life-area-card's schema:
    // no SQL text here should join entry to card or filter on
    // owner_user_id/status itself -- that lives only inside
    // life-area-card/infra/postgres-repo.ts's own listCardsByOwner /
    // listEntriesByCard, which this test's mock queries came from.
    const calls = query.mock.calls as [string, unknown[]?][];
    for (const [sql] of calls) {
      expect(sql).not.toMatch(/JOIN/i);
    }
    // The owner scoping happens via listCardsByOwner's own WHERE owner_user_id = $1.
    const cardQueryCall = calls.find(([sql]) => /FROM card/.test(sql));
    expect(cardQueryCall?.[1]).toEqual([USER_ID]);
  });

  it('excludes pending/rejected entries and entries outside the period, across multiple cards', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM card/.test(sql)) {
        return { rows: [cardRow('card-1'), cardRow('card-2')] };
      }
      if (/FROM entry/.test(sql)) {
        const cardId = (params as [string])[0];
        if (cardId === 'card-1') {
          return {
            rows: [
              entryRow({
                id: 'entry-in-period',
                cardId: 'card-1',
                amount: '3',
                status: 'confirmed',
                recordedAt: new Date('2026-09-09T00:00:00Z'),
              }),
              entryRow({
                id: 'entry-pending',
                cardId: 'card-1',
                amount: '9',
                status: 'pending',
                recordedAt: new Date('2026-09-09T00:00:00Z'),
              }),
              entryRow({
                id: 'entry-outside-period',
                cardId: 'card-1',
                amount: '9',
                status: 'confirmed',
                recordedAt: new Date('2026-01-01T00:00:00Z'),
              }),
            ],
          };
        }
        return {
          rows: [
            entryRow({
              id: 'entry-rejected',
              cardId: 'card-2',
              amount: '9',
              status: 'rejected',
              recordedAt: new Date('2026-09-09T00:00:00Z'),
            }),
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const db: Db = { query: query as unknown as Db['query'] };

    const activity = await readLifeAreaCardActivity(db, USER_ID, PERIOD_START, PERIOD_END);

    expect(activity.map((a) => a.id)).toEqual(['entry-in-period']);
  });

  it('a user with no activity in the period gets an empty list, not an error', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/FROM card/.test(sql)) return { rows: [] };
      return { rows: [] };
    });
    const db: Db = { query: query as unknown as Db['query'] };

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
