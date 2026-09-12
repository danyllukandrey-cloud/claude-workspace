// Review 2026-09-12 (agent code review, ports-owns-SQL finding) -- Infra
// (agent-worker): repository over `activity_report`.
// RED (mocked Db, same convention as ./resource-writer.test.ts and
// ../../agent/infra/postgres-repo.ts's sibling tests): this file pins the
// SQL that used to live inline in ../../agent/ports/reports-handler.ts --
// moved here per ADR-0005 ("ports doesn't own SQL").

import { describe, it, expect, vi } from 'vitest';
import type { Db } from './activity-report-repo';
import { findActivityReportsByUser } from './activity-report-repo';

const OWNER = 'owner-1';

function reportRow(
  overrides: Partial<{
    id: string;
    period_type: 'weekly' | 'monthly' | 'quarterly';
    period_start: Date;
    period_end: Date;
    content: string;
    status: 'generated' | 'dead_letter';
    generated_at: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? 'report-1',
    period_type: overrides.period_type ?? 'weekly',
    period_start: overrides.period_start ?? new Date('2026-09-01T00:00:00Z'),
    period_end: overrides.period_end ?? new Date('2026-09-07T00:00:00Z'),
    content: overrides.content ?? 'Тижневий звіт активності',
    status: overrides.status ?? 'generated',
    generated_at: overrides.generated_at ?? new Date('2026-09-08T09:00:00Z'),
  };
}

describe('findActivityReportsByUser', () => {
  it('queries activity_report scoped to the user, mapping snake_case columns to camelCase', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [reportRow({ id: 'report-1' })] });
    const db: Db = { query };

    const records = await findActivityReportsByUser(db, OWNER, undefined);

    expect(records).toEqual([
      {
        id: 'report-1',
        periodType: 'weekly',
        periodStart: new Date('2026-09-01T00:00:00Z'),
        periodEnd: new Date('2026-09-07T00:00:00Z'),
        content: 'Тижневий звіт активності',
        status: 'generated',
        generatedAt: new Date('2026-09-08T09:00:00Z'),
      },
    ]);

    const [text, params] = query.mock.calls[0];
    expect(text).toContain('FROM activity_report');
    expect(text).toContain('WHERE user_id = $1');
    expect(params).toEqual([OWNER]);
  });

  it('returns an empty array when the user has no reports', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    const records = await findActivityReportsByUser(db, OWNER, undefined);

    expect(records).toEqual([]);
  });

  // Filterable by periodType (reports-handler.ts DoD) -- adds `AND
  // period_type = $N` to the SQL, not an in-memory post-filter.
  it('adds an AND period_type condition when periodType is given, passing it as a bound param', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [reportRow({ period_type: 'quarterly' })] });
    const db: Db = { query };

    await findActivityReportsByUser(db, OWNER, 'quarterly');

    const [text, params] = query.mock.calls[0];
    expect(text).toContain('AND period_type = $2');
    expect(params).toEqual([OWNER, 'quarterly']);
  });

  it('omits the period_type condition entirely when periodType is undefined', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await findActivityReportsByUser(db, OWNER, undefined);

    const [text, params] = query.mock.calls[0];
    expect(text).not.toContain('AND period_type');
    expect(params).toEqual([OWNER]);
  });

  it('orders by generated_at DESC with id as tiebreak', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db: Db = { query };

    await findActivityReportsByUser(db, OWNER, undefined);

    const [text] = query.mock.calls[0];
    expect(text).toContain('ORDER BY generated_at DESC, id DESC');
  });
});
